import * as v from "valibot";

import { ValidationError } from "../common/errors.ts";
import { type EndpointId, isUuidV7, type NodeId, type RoomId } from "../common/ids.ts";

/** The brand comes from the type argument, so a parsed value arrives branded with no cast at the call site. */
export const nodeIdSchema = v.custom<NodeId>(isUuidV7, "must be a UUID v7");
export const endpointIdSchema = v.custom<EndpointId>(isUuidV7, "must be a UUID v7");
export const roomIdSchema = v.custom<RoomId>(isUuidV7, "must be a UUID v7");

const NAME_MAX_BYTES = 32;
const utf8 = new TextEncoder();

// @matter/types 0.17.9: encoding a string with U+001F throws, and decoding one cuts it there.
export const nameSchema = v.pipe(
    v.string(),
    v.minLength(1, "name must not be empty"),
    v.check((name) => utf8.encode(name).length <= NAME_MAX_BYTES, `name must be at most ${NAME_MAX_BYTES} bytes`),
    v.check((name) => !name.includes("\u001f"), "name must not contain U+001F"),
);

/** The params of a method that takes none: omitted, or an object without members. */
export const noParamsSchema = v.optional(v.strictObject<Record<string, never>>({}));

export type NoParams = v.InferOutput<typeof noParamsSchema>;

/**
 * Parses `input` against `schema`, or throws a `ValidationError` with an issue for every failure.
 */
export function parseOrThrow<TSchema extends v.GenericSchema>(schema: TSchema, input: unknown): v.InferOutput<TSchema> {
    const result = v.safeParse(schema, input);
    if (result.success) {
        return result.output;
    }
    throw new ValidationError("Invalid input", {
        issues: result.issues.map((issue) => ({ path: v.getDotPath(issue), message: issue.message })),
    });
}
