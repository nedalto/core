import * as v from "valibot";

import { ValidationError } from "../common/errors.ts";

/**
 * Parses `input` against `schema`, or throws a `ValidationError` whose `data.issues` lists every
 * failure as `{ path, message }`. `path` is dotted (`"server.port"`) and `null` for the input itself.
 */
export function parseOrThrow<TSchema extends v.GenericSchema>(schema: TSchema, input: unknown): v.InferOutput<TSchema> {
    const result = v.safeParse(schema, input);
    if (result.success) {
        return result.output;
    }
    throw new ValidationError("Invalid input", {
        data: {
            issues: result.issues.map((issue) => ({
                path: v.getDotPath(issue),
                message: issue.message,
            })),
        },
    });
}
