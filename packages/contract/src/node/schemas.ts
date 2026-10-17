import * as v from "valibot";

import { nodeIdSchema, type NoParams, noParamsSchema, parseOrThrow } from "../internal/valibot.ts";

// Strict, so a key the method does not take is rejected, the `$` keys the protocol reserves among them.
const getParamsSchema = v.strictObject({ id: nodeIdSchema });
const getInfoParamsSchema = v.strictObject({ id: nodeIdSchema });

// Only that there is a code: whether it can be read is for the gateway to decide.
const commissionParamsSchema = v.strictObject({
    setupCode: v.pipe(v.string(), v.minLength(1, "setupCode must not be empty")),
});
const decommissionParamsSchema = v.strictObject({ id: nodeIdSchema, force: v.optional(v.boolean()) });

export type NodeGetParams = v.InferOutput<typeof getParamsSchema>;
export type NodeGetInfoParams = v.InferOutput<typeof getInfoParamsSchema>;
export type NodeCommissionParams = v.InferOutput<typeof commissionParamsSchema>;
export type NodeDecommissionParams = v.InferOutput<typeof decommissionParamsSchema>;

/** Throws a `ValidationError` listing every issue if `input` is not what `node.list` takes. */
export const validateListParams = (input: unknown): NoParams => parseOrThrow(noParamsSchema, input);

/** Each validator below throws a `ValidationError` listing every issue, or returns the typed params. */
export const validateGetParams = (input: unknown): NodeGetParams => parseOrThrow(getParamsSchema, input);
export const validateGetInfoParams = (input: unknown): NodeGetInfoParams => parseOrThrow(getInfoParamsSchema, input);
export const validateCommissionParams = (input: unknown): NodeCommissionParams =>
    parseOrThrow(commissionParamsSchema, input);
export const validateDecommissionParams = (input: unknown): NodeDecommissionParams =>
    parseOrThrow(decommissionParamsSchema, input);
