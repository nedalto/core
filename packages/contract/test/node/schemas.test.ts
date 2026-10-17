import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createNodeId } from "../../src/common/ids.ts";
import {
    validateCommissionParams,
    validateDecommissionParams,
    validateGetInfoParams,
    validateGetParams,
    validateListParams,
} from "../../src/node/schemas.ts";
import { rejectedPaths } from "../helpers/validation.ts";

const ID = createNodeId();

describe("validateListParams", () => {
    test("accepts params that are omitted or empty, and rejects a member", () => {
        assert.doesNotThrow(() => validateListParams(undefined));
        assert.doesNotThrow(() => validateListParams({}));
        assert.deepEqual(rejectedPaths(validateListParams, { id: ID }), ["id"]);
    });
});

describe("validateGetParams", () => {
    test("returns the id", () => {
        assert.deepEqual(validateGetParams({ id: ID }), { id: ID });
    });

    test("rejects a missing id, an id that is not a UUID v7 and a member the method does not take", () => {
        assert.deepEqual(rejectedPaths(validateGetParams, {}), ["id"]);
        assert.deepEqual(rejectedPaths(validateGetParams, { id: "lamp" }), ["id"]);
        assert.deepEqual(rejectedPaths(validateGetParams, { id: ID, $bytes: "00" }), ["$bytes"]);
    });
});

describe("validateGetInfoParams", () => {
    test("returns the id", () => {
        assert.deepEqual(validateGetInfoParams({ id: ID }), { id: ID });
    });

    test("rejects a missing id and a member the method does not take", () => {
        assert.deepEqual(rejectedPaths(validateGetInfoParams, { extra: 1 }), ["id", "extra"]);
    });
});

describe("validateCommissionParams", () => {
    test("returns the setup code as it is, whatever its form", () => {
        assert.deepEqual(validateCommissionParams({ setupCode: "34970112332" }), { setupCode: "34970112332" });
        assert.deepEqual(validateCommissionParams({ setupCode: "not a code" }), { setupCode: "not a code" });
    });

    test("rejects a setup code that is missing, empty or not a string", () => {
        assert.deepEqual(rejectedPaths(validateCommissionParams, {}), ["setupCode"]);
        assert.deepEqual(rejectedPaths(validateCommissionParams, { setupCode: "" }), ["setupCode"]);
        assert.deepEqual(rejectedPaths(validateCommissionParams, { setupCode: 34970112332 }), ["setupCode"]);
    });

    test("rejects a member the method does not take", () => {
        assert.deepEqual(rejectedPaths(validateCommissionParams, { setupCode: "1", force: true }), ["force"]);
    });
});

describe("validateDecommissionParams", () => {
    test("returns the id, with force when it is given", () => {
        assert.deepEqual(validateDecommissionParams({ id: ID }), { id: ID });
        assert.deepEqual(validateDecommissionParams({ id: ID, force: false }), { id: ID, force: false });
        assert.deepEqual(validateDecommissionParams({ id: ID, force: true }), { id: ID, force: true });
    });

    test("rejects a force that is not a boolean and a member the method does not take", () => {
        assert.deepEqual(rejectedPaths(validateDecommissionParams, { id: ID, force: "yes" }), ["force"]);
        assert.deepEqual(rejectedPaths(validateDecommissionParams, { id: ID, $bytes: "00" }), ["$bytes"]);
    });
});
