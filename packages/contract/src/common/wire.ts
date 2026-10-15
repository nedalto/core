/** A value inside a message, in either direction between client and hub. */
export type WireValue =
    | string
    | number
    | bigint
    | boolean
    | null
    | readonly WireValue[]
    | { readonly [key: string]: WireValue };

// TypeScript 7.0.2 does not type `JSON.rawJSON` or the `context` argument of a reviver.
declare global {
    interface JSON {
        rawJSON(text: string): { readonly rawJSON: string };
        parse(
            text: string,
            reviver: (
                this: unknown,
                key: string,
                value: unknown,
                // Node 26.10: `source` is only there for primitives, not for objects and arrays.
                context: { readonly source?: string },
            ) => unknown,
        ): unknown;
    }
}

const INTEGER_LITERAL = /^-?\d+$/;

/**
 * Parses a frame. An integer literal that is not a safe integer comes out as a `bigint`, exactly;
 * every other number comes out as `JSON.parse` gives it.
 */
export const decode = (text: string): unknown =>
    JSON.parse(text, (_key, value, { source }) =>
        typeof value === "number" &&
        source !== undefined &&
        !Number.isSafeInteger(value) &&
        INTEGER_LITERAL.test(source)
            ? BigInt(source)
            : value,
    );

/** Writes a frame. A `bigint` is written as a JSON number, however large. */
export const encode = (value: unknown): string =>
    JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? JSON.rawJSON(item.toString()) : item));
