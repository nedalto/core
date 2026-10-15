import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    ConflictError,
    IntegrationError,
    InternalError,
    NotFoundError,
    UnreachableError,
    ValidationError,
} from "@nedalto/contract/common/errors.ts";
import { encode } from "@nedalto/contract/common/wire.ts";
import { JsonRpcErrorCode } from "@nedalto/contract/server/types.ts";

import { isUnexpected, parseClientMessage, toJsonRpcError } from "../src/wire.ts";

describe("parseClientMessage", () => {
    test("returns a request when the message has an id", () => {
        const outcome = parseClientMessage('{"jsonrpc":"2.0","method":"room.get","params":{"id":"x"},"id":7}');

        assert.deepEqual(outcome, { request: { jsonrpc: "2.0", method: "room.get", params: { id: "x" }, id: 7 } });
    });

    test("returns a notification when the message has no id", () => {
        const outcome = parseClientMessage('{"jsonrpc":"2.0","method":"room.list"}');

        assert.deepEqual(outcome, { notification: { jsonrpc: "2.0", method: "room.list" } });
    });

    test("keeps an integer outside the safe range in the params of a request, exactly", () => {
        const outcome = parseClientMessage('{"jsonrpc":"2.0","method":"m","params":{"n":12345678901234567890},"id":1}');

        assert.ok("request" in outcome);
        assert.deepEqual(outcome.request.params, { n: 12345678901234567890n });
    });

    test("answers a parse error when the text is not JSON", () => {
        const outcome = parseClientMessage("{ not json");

        assert.ok("error" in outcome);
        assert.equal(outcome.error.id, null);
        assert.equal(outcome.error.error.code, JsonRpcErrorCode.ParseError);
    });

    test("answers an invalid request, listing the issues, when the envelope is wrong", () => {
        const outcome = parseClientMessage('{"method":"room.list","id":1}');

        assert.ok("error" in outcome);
        assert.equal(outcome.error.id, null);
        assert.equal(outcome.error.error.code, JsonRpcErrorCode.InvalidRequest);
        const data = outcome.error.error.data;
        assert.ok(typeof data === "object" && data !== null && "issues" in data && Array.isArray(data.issues));
        assert.ok(!("code" in data));
    });

    test("answers an invalid request when the message is a batch", () => {
        const outcome = parseClientMessage('[{"jsonrpc":"2.0","method":"room.list","id":1}]');

        assert.ok("error" in outcome);
        assert.equal(outcome.error.error.code, JsonRpcErrorCode.InvalidRequest);
    });

    test("answers an invalid request, not a notification, when the id has the wrong type", () => {
        const outcome = parseClientMessage('{"jsonrpc":"2.0","method":"room.list","id":{}}');

        assert.ok("error" in outcome);
        assert.equal(outcome.error.error.code, JsonRpcErrorCode.InvalidRequest);
    });

    test("answers invalid params under the id of the request when the params are by position", () => {
        const outcome = parseClientMessage('{"jsonrpc":"2.0","method":"room.get","params":["x"],"id":"a"}');

        assert.ok("error" in outcome);
        assert.equal(outcome.error.id, "a");
        assert.equal(outcome.error.error.code, JsonRpcErrorCode.InvalidParams);
        assert.partialDeepStrictEqual(outcome.error.error.data, { code: "VALIDATION_ERROR" });
    });
});

describe("toJsonRpcError", () => {
    test("maps a ValidationError to invalid params, with its data and its code", () => {
        const error = new ValidationError("Invalid input", {
            data: { issues: [{ path: "name", message: "too long" }] },
        });

        assert.deepEqual(toJsonRpcError(error), {
            code: JsonRpcErrorCode.InvalidParams,
            message: "Invalid input",
            data: { issues: [{ path: "name", message: "too long" }], code: "VALIDATION_ERROR" },
        });
    });

    test("maps any other AppError to an application error, with its message, its data and its code", () => {
        for (const [error, code] of [
            [new NotFoundError("No such room", { data: { roomId: "r" } }), "NOT_FOUND_ERROR"],
            [new ConflictError("Taken", { data: { roomId: "r" } }), "CONFLICT_ERROR"],
            [new IntegrationError("Disk full", { data: { roomId: "r" } }), "INTEGRATION_ERROR"],
            [new UnreachableError("Asleep", { data: { roomId: "r" } }), "UNREACHABLE_ERROR"],
        ] as const) {
            assert.deepEqual(toJsonRpcError(error), {
                code: JsonRpcErrorCode.ApplicationError,
                message: error.message,
                data: { roomId: "r", code },
            });
        }
    });

    test("puts the code of the error last, so that the data cannot replace it", () => {
        const error = new NotFoundError("No such room", { data: { code: "other" } });

        assert.partialDeepStrictEqual(toJsonRpcError(error).data, { code: "NOT_FOUND_ERROR" });
    });

    test("hides the message of an InternalError and of anything that is not an AppError", () => {
        for (const error of [new InternalError("secret detail"), new Error("secret detail"), "secret detail"]) {
            assert.deepEqual(toJsonRpcError(error), {
                code: JsonRpcErrorCode.ApplicationError,
                message: "Internal error",
                data: { code: "INTERNAL_ERROR" },
            });
        }
    });

    test("does not send the cause", () => {
        const error = new NotFoundError("No such room", { cause: new Error("secret cause") });

        assert.ok(!encode(toJsonRpcError(error)).includes("secret cause"));
    });
});

describe("isUnexpected", () => {
    test("is true for an InternalError and for what is not an AppError", () => {
        assert.equal(isUnexpected(new InternalError("bug")), true);
        assert.equal(isUnexpected(new TypeError("bug")), true);
        assert.equal(isUnexpected("bug"), true);
    });

    test("is false for the other AppErrors", () => {
        assert.equal(isUnexpected(new NotFoundError("no")), false);
        assert.equal(isUnexpected(new ValidationError("no")), false);
    });
});
