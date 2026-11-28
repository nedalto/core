# 0004. Integers and bytes of device values

Status: Accepted

## Context

Matter attributes, command fields and command responses carry integers of up to 64 bits and octet strings.
JSON, which carries them to clients, is interoperable only for integers within ±(2^53 − 1) (RFC 8259 §6, RFC 7493 §2.2): a client that reads values without a schema rounds a larger one without notice, as `JSON.parse` and Go's `json.Unmarshal` into `any` do.
In Matter, what goes beyond 2^53 are identifiers: node ids, ACL subjects with CATs, the fabric id, Thread addresses.
A rounded identifier names something else: the subject `0xFFFFFFFD00010001` arrives as `0xFFFFFFFD00010000`.

The SDK does not choose between `number` and `bigint` for a 64-bit field by the value, but by the width the device encoded the integer with: a uint64 of 5 encoded in one byte arrives as `5`, and encoded in eight bytes as `5n` (`TlvLongNumberSchema` in `@matter/types` 0.18.0).
It delivers octet strings as `Uint8Array`, and the structs in the state it keeps as instances of classes it generates.
It does not check the reports it decodes (`decodeTlv` in `InputChunk.js` of `@matter/protocol` 0.18.0), so a device can report NaN or an infinity.
And its checks of what it sends let through values that do not reach the device as given (`@matter/types` 0.18.0):

