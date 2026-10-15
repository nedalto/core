import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { HandshakeCloseCode, JsonRpcErrorCode } from "../../src/server/types.ts";

// The numbers are the wire format: docs/protocol.md lists them for clients.
describe("JsonRpcErrorCode", () => {
    test("has the codes that JSON-RPC 2.0 defines and the one for application errors", () => {
        assert.deepEqual(JsonRpcErrorCode, {
            ParseError: -32700,
            InvalidRequest: -32600,
            MethodNotFound: -32601,
            InvalidParams: -32602,
            ApplicationError: -32000,
        });
    });
});

describe("HandshakeCloseCode", () => {
    test("has codes in the range that RFC 6455 leaves to applications", () => {
        assert.deepEqual(HandshakeCloseCode, { Unauthorized: 4401, SchemaVersionMismatch: 4426 });
    });
});
