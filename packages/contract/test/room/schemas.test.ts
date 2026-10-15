import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ValidationError } from "../../src/common/errors.ts";
import { createRoomId } from "../../src/common/ids.ts";
import {
    validateAddParams,
    validateGetParams,
    validateListParams,
    validateRemoveParams,
    validateSetNameParams,
} from "../../src/room/schemas.ts";

const ID = createRoomId();

/** The path of each issue of the `ValidationError` that `validate` throws for `input`. */
function rejectedPaths(validate: (input: unknown) => unknown, input: unknown): unknown[] {
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

describe("validateListParams", () => {
    test("accepts params that are omitted or empty", () => {
        assert.doesNotThrow(() => validateListParams(undefined));
        assert.doesNotThrow(() => validateListParams({}));
    });

    test("rejects a member", () => {
        assert.deepEqual(rejectedPaths(validateListParams, { id: ID }), ["id"]);
    });
});

describe("validateGetParams", () => {
    test("returns the id", () => {
        assert.deepEqual(validateGetParams({ id: ID }), { id: ID });
    });

    test("rejects a missing id and an id that is not a UUID v7", () => {
        assert.deepEqual(rejectedPaths(validateGetParams, {}), ["id"]);
        assert.deepEqual(rejectedPaths(validateGetParams, { id: "kitchen" }), ["id"]);
    });

    test("rejects a member the method does not take, the ones that start with $ among them", () => {
        assert.deepEqual(rejectedPaths(validateGetParams, { id: ID, extra: 1 }), ["extra"]);
        assert.deepEqual(rejectedPaths(validateGetParams, { id: ID, $bytes: "00" }), ["$bytes"]);
    });
});

describe("validateAddParams", () => {
    test("returns the name", () => {
        assert.deepEqual(validateAddParams({ name: "Kitchen" }), { name: "Kitchen" });
    });

    test("rejects a name that is missing, not a string or not valid, listing every issue", () => {
        assert.deepEqual(rejectedPaths(validateAddParams, {}), ["name"]);
        assert.deepEqual(rejectedPaths(validateAddParams, { name: 5 }), ["name"]);
        assert.deepEqual(rejectedPaths(validateAddParams, { name: "", extra: 1 }), ["name", "extra"]);
    });

    test("rejects a member that starts with $", () => {
        assert.deepEqual(rejectedPaths(validateAddParams, { name: "Kitchen", $bytes: "00" }), ["$bytes"]);
    });
});

describe("validateSetNameParams", () => {
    test("returns the id and the name", () => {
        assert.deepEqual(validateSetNameParams({ id: ID, name: "Hall" }), { id: ID, name: "Hall" });
    });

    test("rejects what is missing or not valid, listing every issue", () => {
        assert.deepEqual(rejectedPaths(validateSetNameParams, { id: "x" }), ["id", "name"]);
    });

    test("rejects a member that starts with $", () => {
        assert.deepEqual(rejectedPaths(validateSetNameParams, { id: ID, name: "Hall", $bytes: "00" }), ["$bytes"]);
    });
});

describe("validateRemoveParams", () => {
    test("returns the id", () => {
        assert.deepEqual(validateRemoveParams({ id: ID }), { id: ID });
    });

    test("rejects a missing id and a member the method does not take", () => {
        assert.deepEqual(rejectedPaths(validateRemoveParams, { name: "Hall" }), ["id", "name"]);
    });
});
