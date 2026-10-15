import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as v from "valibot";

import { ValidationError } from "../../src/common/errors.ts";
import { nameSchema, parseOrThrow } from "../../src/internal/valibot.ts";

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

const accepts = (name: string) => v.safeParse(nameSchema, name).success;

describe("nameSchema", () => {
    test("accepts a name of at most 32 bytes in UTF-8, counting bytes and not characters", () => {
        assert.equal(accepts("a".repeat(32)), true);
        assert.equal(accepts("é".repeat(16)), true);
        assert.equal(accepts("💡".repeat(8)), true);
    });

    test("rejects a name of more than 32 bytes in UTF-8, though it has fewer than 32 characters", () => {
        assert.equal(accepts("a".repeat(33)), false);
        assert.equal(accepts("é".repeat(17)), false);
        assert.equal(accepts("💡".repeat(9)), false);
    });

    test("rejects an empty name and what is not a string", () => {
        assert.equal(accepts(""), false);
        assert.equal(v.safeParse(nameSchema, 5).success, false);
    });

    test("rejects U+001F, instead of cutting the name there", () => {
        assert.equal(accepts("Kitchen\u001f"), false);
        assert.equal(accepts("Kit\u001fchen"), false);
    });

    test("returns the name as it is, without normalizing it", () => {
        const decomposed = "é";

        assert.equal(parseOrThrow(nameSchema, decomposed), decomposed);
    });

    test("accepts emoji", () => {
        assert.equal(accepts("Lights 💡"), true);
    });
});
