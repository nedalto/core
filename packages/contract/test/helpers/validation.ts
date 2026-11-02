import assert from "node:assert/strict";

import { ValidationError } from "../../src/common/errors.ts";

/** The path of each issue of the `ValidationError` that `validate` throws for `input`. */
export function rejectedPaths(validate: (input: unknown) => unknown, input: unknown): unknown[] {
    try {
        validate(input);
    } catch (error) {
        assert.ok(error instanceof ValidationError);
        return error.data.issues.map((issue) => issue.path);
    }
    return assert.fail(`expected ${JSON.stringify(input)} to be rejected`);
}
