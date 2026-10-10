/** The protocol version a client declares in the handshake. */
export const SCHEMA_VERSION = 1;

/** `null` is a client that declared no version. */
export const isCompatibleSchema = (clientVersion: number | null): boolean => clientVersion === SCHEMA_VERSION;