- An integer field takes a number with decimals, and the device receives it truncated: 300.7 in a `uint16` arrives as 300 (`TlvNumber.js`, [matter-js/matter.js#5036](https://github.com/matter-js/matter.js/issues/5036)).
- A struct takes fields that it does not have, and leaves them out of the request (`TlvObject.js`).
- A bitmap has no check of its own: it takes from an object only its flags, so a number goes as no flag at all, and the number of a field wider than one bit goes as it is, into the bits of the next fields (`BitmapSchema.js`).
- A text is sized by its UTF-16 units and written as UTF-8, so a text of up to 255 units and more than 255 bytes goes with a length that does not fit, and the device cannot read the request (`TlvString.js`, fixed in 0.18.1 by [matter-js/matter.js#4995](https://github.com/matter-js/matter.js/pull/4995)).

## Decision

A value is plain JSON, inside the hub as on the wire:

- An integer within ±(2^53 − 1) is a `number`, and any other is `{ "$integer": "<canonical decimal>" }`.
- Bytes are `{ "$bytes": "<lowercase hex>" }`.
- Keys that start with `$` are reserved for these tags.

The same form holds for everything that crosses the wire: `NodeInfo.matterId` and the `data` of errors are `WireValue` too.

`packages/matter/src/normalize.ts` converts in both directions, at any depth, by the value and in one place.
From the SDK, `normalizeValue` turns a `bigint` into a `number` or an `$integer`, a `Uint8Array` into `$bytes`, and structs into plain objects without the fields the device left out.
A `number` from the SDK is kept as it is, also outside the safe range, where it is already a double that a tag would not make exact.
NaN and the infinities become `null`, the closest meaning, and what `JSON.stringify` writes for them.
Towards the SDK, `denormalizeValue` turns the value of a write and the arguments of a command back:

- An `$integer` becomes a `number` in the safe range and a `bigint` outside it; a tag within the safe range is accepted, so a typed client can always tag its 64-bit fields.
- `$bytes` becomes a `Uint8Array`.
- A tag is an object with that single key and a canonical decimal of at most 20 digits, or an even number of lowercase hex digits (`packages/contract/src/common/wire.ts`); any other object with a key that starts with `$` is a `ValidationError`.
- NaN and the infinities are a `ValidationError`: JSON cannot carry them, but code in the hub can, and the SDK would send NaN, which passes its range check (`validateBoundaries` in `TlvNumber.js`).
- A string that is not well-formed Unicode is a `ValidationError`: Matter carries text as UTF-8, which has no form for a lone surrogate, and the SDK would send U+FFFD in its place.

Whether a value fits its field is checked by type when the request is built, in `packages/matter/src/request.ts`; the conversion goes by the value, and rejects only what no field takes.
The schemas of the SDK check the type and the range of each field (on a write, `request.ts` runs that check, as `Write()` does not), and `request.ts` rejects with a `ValidationError` what they let through:

- In an integer field, a `number` with decimals, and one outside the safe range, with a message that asks for `$integer`: JSON has already rounded it, as every integer literal beyond the safe range parses to a number of magnitude 2^53 or more.
  An integer field is told by the TLV type of its element in the request the SDK builds, which keeps each value as given, so the check needs no model.
- In a command, a text that the SDK would send with a length that does not fit: the check compares the width the SDK picks for the length with the UTF-8 bytes of the text, so it rejects nothing once the SDK is fixed.
  No attribute that a client writes in the standard clusters takes a text that long.
- A field, a flag or an integer that would not reach the device as given: `request.ts` encodes the value with the schema of the attribute or the command, decodes it back, compares the two and says where they differ.
  A number with decimals only has to arrive, as its field may round it.
  The comparison sees what the SDK changes as it builds the request, not as it writes the bytes, where an integer loses its decimals and a text becomes UTF-8, which the checks above cover, and a `single` rounds; the bytes cannot be compared, as their encoding throws for an entry with `FabricIndex.OMIT_FABRIC` (ADR 0003).

## Alternatives

- **Pass on the type the SDK returns**: the type of a value would depend on how each device encodes it, so `5` and `5n` would both reach the hub for the same attribute, and `JSON.stringify` throws on a `bigint`.
- **Normalize by the Matter type of the field**: it requires walking the data model, which changes between SDK versions, and a client would need the model too to know which form to expect, also to tell bytes sent as a bare string from a text.
- **Bytes as Base64**: the usual encoding for bytes in JSON, but hex is readable for what Matter puts in octet strings (MAC addresses, IP addresses, SSIDs), and those values are short.
- **A bare string, as Protobuf writes 64-bit integers in JSON**: without the model it cannot be told from a text field.
- **MongoDB Extended JSON** (`$numberLong`, `$binary`): `$numberLong` is signed, so a node id of 2^63 or more would need its decimal type, and its bytes go in Base64 with a subtype.
- **`bigint` inside the hub, converted when writing JSON**: nothing compares these integers but by equality, which two canonical decimals keep, and every place that serializes values would need a converter.
- **Another form for NaN and the infinities**: an `InternalError` would hide the whole endpoint from `describe` and lose the report of its change, and a tag, as Protobuf and MongoDB have, would carry values that cannot go back to a device: the hub rejects NaN, and the SDK the infinities.
- **Checking the shape of a value against the model or the TLV schemas**: it repeats the rules by which the SDK encodes, so a difference with the encoder would reject a valid value or let one change, and it finds only the causes it foresees, where the comparison asks the encoder itself.
  The fields of the TLV schemas are private (`fieldDefinitions` of `ObjectSchema` and `bitmapSchema` of `BitmapWrapper` in `@matter/types` 0.18.0), and the SDK's own validator of the model (`RootSupervisor` in `@matter/node` 0.18.0) takes decimals in an integer field and fields that a struct does not have, and on a peer leaves conformance to the device.
- **Rejecting an untagged `number` outside the safe range in the conversion**: without the type of the field, it would also reject a number with decimals of magnitude 2^53 or more, which a field with decimals takes.
- **Exact JSON numbers with `JSON.rawJSON` and a reviver that reads `context.source`**: a client that does nothing special still rounds without notice, and a reviver that decides by the text reads a large number with decimals as an integer, as `JSON.stringify` writes 2^60 as `1152921504606847000`.

## Consequences

Values have a single form on the bus, in the log, on the wire and in whatever is stored, and two values compare by their structure.
Clients handle the two tags, which `docs/protocol.md` will describe with the server.
Sorting or arithmetic with an integer outside the safe range needs `BigInt(value.$integer)`.
A client can still receive an untagged number outside the safe range, and it is a double.

The checks in `request.ts` go as the SDK closes its gaps:

- With the update to 0.18.1, the check of texts.
- When the SDK checks that an integer is one, the check of decimals; the check of the safe range stays.
- When the SDK rejects what it would not send as given, the comparison.
