import type { RoomId } from "../common/ids.ts";
import type { NoParams } from "../internal/valibot.ts";
import type { RoomAddParams, RoomGetParams, RoomRemoveParams, RoomSetNameParams } from "../room/schemas.ts";
import type { RoomState } from "../room/types.ts";
import type { Snapshot } from "../snapshot.ts";

/** The `code` of a JSON-RPC error. The code of an `AppError` travels in `data.code`. */
export const JsonRpcErrorCode = {
    ParseError: -32700,
    InvalidRequest: -32600,
    MethodNotFound: -32601,

    /** Also where a `ValidationError` lands. */
    InvalidParams: -32602,

    /** Every `AppError` but `ValidationError`. */
    ApplicationError: -32000,
} as const satisfies Record<string, number>;

export type JsonRpcErrorCode = (typeof JsonRpcErrorCode)[keyof typeof JsonRpcErrorCode];

/** The code with which the hub closes a connection whose handshake it refuses, in the range RFC 6455 leaves to applications. */
export const HandshakeCloseCode = {
    /** The token is missing or wrong. */
    Unauthorized: 4401,

    /** The client declared no schema version, or one the hub does not speak. */
    SchemaVersionMismatch: 4426,
} as const satisfies Record<string, number>;

export type HandshakeCloseCode = (typeof HandshakeCloseCode)[keyof typeof HandshakeCloseCode];

/**
 * Every method of the API: the type of its params and of its `result`.
 * A method with nothing to return answers `null`.
 */
export interface MethodMap {
    "hub.subscribe": { params: NoParams; result: Snapshot };

    "room.list": { params: NoParams; result: readonly RoomState[] };
    "room.get": { params: RoomGetParams; result: RoomState };
    "room.add": { params: RoomAddParams; result: RoomId };
    "room.setName": { params: RoomSetNameParams; result: null };
    "room.remove": { params: RoomRemoveParams; result: null };
}
