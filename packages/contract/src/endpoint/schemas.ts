import * as v from "valibot";

import {
    endpointIdSchema,
    nameSchema,
    type NoParams,
    noParamsSchema,
    parseOrThrow,
    roomIdSchema,
} from "../internal/valibot.ts";
import type { AttributeValue } from "./types.ts";

// An unsigned 32-bit integer: whether Matter can address it is for the gateway to decide.
const matterIdSchema = v.pipe(v.number(), v.integer("must be an integer"), v.minValue(0), v.maxValue(0xffffffff));

function isAttributeValue(value: unknown): boolean {
    if (Array.isArray(value)) {
        return value.every(isAttributeValue);
    }
    if (typeof value === "object" && value !== null) {
        return Object.entries(value).every(([key, item]) => !key.startsWith("$") && isAttributeValue(item));
    }
    return (
        typeof value === "string" ||
        typeof value === "bigint" ||
        typeof value === "boolean" ||
        value === null ||
        (typeof value === "number" && Number.isFinite(value))
    );
}

const attributeValueSchema = v.custom<AttributeValue>(
    isAttributeValue,
    "must be a JSON value, with no key that starts with $ at any depth",
);

// Strict, so a key the method does not take is rejected, the `$` keys the protocol reserves among them.
const getParamsSchema = v.strictObject({ id: endpointIdSchema });
const readParamsSchema = v.strictObject({
    id: endpointIdSchema,
    clusterId: matterIdSchema,
    attributeId: matterIdSchema,
});
const writeParamsSchema = v.strictObject({
    id: endpointIdSchema,
    clusterId: matterIdSchema,
    attributeId: matterIdSchema,
    value: attributeValueSchema,
});
const invokeParamsSchema = v.strictObject({
    id: endpointIdSchema,
    clusterId: matterIdSchema,
    commandId: matterIdSchema,
    args: v.optional(attributeValueSchema),
});
const setNameParamsSchema = v.strictObject({ id: endpointIdSchema, name: nameSchema });
const setRoomParamsSchema = v.strictObject({ id: endpointIdSchema, roomId: v.nullable(roomIdSchema) });

export type EndpointGetParams = v.InferOutput<typeof getParamsSchema>;
export type EndpointReadParams = v.InferOutput<typeof readParamsSchema>;
export type EndpointWriteParams = v.InferOutput<typeof writeParamsSchema>;
export type EndpointInvokeParams = v.InferOutput<typeof invokeParamsSchema>;
export type EndpointSetNameParams = v.InferOutput<typeof setNameParamsSchema>;
export type EndpointSetRoomParams = v.InferOutput<typeof setRoomParamsSchema>;

/** Throws a `ValidationError` listing every issue if `input` is not what `endpoint.list` takes. */
export const validateListParams = (input: unknown): NoParams => parseOrThrow(noParamsSchema, input);

/** Each validator below throws a `ValidationError` listing every issue, or returns the typed params. */
export const validateGetParams = (input: unknown): EndpointGetParams => parseOrThrow(getParamsSchema, input);
export const validateReadParams = (input: unknown): EndpointReadParams => parseOrThrow(readParamsSchema, input);
export const validateWriteParams = (input: unknown): EndpointWriteParams => parseOrThrow(writeParamsSchema, input);
export const validateInvokeParams = (input: unknown): EndpointInvokeParams => parseOrThrow(invokeParamsSchema, input);
export const validateSetNameParams = (input: unknown): EndpointSetNameParams =>
    parseOrThrow(setNameParamsSchema, input);
export const validateSetRoomParams = (input: unknown): EndpointSetRoomParams =>
    parseOrThrow(setRoomParamsSchema, input);
