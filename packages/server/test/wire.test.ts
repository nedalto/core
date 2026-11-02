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
import { createEndpointId } from "@nedalto/contract/common/ids.ts";
import { encode } from "@nedalto/contract/common/wire.ts";
import { InteractionRejectedError } from "@nedalto/contract/endpoint/errors.ts";
import { CommissioningFailedError } from "@nedalto/contract/node/errors.ts";
import { JsonRpcErrorCode } from "@nedalto/contract/server/types.ts";

import { logRequestFailure, parseClientMessage, toJsonRpcError } from "../src/wire.ts";
import { RecordingLogger } from "./helpers/logger.ts";

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
        const error = new ValidationError("Invalid input", { issues: [{ path: "name", message: "too long" }] });

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

describe("logRequestFailure", () => {
    const METHOD = "node.commission";
    const CAUSE = new RangeError("no device answered");

    function logged(error: unknown): RecordingLogger {
        const logger = new RecordingLogger();
        logRequestFailure(logger, METHOD, error);
        return logger;
    }

    test("writes at error what is not an AppError and an InternalError, with the error", () => {
        for (const error of [new TypeError("bug"), "bug", new InternalError("bug", { cause: CAUSE })]) {
            assert.deepEqual(logged(error).calls, [
                { level: "error", values: ["handler failed unexpectedly", METHOD, error] },
            ]);
        }
    });

    test("writes at warn the whole error for an IntegrationError of the base class", () => {
        for (const error of [
            new IntegrationError("Commissioning failed", { cause: CAUSE }),
            new IntegrationError("no"),
        ]) {
            assert.deepEqual(logged(error).calls, [{ level: "warn", values: ["request failed", METHOD, error] }]);
        }
    });

    test("writes at info the code, message, data and cause of a subclass of IntegrationError", () => {
        const error = new CommissioningFailedError("not-found", CAUSE);

        assert.deepEqual(logged(error).calls, [
            {
                level: "info",
                values: [
                    "request failed",
                    METHOD,
                    "INTEGRATION_ERROR",
                    "Commissioning failed: not-found",
                    { reason: "not-found" },
                    "cause:",
                    "RangeError: no device answered",
                ],
            },
        ]);
    });

    test("writes at info any other error with a cause, leaving out the data it does not have", () => {
        const error = new ConflictError("Taken", { cause: CAUSE });

        assert.deepEqual(logged(error).calls, [
            {
                level: "info",
                values: [
                    "request failed",
                    METHOD,
                    "CONFLICT_ERROR",
                    "Taken",
                    "cause:",
                    "RangeError: no device answered",
                ],
            },
        ]);
    });

    test("writes at info an error the device decided, without the cause it does not have", () => {
        const error = new InteractionRejectedError(createEndpointId(), 6, { commandId: 1 }, 0x87);

        assert.deepEqual(logged(error).calls, [
            { level: "info", values: ["request failed", METHOD, "INTEGRATION_ERROR", error.message, error.data] },
        ]);
    });

    test("writes as text a cause that is not an Error", () => {
        const [call] = logged(new UnreachableError("Asleep", { cause: 42 })).calls;

        assert.deepEqual(call?.values.slice(-2), ["cause:", "42"]);
    });

    test("names a cause by its class when its name is that of Error, as those of the SDK are", () => {
        class DeviceGoneError extends Error {}
        const [call] = logged(new UnreachableError("Asleep", { cause: new DeviceGoneError("gone") })).calls;

        assert.deepEqual(call?.values.slice(-2), ["cause:", "DeviceGoneError: gone"]);
    });

    test("writes only the direct cause, without going down the chain", () => {
        const direct = new Error("direct", { cause: new Error("deeper") });
        const [call] = logged(new UnreachableError("Asleep", { cause: direct })).calls;

        assert.deepEqual(call?.values.slice(-2), ["cause:", "Error: direct"]);
    });

    test("writes nothing for a ValidationError, even with a cause", () => {
        const error = new ValidationError("Invalid input", { cause: CAUSE, issues: [] });

        assert.deepEqual(logged(error).calls, []);
    });

    test("writes nothing for the checks of the hub itself, which have no cause", () => {
        for (const error of [new NotFoundError("No such room"), new ConflictError("Taken")]) {
            assert.deepEqual(logged(error).calls, []);
        }
    });
});
