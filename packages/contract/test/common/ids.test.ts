import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { inspect } from "node:util";

import { createEndpointId, createNodeId, createRoomId, isUuidV7 } from "../../src/common/ids.ts";

for (const [name, create] of [
    ["createNodeId", createNodeId],
    ["createEndpointId", createEndpointId],
    ["createRoomId", createRoomId],
] as const) {
    describe(name, () => {
        test("returns an id that isUuidV7 accepts", () => {
            assert.equal(isUuidV7(create()), true);
        });

        test("returns a different id on each call", () => {
            assert.notEqual(create(), create());
        });
    });
}

describe("isUuidV7", () => {
    test("accepts a lowercase UUID v7", () => {
        assert.equal(isUuidV7("017f22e2-79b0-7cc3-98c4-dc0c0c07398f"), true);
    });

    test("rejects values that are not strings", () => {
        // The array stringifies to a valid id.
        for (const value of [undefined, null, 42, ["017f22e2-79b0-7cc3-98c4-dc0c0c07398f"]]) {
            assert.equal(isUuidV7(value), false, `accepted ${inspect(value)}`);
        }
    });

    test("rejects malformed strings", () => {
        for (const value of ["", "not-a-uuid", "017f22e2-79b0-7cc3-98c4", "017f22e2-79b0-7cc3-98c4-dc0c0c07398f0"]) {
            assert.equal(isUuidV7(value), false, `accepted ${value}`);
        }
    });

    test("rejects other UUID versions", () => {
        for (const value of ["017f22e2-79b0-1cc3-98c4-dc0c0c07398f", "017f22e2-79b0-4cc3-98c4-dc0c0c07398f"]) {
            assert.equal(isUuidV7(value), false, `accepted ${value}`);
        }
    });

    test("rejects a variant other than RFC 9562", () => {
        assert.equal(isUuidV7("017f22e2-79b0-7cc3-c8c4-dc0c0c07398f"), false);
    });

    test("rejects uppercase hex", () => {
        assert.equal(isUuidV7("017F22E2-79B0-7CC3-98C4-DC0C0C07398F"), false);
    });
});
