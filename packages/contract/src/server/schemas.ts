import * as v from "valibot";

import { type NoParams, noParamsSchema, parseOrThrow } from "../internal/valibot.ts";

const idSchema = v.union([v.string(), v.number()]);

// An array first: `v.record` accepts one too, as an object with the keys "0", "1"...
const paramsSchema = v.optional(v.union([v.array(v.unknown()), v.record(v.string(), v.unknown())]));

// Strict, because a request and a notification differ only in `id`: with unknown keys dropped, a
// request whose `id` is invalid would pass as a notification.
const notificationSchema = v.strictObject({
    jsonrpc: v.literal("2.0"),
    method: v.pipe(v.string(), v.minLength(1, "method must not be empty")),
    params: paramsSchema,
});

const requestSchema = v.strictObject({ ...notificationSchema.entries, id: idSchema });

const clientMessageSchema = v.pipe(
    v.custom((input) => !Array.isArray(input), "batches are not supported"),
    v.union([requestSchema, notificationSchema], "message must be a JSON-RPC request or notification"),
);

const errorSchema = v.strictObject({
    code: v.pipe(v.number(), v.integer()),
    message: v.string(),
    data: v.optional(v.unknown()),
});

const successResponseSchema = v.strictObject({ jsonrpc: v.literal("2.0"), id: idSchema, result: v.unknown() });

/** `id` is `null` when the request it answers could not be read. */
const errorResponseSchema = v.strictObject({ jsonrpc: v.literal("2.0"), id: v.nullable(idSchema), error: errorSchema });

const serverMessageSchema = v.union(
    [successResponseSchema, errorResponseSchema, notificationSchema],
    "message must be a JSON-RPC response or notification",
);

const namedParamsSchema = v.pipe(
    paramsSchema,
    v.check((params) => !Array.isArray(params), "params must be passed by name, not by position"),
);

export type JsonRpcId = v.InferOutput<typeof idSchema>;
export type JsonRpcRequest = v.InferOutput<typeof requestSchema>;
export type JsonRpcNotification = v.InferOutput<typeof notificationSchema>;
type NamedParams = v.InferOutput<typeof namedParamsSchema>;

export type JsonRpcError = v.InferOutput<typeof errorSchema>;
export type JsonRpcSuccessResponse = v.InferOutput<typeof successResponseSchema>;
export type JsonRpcErrorResponse = v.InferOutput<typeof errorResponseSchema>;
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

/** Throws a `ValidationError` if `input` is neither a request nor a notification, or is a batch. */
export const validateClientMessage = (input: unknown): JsonRpcRequest | JsonRpcNotification =>
    parseOrThrow(clientMessageSchema, input);

/** Throws a `ValidationError` if `input` is neither a response nor a notification. */
export const validateServerMessage = (input: unknown): JsonRpcResponse | JsonRpcNotification =>
    parseOrThrow(serverMessageSchema, input);

/** Throws a `ValidationError` if `input` is not what `hub.subscribe` takes. */
export const validateSubscribeParams = (input: unknown): NoParams => parseOrThrow(noParamsSchema, input);

/** Throws a `ValidationError` if `params` are passed by position. */
export const validateParamsByName = (params: JsonRpcRequest["params"]): NamedParams =>
    parseOrThrow(namedParamsSchema, params);
