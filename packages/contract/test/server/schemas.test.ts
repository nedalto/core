import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ValidationError } from "../../src/common/errors.ts";
import {
    validateClientMessage,
    validateParamsByName,
    validateServerMessage,
    validateSubscribeParams,
} from "../../src/server/schemas.ts";

describe("validateClientMessage", () => {
    test("returns a request, whose params can be by name or by position", () => {
        const byName = { jsonrpc: "2.0", method: "room.get", params: { id: "x" }, id: 1 };
        const byPosition = { jsonrpc: "2.0", method: "room.get", params: ["x"], id: "a" };

        assert.deepEqual(validateClientMessage(byName), byName);
        assert.deepEqual(validateClientMessage(byPosition), byPosition);
    });

    test("returns a notification when there is no id", () => {
        const notification = { jsonrpc: "2.0", method: "room.list" };

        assert.deepEqual(validateClientMessage(notification), notification);
    });

    test("rejects a batch, saying that batches are not supported", () => {
        for (const batch of [[{ jsonrpc: "2.0", method: "room.list", id: 1 }], []]) {
            assert.throws(
                () => validateClientMessage(batch),
                (error) => {
                    assert.ok(error instanceof ValidationError);
                    assert.partialDeepStrictEqual(error.data, { issues: [{ message: "batches are not supported" }] });
                    return true;
                },
            );
        }
    });

    test("rejects what is not an envelope", () => {
        for (const message of [
            null,
            "room.list",
            {},
            { method: "room.list", id: 1 },
            { jsonrpc: "1.0", method: "room.list", id: 1 },
            { jsonrpc: "2.0", id: 1 },
            { jsonrpc: "2.0", method: "", id: 1 },
            { jsonrpc: "2.0", method: "room.list", params: null, id: 1 },
            { jsonrpc: "2.0", method: "room.list", params: "x", id: 1 },
        ]) {
            assert.throws(() => validateClientMessage(message), ValidationError, JSON.stringify(message));
        }
    });

    test("rejects a request whose id is not a string or a number, instead of taking it for a notification", () => {
        for (const id of [null, {}, [], true, 1n]) {
            assert.throws(() => validateClientMessage({ jsonrpc: "2.0", method: "room.list", id }), ValidationError);
        }
    });

    test("rejects a member the envelope does not have", () => {
        assert.throws(
            () => validateClientMessage({ jsonrpc: "2.0", method: "room.list", id: 1, extra: 1 }),
            ValidationError,
        );
    });
});

describe("validateParamsByName", () => {
    test("accepts params that are omitted or an object", () => {
        assert.doesNotThrow(() => validateParamsByName(undefined));
        assert.doesNotThrow(() => validateParamsByName({ id: "x" }));
    });

    test("rejects params by position, empty or not", () => {
        assert.throws(() => validateParamsByName([]), ValidationError);
        assert.throws(() => validateParamsByName(["x"]), ValidationError);
    });
});

describe("validateSubscribeParams", () => {
    test("accepts params that are omitted or empty", () => {
        assert.doesNotThrow(() => validateSubscribeParams(undefined));
        assert.doesNotThrow(() => validateSubscribeParams({}));
    });

    test("rejects a member", () => {
        assert.throws(() => validateSubscribeParams({ $bytes: "00" }), ValidationError);
    });
});

describe("validateServerMessage", () => {
    const valid = [
        { title: "a response with a result", message: { jsonrpc: "2.0", id: 1, result: { rooms: [] } } },
        { title: "a response whose result is null", message: { jsonrpc: "2.0", id: "a", result: null } },
        {
            title: "an error response to a request that could not be read",
            message: { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
        },
        {
            title: "an error response with data",
            message: {
                jsonrpc: "2.0",
                id: 1,
                error: { code: -32000, message: "x", data: { code: "NOT_FOUND_ERROR" } },
            },
        },
        { title: "a notification", message: { jsonrpc: "2.0", method: "room:removed", params: { roomId: "r" } } },
    ];
    for (const { title, message } of valid) {
        test(`accepts ${title}`, () => {
            assert.deepEqual(validateServerMessage(message), message);
        });
    }

    const invalid = [
        { title: "a response without a result or an error", message: { jsonrpc: "2.0", id: 1 } },
        {
            title: "a response with both a result and an error",
            message: { jsonrpc: "2.0", id: 1, result: 1, error: { code: 1, message: "x" } },
        },
        { title: "a success response whose id is null", message: { jsonrpc: "2.0", id: null, result: 1 } },
        {
            title: "an error whose code is not an integer",
            message: { jsonrpc: "2.0", id: 1, error: { code: 1.5, message: "x" } },
        },
        { title: "a message of another JSON-RPC version", message: { jsonrpc: "1.0", id: 1, result: 1 } },
    ];
    for (const { title, message } of invalid) {
        test(`throws ValidationError for ${title}`, () => {
            assert.throws(
                () => validateServerMessage(message),
                (error) => error instanceof ValidationError && error.code === "VALIDATION_ERROR",
            );
        });
    }
});
