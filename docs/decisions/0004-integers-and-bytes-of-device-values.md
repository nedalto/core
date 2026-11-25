# 0004. Integers and bytes of device values

Status: Accepted

## Context

Matter attributes, command fields and command responses carry integers of up to 64 bits and octet strings.
JSON, which carries them to clients, is interoperable only for integers within ±(2^53 − 1) (RFC 8259 §6, RFC 7493 §2.2): a client that reads values without a schema rounds a larger one without notice, as `JSON.parse` and Go's `json.Unmarshal` into `any` do, and `jq` 1.7 as soon as it operates on it.
In Matter, what goes beyond 2^53 are identifiers: node ids, ACL subjects with CATs, the fabric id, Thread addresses.
A rounded identifier names something else: the subject `0xFFFFFFFD00010001` arrives as `0xFFFFFFFD00010000`.

The SDK does not choose between `number` and `bigint` for a 64-bit field by the value, but by the width the device encoded the integer with: a uint64 of 5 encoded in one byte arrives as `5`, and encoded in eight bytes as `5n` (`TlvLongNumberSchema` in `@matter/types` 0.18.0).
A field of up to 32 bits always arrives as a `number` (`TlvNumberSchema`, which converts without checking the range).
The SDK delivers octet strings as `Uint8Array`, and the structs in the state it keeps as instances of classes it generates; a read response brings plain objects.
It does not check the reports it decodes against the range of a field (`decodeTlv` in `InputChunk.js` of `@matter/protocol` 0.18.0), and its range check of a number with decimals compares with the limits, which NaN passes (`validateBoundaries` in `TlvNumber.js`), so a device can report NaN or an infinity, which Matter excludes.
Its check of an integer field does not look at whether the number is an integer either: it takes 300.7 for a `uint16`, and the device receives 300 (`validate` in `TlvNumber.js`, [matter-js/matter.js#5036](https://github.com/matter-js/matter.js/issues/5036)).
And it sizes the length of a text by its UTF-16 units but writes the text as UTF-8, so a text of up to 255 units and more than 255 bytes goes with a length that does not fit, and the device cannot read the request (`TlvString.js`; fixed after 0.18.0 by [matter-js/matter.js#4995](https://github.com/matter-js/matter.js/pull/4995)).

## Decision

A value is plain JSON, inside the hub as on the wire:

- An integer within ±(2^53 − 1) is a `number`, and any other is `{ "$integer": "<canonical decimal>" }`.
- Bytes are `{ "$bytes": "<lowercase hex>" }`.
- Keys that start with `$` are reserved for these tags.

`packages/matter/src/normalize.ts` converts in both directions, at any depth, in one place.
From the SDK, `normalizeValue` turns a `bigint` into a `number` or an `$integer` by its value and a `Uint8Array` into `$bytes`, and structs become plain objects without the fields the device left out.
A `number` from the SDK is kept as it is, also outside the safe range: it comes from a field with decimals, or from a device that does not conform, whose value the SDK has already rounded.
NaN and the infinities become `null`, the null of Matter for a number with decimals, so that one such value neither hides the rest of the endpoint nor loses the report of its change.
A type the SDK does not deliver as a value, such as a `Date`, is an `InternalError`.
Towards the SDK, `denormalizeValue` turns the value of a write and the arguments of a command back, before the SDK checks their type:

- An `$integer` becomes a `number` in the safe range and a `bigint` outside it; a tag within the safe range is accepted, so a typed client can always tag its 64-bit fields.
- `$bytes` becomes a `Uint8Array`.
- A tag must be an object with that single key, with a canonical decimal of at most 20 digits (no `+`, leading zeros, `-0`, decimal point or exponent), or with an even number of lowercase hex digits (`packages/contract/src/common/wire.ts`).
  Any other object with a key that starts with `$` is a `ValidationError`.
- NaN and the infinities are a `ValidationError`: JSON cannot carry them, but code in the hub can, and the SDK lets NaN through its range check.
- A string that is not well-formed Unicode is a `ValidationError`: Matter carries text as UTF-8, which has no form for a lone surrogate, and the SDK would send U+FFFD in its place.

Whether a value fits its field is checked by type when the request is built, in `packages/matter/src/request.ts`, never in the conversion, which goes by the value.
The SDK checks the type and the range of each field, and in an integer field `request.ts` rejects with a `ValidationError` a `number` that the SDK would send changed:

- one with decimals, which the SDK truncates;
- one outside the safe range, with a message that asks for `$integer`: JSON has already rounded it, as every integer literal beyond the safe range parses to a number of magnitude 2^53 or more.

An integer field is told by the TLV type of its element in the request the SDK builds, which keeps each value as given, so the check needs no model, and a field with decimals takes any finite number.

In a command, a text that the SDK would send with a length that does not fit is a `ValidationError` too: the check compares the width the SDK picks for the length with the UTF-8 bytes of the text, so it stops rejecting anything once the SDK is fixed.
No attribute that a client writes in the standard clusters takes a text that long.

Then `request.ts` encodes the value with the schema of the attribute or the command, decodes it back and compares the two: a field, a flag or an integer that would not reach the device as given is a `ValidationError` that says where it is.
The SDK checks only the fields a struct has, and leaves any other out of the request (`validate` in `TlvObject.js` of `@matter/types` 0.18.0).
A bitmap has no check of its own: it takes from an object only its flags, so a number goes as no flag at all, and the number of a field wider than one bit goes as it is, into the bits of the next fields (`BitmapSchema.js`).
A number with decimals only has to arrive: its field may round it.
The comparison sees what the SDK changes as it builds the request, not as it writes the bytes, where an integer loses its decimals and a text becomes UTF-8, which are checked apart, and a `single` rounds.

The same form holds for everything that crosses the wire: `NodeInfo.matterId` and the `data` of errors are `WireValue` too.

## Alternatives

- **Pass on the type the SDK returns**: the type of a value would depend on how each device encodes it, so `5` and `5n` would both reach the hub for the same attribute, and `JSON.stringify` throws on a `bigint`.
- **Normalize by the Matter type of the field**: it requires walking the data model, which changes between SDK versions, and a reader would need the model too to know which form to expect.
  It would also let bytes travel as a bare string, converted by the type of the field, but a client would need the model too to know that a text is bytes.
- **Bytes as Base64**: the usual encoding for bytes in JSON, but hex is readable for what Matter puts in octet strings (MAC addresses, IP addresses, SSIDs), the text of the tag compares with `===`, and those values are short.
- **A bare string, as Protobuf writes 64-bit integers in JSON**: without the model it cannot be told from a text field.
- **`bigint` inside the hub, converted when writing JSON**: nothing compares these integers but by equality, which two canonical decimals keep, and every place that serializes values would need a converter.
- **`InternalError` for NaN and the infinities**: a single such value hid the whole endpoint from `describe` and lost the report of its change.
- **A tag for NaN and the infinities, as Protobuf and MongoDB have**: it would carry values that Matter excludes, which the hub could not send back to a device either.
- **Checking the shape of a value against the model, as the SDK's validator of the state of a behavior does (`RootSupervisor`)**: it repeats the rules by which the SDK encodes (names, optional and nullable fields, widths of bitmaps), so a difference with the encoder would reject a valid value or let one change, and it finds only the causes it foresees; the comparison asks the encoder itself.
  The SDK's own validator takes decimals in an integer field and fields that a struct does not have, and on a peer it leaves conformance to the device.
- **Walking the TLV schemas**: their fields are private (`fieldDefinitions` of `ObjectSchema` and `bitmapSchema` of `BitmapWrapper` in `@matter/types` 0.18.0).
- **Rejecting an untagged `number` outside the safe range in the conversion**: without the type of the field, it also rejected a number with decimals of magnitude 2^53 or more, which a field with decimals takes.
- **Exact JSON numbers with `JSON.rawJSON` and a reviver that reads `context.source`**: a client that does nothing special still rounds without notice, and a reviver that decides by the text reads a large number with decimals as an integer, as `JSON.stringify` writes 2^60 as `1152921504606847000`.

## Consequences

Values have a single form on the bus, in the log, on the wire and in whatever is stored, and two values compare by their structure.
Sorting or arithmetic with an integer outside the safe range needs `BigInt(value.$integer)`.
A client can still receive an untagged number outside the safe range, and it is a double.
A device that reports NaN or an infinity shows as `null`.
When the SDK checks that an integer is one, the check of decimals in `request.ts` can go; the check of the safe range stays.
When the SDK rejects what it would not send as given, the comparison in `request.ts` can go.
With the update to 0.18.1, which sizes texts by their bytes, the check of texts in `request.ts` goes.
Clients handle the two tags, which `docs/protocol.md` will describe with the server.
