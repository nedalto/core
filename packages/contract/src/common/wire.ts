/**
 * An integer as its canonical decimal.
 * The hub writes it only outside the safe range, ±(2^53 − 1), and accepts it inside the range too.
 */
export type TaggedInteger = { readonly $integer: string };

/** Bytes, as lowercase hexadecimal. */
export type TaggedBytes = { readonly $bytes: string };

/**
 * A value inside a message, in either direction between client and hub: plain JSON, where an integer outside the
 * safe range is a `TaggedInteger`, bytes are `TaggedBytes`, and keys that start with `$` are reserved for these tags.
 * See `docs/decisions/0004-integers-and-bytes-of-device-values.md`.
 */
export type WireValue = string | number | boolean | null | readonly WireValue[] | { readonly [key: string]: WireValue };

// Twenty digits hold any 64-bit integer, and the cap spares `BigInt` a long text, which it parses with the event loop
// stopped. @matter/types 0.18.0 checks the exact range of the field.
const INTEGER = /^(0|-?[1-9][0-9]{0,19})$/;
const BYTES = /^(?:[0-9a-f]{2})*$/;

// The text of a tag: an object whose only key is `key`, with a string under it.
function tagText(value: unknown, key: string): string | undefined {
    if (typeof value !== "object" || value === null) {
        return undefined;
    }
    const entries = Object.entries(value);
    const [entry] = entries;
    if (entries.length !== 1 || entry === undefined) {
        return undefined;
    }
    const [name, text] = entry;
    return name === key && typeof text === "string" ? text : undefined;
}

/** Whether `value` is a `TaggedInteger` with a canonical decimal. */
export function isTaggedInteger(value: unknown): value is TaggedInteger {
    const text = tagText(value, "$integer");
    return text !== undefined && INTEGER.test(text);
}

/** Whether `value` is a `TaggedBytes` with an even number of lowercase hexadecimal digits. */
export function isTaggedBytes(value: unknown): value is TaggedBytes {
    const text = tagText(value, "$bytes");
    return text !== undefined && BYTES.test(text);
}
