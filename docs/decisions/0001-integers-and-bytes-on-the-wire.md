# 0001. Integers and bytes on the wire

Status: Accepted

## Context

Matter attributes and command fields carry integers of up to 64 bits and octet strings.
A JavaScript `number` is exact only up to 2^53 - 1, and `JSON.stringify` throws on a `bigint`.
Most quantities fit a `number`, but 64-bit identifiers such as node and fabric ids do not.

The SDK does not choose between `number` and `bigint` by the field or by the value, but by the width the device encoded the integer with in TLV: a uint64 of 5 encoded in one byte arrives as `5`, and encoded in eight bytes, which is just as valid, as `5n` (`@matter/types` 0.17.9, `TlvCodec.readPrimitive`).

## Decision

An integer has one canonical form, decided by its value: a `number` if it is a safe integer, and a `bigint` otherwise.
`packages/matter` normalizes every value from the SDK to that form at any depth, and writes bytes as lowercase hexadecimal without a prefix.

On the wire, integers are always JSON numbers, written and read exactly: `JSON.rawJSON` for a `bigint` on the way out, and a reviver that reads `context.source` on the way in (`packages/contract/src/common/wire.ts`).
A client reads them the same way, with no schema, and the same value always has the same type, so `===` works across the system.

Keys that start with `$` are reserved, so that bytes sent by a client can later be tagged as `{"$bytes": "<hex>"}`; until a method needs that, a `$` key is invalid params.

What a client must do is in [the protocol](../protocol.md#encoding).

## Alternatives

- **Pass on the type the SDK returns**: the type of a value would depend on how each device encodes it, so `5` and `5n` would both reach clients for the same attribute.
- **Normalize by the Matter type of the field**: it requires walking the data model, which changes between SDK versions, and the wire would erase it anyway, since JSON writes `5` and `5n` the same way; the client would need the model too.
- **64-bit integers as strings**: the usual answer in JSON APIs, but a string cannot be told from a number without the schema, and a value would change type when it crosses 2^53.
- **Integers in hexadecimal**: Matter documents ids in hex, but `BigInt("-0x1f4")` throws and negative values would need two's complement and their width; hex is how people read Matter ids, so error messages write them that way, and the numbers stay in `data`.
- **Bytes as Base64**: the usual encoding for bytes in JSON, but hex is readable for what Matter puts in octet strings (MAC addresses, IP addresses, SSIDs), compares with `===`, and those values are short.

## Consequences

A client compares with canonical literals (`value === 5`, never `5n`) and converts with `Number()` or `BigInt()` before arithmetic, because mixing the two types throws.
Clients outside JavaScript need a JSON parser that keeps large integers exact, as Python's `json` does by default.
Accepting `{"$bytes"}` is additive and needs no new `SCHEMA_VERSION`.
