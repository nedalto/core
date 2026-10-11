import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as v from "valibot";

import { ValidationError } from "../../src/common/errors.ts";
import { parseOrThrow } from "../../src/internal/valibot.ts";

const schema = v.object({ user: v.object({ email: v.string() }), age: v.number() });

/** The `path` of each issue in the `ValidationError` that parsing `input` throws. */
function issuePaths(input: unknown): unknown[] {
    try {
        parseOrThrow(schema, input);
    } catch (error) {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.code, "VALIDATION_ERROR");
        const issues = error.data?.issues;
        assert.ok(Array.isArray(issues));
        return issues.map((issue) => {
            assert.ok(typeof issue === "object" && issue !== null && "path" in issue);
            assert.equal(typeof issue.message, "string");
            return issue.path;
        });
    }
    return assert.fail("expected parseOrThrow to throw");
}

describe("parseOrThrow", () => {
    test("returns the parsed output when the input is valid", () => {
        const input = { user: { email: "ada@example.com" }, age: 36 };

        assert.deepEqual(parseOrThrow(schema, input), input);
    });

    test("returns the output of the schema, not the input", () => {
        const trimmed = v.pipe(
            v.string(),
            v.transform((text) => text.trim()),
        );

        assert.equal(parseOrThrow(trimmed, "  ada  "), "ada");
    });

    test("lists every failing field by its dotted path when the input is invalid", () => {
        assert.deepEqual(issuePaths({ user: { email: 123 }, age: "old" }), ["user.email", "age"]);
    });

    test("reports a null path when the input itself is invalid", () => {
        assert.deepEqual(issuePaths(null), [null]);
    });
});
