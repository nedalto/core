/** A value inside a message, in either direction between client and hub. */
export type WireValue =
    | string
    | number
    | bigint
    | boolean
    | null
    | readonly WireValue[]
    | { readonly [key: string]: WireValue };
