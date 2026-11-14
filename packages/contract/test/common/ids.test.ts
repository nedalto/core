import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseEndpointId, parseNodeId, toEndpointId, toNodeId, toRoomId } from "../../src/common/ids.ts";

// Both ends of the uint64 range.
const MATTER_IDS = [0n, 2n ** 64n - 1n];

describe("toNodeId", () => {
    test("writes the Matter node id as 16 lowercase hex digits", () => {
        assert.equal(toNodeId(10n), "000000000000000a");
        assert.equal(toNodeId(2n ** 64n - 1n), "ffffffffffffffff");
    });
});

describe("toEndpointId", () => {
    test("joins the node id and the endpoint number in decimal with a hyphen", () => {
        assert.equal(toEndpointId(toNodeId(10n), 2), "000000000000000a-2");
    });
});

describe("toRoomId", () => {
    test("writes the number in decimal", () => {
        assert.equal(toRoomId(7n), "7");
    });
});

describe("parseNodeId", () => {
    test("returns the Matter node id the node id was made from across the uint64 range", () => {
        for (const matterId of MATTER_IDS) {
            assert.equal(parseNodeId(toNodeId(matterId)), matterId);
        }
    });
});

describe("parseEndpointId", () => {
    test("returns the Matter node id and the number the endpoint id was made from", () => {
        for (const matterId of MATTER_IDS) {
            assert.deepEqual(parseEndpointId(toEndpointId(toNodeId(matterId), 65534)), { matterId, number: 65534 });
        }
    });
});
