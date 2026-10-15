import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { InternalError, NotFoundError, ValidationError } from "@nedalto/contract/common/errors.ts";
import { encode } from "@nedalto/contract/common/wire.ts";
import type { JsonRpcErrorResponse, JsonRpcResponse } from "@nedalto/contract/server/schemas.ts";
import { JsonRpcErrorCode } from "@nedalto/contract/server/types.ts";

import { Dispatcher } from "../src/dispatcher.ts";
import { parseClientMessage } from "../src/wire.ts";
import { RecordingLogger } from "./helpers/logger.ts";

const handlers = {
    "test.echo": (params: unknown) => params,
    "test.later": async (params: unknown) => params,
    "test.notFound": () => {
        throw new NotFoundError("missing", { data: { roomId: "r" } });
    },
    "test.invalid": () => {
        throw new ValidationError("bad", { data: { issues: [] } });
    },
    "test.internal": () => {
        throw new InternalError("bug");
    },
    "test.crash": () => {
        throw new TypeError("bug");
    },
};

const request = (method: string, params?: unknown, id: string | number = 1): string =>
    JSON.stringify({ jsonrpc: "2.0", method, params, id });

function setup() {
    const logger = new RecordingLogger();
    const dispatcher = new Dispatcher(logger, handlers);
    return { logger, dispatch: (text: string) => dispatcher.route(parseClientMessage(text)) };
}

function failure(response: JsonRpcResponse | null): JsonRpcErrorResponse {
    assert.ok(response !== null && "error" in response);
    return response;
}

describe("Dispatcher", () => {
    test("answers under the id of the request with what the handler returns", async () => {
        const { dispatch } = setup();

        assert.deepEqual(await dispatch(request("test.echo", { a: 1 }, 3)), {
            jsonrpc: "2.0",
            id: 3,
            result: { a: 1 },
        });
    });

    test("waits for a handler that returns a promise", async () => {
        const { dispatch } = setup();

        assert.deepEqual(await dispatch(request("test.later", { a: 1 }, "x")), {
            jsonrpc: "2.0",
            id: "x",
            result: { a: 1 },
        });
    });

    test("hands an integer outside the safe range to the handler and back to the frame, exactly", async () => {
        const { dispatch } = setup();
        const frame = '{"jsonrpc":"2.0","method":"test.echo","params":{"n":12345678901234567890},"id":1}';

        const response = await dispatch(frame);

        assert.ok(response !== null);
        assert.equal(encode(response), '{"jsonrpc":"2.0","id":1,"result":{"n":12345678901234567890}}');
    });

    test("answers nothing to a notification", async () => {
        const { dispatch } = setup();

        assert.equal(await dispatch('{"jsonrpc":"2.0","method":"test.echo"}'), null);
    });

    test("passes on the error response of a message that did not parse", async () => {
        const { dispatch } = setup();

        assert.equal(failure(await dispatch("{ not json")).error.code, JsonRpcErrorCode.ParseError);
    });

    test("answers method not found, naming the method, for a method it has no handler for", async () => {
        const { dispatch } = setup();

        const response = failure(await dispatch(request("test.nope", {}, 7)));

        assert.equal(response.id, 7);
        assert.equal(response.error.code, JsonRpcErrorCode.MethodNotFound);
        assert.deepEqual(response.error.data, { method: "test.nope" });
    });

    test("answers method not found for the name of a member of Object.prototype", async () => {
        const { logger, dispatch } = setup();

        const responses = await Promise.all(
            ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"].map((method) =>
                dispatch(request(method)),
            ),
        );

        for (const response of responses) {
            assert.equal(failure(response).error.code, JsonRpcErrorCode.MethodNotFound);
        }
        assert.deepEqual(logger.at("error"), []);
    });

    test("translates the error a handler throws, and logs nothing for an error of the client", async () => {
        const { logger, dispatch } = setup();

        assert.equal(failure(await dispatch(request("test.notFound"))).error.code, JsonRpcErrorCode.ApplicationError);
        assert.equal(failure(await dispatch(request("test.invalid"))).error.code, JsonRpcErrorCode.InvalidParams);
        assert.deepEqual(logger.at("error"), []);
    });

    test("logs the error of a handler that fails unexpectedly, and answers without its details", async () => {
        const { logger, dispatch } = setup();

        const responses = await Promise.all(["test.internal", "test.crash"].map((method) => dispatch(request(method))));

        for (const response of responses) {
            assert.equal(failure(response).error.message, "Internal error");
            assert.partialDeepStrictEqual(failure(response).error.data, { code: "INTERNAL_ERROR" });
        }
        assert.equal(logger.at("error").length, 2);
    });
});
