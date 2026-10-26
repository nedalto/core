import { InternalError } from "@nedalto/contract/common/errors.ts";
import type { AttributeValue } from "@nedalto/contract/endpoint/types.ts";

const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Converts a value that the SDK delivers into an `AttributeValue`, at any depth.
 * It goes by the value and not by the Matter type of the attribute, so an integer is a `number` in the safe
 * range and a `bigint` outside it, whichever of the two the SDK used.
 * Throws `InternalError` for a value that has no `AttributeValue` form.
 * See `docs/decisions/0001-integers-and-bytes-on-the-wire.md`.
 */
export function normalizeValue(value: unknown): AttributeValue {
    switch (typeof value) {
        case "string":
        case "boolean":
            return value;
        case "number":
            // NaN and the infinities have no form on the wire, where JSON would turn them into null.
            if (!Number.isFinite(value)) {
                break;
            }
            return Number.isInteger(value) && !Number.isSafeInteger(value) ? BigInt(value) : value;
        case "bigint":
            return value >= MIN_SAFE && value <= MAX_SAFE ? Number(value) : value;
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
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("hex");
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
