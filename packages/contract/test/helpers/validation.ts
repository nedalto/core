import assert from "node:assert/strict";

import { ValidationError } from "../../src/common/errors.ts";

/** The path of each issue of the `ValidationError` that `validate` throws for `input`. */
export function rejectedPaths(validate: (input: unknown) => unknown, input: unknown): unknown[] {
    try {
        validate(input);
    } catch (error) {
        assert.ok(error instanceof ValidationError);
        const issues = error.data?.issues;
        assert.ok(Array.isArray(issues));
        return issues.map((issue) => {
            assert.ok(typeof issue === "object" && issue !== null && "path" in issue);
            return issue.path;
        });
    }
    return assert.fail(`expected ${JSON.stringify(input)} to be rejected`);
}
