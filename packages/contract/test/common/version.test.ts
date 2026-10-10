import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isCompatibleSchema, SCHEMA_VERSION } from "../../src/common/version.ts";

describe("isCompatibleSchema", () => {
    test("accepts the current schema version", () => {
        assert.equal(isCompatibleSchema(SCHEMA_VERSION), true);
    });

    test("rejects an older or newer version", () => {
        assert.equal(isCompatibleSchema(SCHEMA_VERSION - 1), false);
        assert.equal(isCompatibleSchema(SCHEMA_VERSION + 1), false);
    });

    test("rejects a client that declared no version", () => {
        assert.equal(isCompatibleSchema(null), false);
    });
});
