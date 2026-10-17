import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createEndpointId, createRoomId } from "../../src/common/ids.ts";
import { decode } from "../../src/common/wire.ts";
import {
    validateGetParams,
    validateInvokeParams,
    validateListParams,
    validateReadParams,
    validateSetNameParams,
    validateSetRoomParams,
    validateWriteParams,
} from "../../src/endpoint/schemas.ts";
import { rejectedPaths } from "../helpers/validation.ts";

const ID = createEndpointId();
const ROOM_ID = createRoomId();
const UINT32_MAX = 4294967295;

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

describe("validateReadParams", () => {
    test("returns the endpoint, cluster and attribute, the ends of the 32-bit range included", () => {
        const params = { id: ID, clusterId: UINT32_MAX, attributeId: 0 };

        assert.deepEqual(validateReadParams(params), params);
    });

    test("rejects an id that is negative, above 32 bits, fractional, not a number or missing", () => {
        const base = { id: ID, clusterId: 6, attributeId: 0 };

        assert.deepEqual(rejectedPaths(validateReadParams, { ...base, clusterId: -1 }), ["clusterId"]);
        assert.deepEqual(rejectedPaths(validateReadParams, { ...base, clusterId: UINT32_MAX + 1 }), ["clusterId"]);
        assert.deepEqual(rejectedPaths(validateReadParams, { ...base, attributeId: 0.5 }), ["attributeId"]);
        assert.deepEqual(rejectedPaths(validateReadParams, { ...base, attributeId: "0" }), ["attributeId"]);
        assert.deepEqual(rejectedPaths(validateReadParams, { id: ID }), ["clusterId", "attributeId"]);
    });

    test("rejects a member the method does not take", () => {
        assert.deepEqual(rejectedPaths(validateReadParams, { id: ID, clusterId: 6, attributeId: 0, value: 1 }), [
            "value",
        ]);
    });
});

describe("validateWriteParams", () => {
    const base = { id: ID, clusterId: 6, attributeId: 0 };

    test("returns any value that JSON can carry, null and nested ones included", () => {
        for (const value of ["on", 2100, 1.5, true, null, [1, [2]], { level: { target: 200 }, list: [null] }]) {
            assert.deepEqual(validateWriteParams({ ...base, value }), { ...base, value }, JSON.stringify(value));
        }
    });

    test("returns an integer outside the safe range, as a bigint, exactly", () => {
        const { value } = validateWriteParams({ ...base, value: 12345678901234567890n });

        assert.equal(value, 12345678901234567890n);
    });

    test("returns a value nested as deep as a decoded message can be", () => {
        // Node 26.10: `decode` throws a RangeError at about 2500 levels, so no deeper value reaches here.
        const value = decode("[".repeat(2000) + "]".repeat(2000));

        assert.doesNotThrow(() => validateWriteParams({ ...base, value }));
    });

    test("rejects a missing value, and one that is not what JSON carries", () => {
        assert.deepEqual(rejectedPaths(validateWriteParams, base), ["value"]);
        assert.deepEqual(rejectedPaths(validateWriteParams, { ...base, value: undefined }), ["value"]);
        assert.deepEqual(rejectedPaths(validateWriteParams, { ...base, value: [() => 1] }), ["value"]);
        assert.deepEqual(rejectedPaths(validateWriteParams, { ...base, value: Number.NaN }), ["value"]);
    });

    test("rejects a key that starts with $ at any depth of the value, and in the params", () => {
        assert.deepEqual(rejectedPaths(validateWriteParams, { ...base, value: { $bytes: "00" } }), ["value"]);
        assert.deepEqual(rejectedPaths(validateWriteParams, { ...base, value: [{ a: { b: [{ $b: 1 }] } }] }), [
            "value",
        ]);
        assert.deepEqual(rejectedPaths(validateWriteParams, { ...base, value: 1, $bytes: "00" }), ["$bytes"]);
    });

    test("accepts a string that starts with $, since only keys are reserved", () => {
        assert.doesNotThrow(() => validateWriteParams({ ...base, value: "$bytes" }));
    });
});

describe("validateInvokeParams", () => {
    const base = { id: ID, clusterId: 8, commandId: 0 };

    test("returns the command, with arguments or without", () => {
        assert.deepEqual(validateInvokeParams(base), base);
        assert.deepEqual(validateInvokeParams({ ...base, args: { level: 200, time: null } }), {
            ...base,
            args: { level: 200, time: null },
        });
    });

    test("returns an argument outside the safe range, as a bigint, exactly", () => {
        const { args } = validateInvokeParams({ ...base, args: { count: 12345678901234567890n } });

        assert.deepEqual(args, { count: 12345678901234567890n });
    });

    test("rejects a key that starts with $ at any depth of the arguments", () => {
        assert.deepEqual(rejectedPaths(validateInvokeParams, { ...base, args: { $bytes: "00" } }), ["args"]);
        assert.deepEqual(rejectedPaths(validateInvokeParams, { ...base, args: { list: [{ $bytes: "00" }] } }), [
            "args",
        ]);
    });

    test("rejects a command id above 32 bits and a member the method does not take", () => {
        assert.deepEqual(rejectedPaths(validateInvokeParams, { ...base, commandId: UINT32_MAX + 1 }), ["commandId"]);
        assert.deepEqual(rejectedPaths(validateInvokeParams, { ...base, value: 1 }), ["value"]);
    });
});

describe("validateSetNameParams", () => {
    test("returns the id and the name", () => {
        assert.deepEqual(validateSetNameParams({ id: ID, name: "Lamp" }), { id: ID, name: "Lamp" });
    });

    test("rejects a name that is not valid, as rooms do, and a member the method does not take", () => {
        assert.deepEqual(rejectedPaths(validateSetNameParams, { id: ID, name: "" }), ["name"]);
        assert.deepEqual(rejectedPaths(validateSetNameParams, { id: ID, name: "x".repeat(33) }), ["name"]);
        assert.deepEqual(rejectedPaths(validateSetNameParams, { id: ID, name: "Lamp", $bytes: "00" }), ["$bytes"]);
    });
});

describe("validateSetRoomParams", () => {
    test("returns the room, or null to take the endpoint out of its room", () => {
        assert.deepEqual(validateSetRoomParams({ id: ID, roomId: ROOM_ID }), { id: ID, roomId: ROOM_ID });
        assert.deepEqual(validateSetRoomParams({ id: ID, roomId: null }), { id: ID, roomId: null });
    });

    test("rejects a room that is missing, is not an id or is not null, and a member the method does not take", () => {
        assert.deepEqual(rejectedPaths(validateSetRoomParams, { id: ID }), ["roomId"]);
        assert.deepEqual(rejectedPaths(validateSetRoomParams, { id: ID, roomId: "kitchen" }), ["roomId"]);
        assert.deepEqual(rejectedPaths(validateSetRoomParams, { id: ID, roomId: ROOM_ID, extra: 1 }), ["extra"]);
    });
});
