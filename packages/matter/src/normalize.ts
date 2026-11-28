import { InternalError, ValidationError } from "@nedalto/contract/common/errors.ts";
import { isTaggedBytes, isTaggedInteger, type TaggedInteger } from "@nedalto/contract/common/wire.ts";
import type { AttributeValue } from "@nedalto/contract/endpoint/types.ts";

const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** The form of an integer on the wire: a `number` in the safe range and a `TaggedInteger` outside it. */
export const normalizeInteger = (value: bigint): number | TaggedInteger =>
    value >= MIN_SAFE && value <= MAX_SAFE ? Number(value) : { $integer: value.toString() };

/**
 * Converts a value that the SDK delivers into an `AttributeValue`, at any depth.
 * It goes by the value and not by the Matter type of the attribute: an integer is a `number` in the safe range and
 * a `TaggedInteger` outside it, whichever of the two the SDK used, and bytes are `TaggedBytes`.
 * NaN and the infinities become `null`.
 * Throws `InternalError` for a type that the SDK does not deliver as a value, such as a `Date`.
 * See `docs/decisions/0004-integers-and-bytes-of-device-values.md`.
 */
export function normalizeValue(value: unknown): AttributeValue {
    switch (typeof value) {
        case "string":
        case "boolean":
            return value;
        case "number":
            // @matter/protocol 0.18.0 does not check a report against the range of its field (`decodeTlv` in
            // `InputChunk.js`), so a device can report NaN or an infinity; null is the closest meaning (ADR 0004).
            return Number.isFinite(value) ? value : null;
        case "bigint":
            return normalizeInteger(value);
        case "object":
            return normalizeObject(value);
        case "function":
        case "symbol":
        case "undefined":
            break;
    }
    throw new InternalError(`The SDK delivered ${String(value)}, which is not an attribute value`);
}

function normalizeObject(value: object | null): AttributeValue {
    if (value === null) {
        return null;
    }
    if (value instanceof Uint8Array) {
        return { $bytes: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("hex") };
    }
    if (Array.isArray(value)) {
        return value.map(normalizeValue);
    }
    // @matter/node 0.18.0: the structs and bitmaps in a node's cached state are instances of classes the SDK
    // generates, and those in a read response are plain objects; both report `[object Object]`, as a `Date` or
    // a `Map` does not. A field the device left out is `undefined`, and is left out here too.
    if (Object.prototype.toString.call(value) === "[object Object]") {
        const result: Record<string, AttributeValue> = {};
        for (const [key, field] of Object.entries(value)) {
            if (field !== undefined) {
                result[key] = normalizeValue(field);
            }
        }
        return result;
    }
    throw new InternalError(
        `The SDK delivered ${Object.prototype.toString.call(value)}, which is not an attribute value`,
    );
}

const invalid = (path: string, message: string): ValidationError =>
    new ValidationError("Invalid input", { issues: [{ path, message }] });

/**
 * Converts a value from a client into what the SDK takes, at any depth: a `TaggedInteger` into a `number` in the
 * safe range and a `bigint` outside it, and `TaggedBytes` into a `Uint8Array`.
 * Whether the value fits its field is checked when the request is built, in `request.ts`.
 * Throws `ValidationError` with `path` for any other object with a key that starts with `$`, for NaN and the
 * infinities, and for a string that is not valid Unicode.
 * See `docs/decisions/0004-integers-and-bytes-of-device-values.md`.
 */
export function denormalizeValue(value: AttributeValue, path: string): unknown {
    if (typeof value === "number") {
        // JSON cannot carry them, but code in the hub can, and @matter/types 0.18.0 checks a number only against the
        // limits of its type, which NaN passes (`validateBoundaries` in `TlvNumber.js`).
        if (!Number.isFinite(value)) {
            throw invalid(path, `${path} holds ${value}, which is not a Matter number`);
        }
        return value;
    }
    // @matter/general 0.18.0 writes text as UTF-8 (`Bytes.fromString`), which has no form for a lone surrogate, and
    // puts U+FFFD in its place.
    if (typeof value === "string" && !value.isWellFormed()) {
        throw invalid(path, `${path} holds a string that is not valid Unicode`);
    }
    if (typeof value !== "object" || value === null) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item: AttributeValue) => denormalizeValue(item, path));
    }
    if (Object.keys(value).some((key) => key.startsWith("$"))) {
        if (isTaggedInteger(value)) {
            const integer = BigInt(value.$integer);
            // @matter/types 0.18.0: the schema of a field of up to 32 bits rejects a bigint, even a small one.
            return integer >= MIN_SAFE && integer <= MAX_SAFE ? Number(integer) : integer;
        }
        if (isTaggedBytes(value)) {
            return new Uint8Array(Buffer.from(value.$bytes, "hex"));
        }
        throw invalid(path, `${path} holds a key that starts with $ and is not a valid tag`);
    }
    // Not by assignment, which for a key `__proto__` would change the prototype instead of adding the field.
    return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, denormalizeValue(field, path)]));
}
