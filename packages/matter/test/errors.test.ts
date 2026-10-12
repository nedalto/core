import "../src/sdk-config.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Millis, NoResponseTimeoutError } from "@matter/main";
import { DiscoveryAggregateError, DiscoveryError, IcdPeerAsleepError } from "@matter/main/node";
import {
    DeviceAlreadyCommissionedToThisFabricError,
    MaximumCommissionedFabricsReachedError,
    PeerAddress,
    PeerUnreachableError,
    TransientPeerCommunicationError,
} from "@matter/main/protocol";
import { FabricIndex, NodeId as MatterNodeId } from "@matter/main/types";

import { type AppError, IntegrationError } from "@nedalto/contract/common/errors.ts";
import { createNodeId } from "@nedalto/contract/common/ids.ts";
import {
    CommissioningFailedError,
    CommissioningRejectedError,
    NodeUnreachableError,
} from "@nedalto/contract/node/errors.ts";

import { classifyCommissioningError, classifyDecommissioningError } from "../src/errors.ts";

const expectClassified = (
    actual: AppError,
    expected: { type: new (...args: never[]) => AppError; code: string; data: unknown; cause: unknown },
): void => {
    assert.equal(actual.constructor, expected.type);
    assert.equal(actual.code, expected.code);
    assert.deepEqual(actual.data, expected.data);
    assert.equal(actual.cause, expected.cause);
};

describe("classifyCommissioningError", () => {
    const cases = [
        {
            sdkError: new DiscoveryError("no device"),
            type: CommissioningFailedError,
            code: "INTEGRATION_ERROR",
            data: { reason: "not-found" },
        },
        {
            sdkError: new DiscoveryAggregateError([new Error("PASE failed")], "all attempts failed"),
            type: CommissioningFailedError,
            code: "INTEGRATION_ERROR",
            data: { reason: "pairing-failed" },
        },
        {
            sdkError: new DeviceAlreadyCommissionedToThisFabricError("already commissioned"),
            type: CommissioningRejectedError,
            code: "CONFLICT_ERROR",
            data: { reason: "already-commissioned" },
        },
        {
            sdkError: new MaximumCommissionedFabricsReachedError("table full"),
            type: CommissioningRejectedError,
            code: "CONFLICT_ERROR",
            data: { reason: "fabric-table-full" },
        },
        {
            sdkError: new Error("anything else"),
            type: IntegrationError,
            code: "INTEGRATION_ERROR",
            data: undefined,
        },
    ];

    for (const { sdkError, type, code, data } of cases) {
        test(`maps ${sdkError.constructor.name} to ${type.name} with its data`, () => {
            expectClassified(classifyCommissioningError(sdkError), { type, code, data, cause: sdkError });
        });
    }
});

describe("classifyDecommissioningError", () => {
    const nodeId = createNodeId();
    const peerAddress = PeerAddress({ fabricIndex: FabricIndex(1), nodeId: MatterNodeId(1n) });
    const cases = [
        {
            sdkError: new IcdPeerAsleepError(peerAddress, Millis(1000)),
            type: NodeUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { nodeId, reason: "asleep" },
        },
        {
            sdkError: new NoResponseTimeoutError("no response"),
            type: NodeUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { nodeId, reason: "offline" },
        },
        {
            sdkError: new TransientPeerCommunicationError("transient"),
            type: NodeUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { nodeId, reason: "offline" },
        },
        {
            // A subclass of the transient error.
            sdkError: new PeerUnreachableError(Millis(5000)),
            type: NodeUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { nodeId, reason: "offline" },
        },
        {
            sdkError: new Error("fabric removal rejected"),
            type: IntegrationError,
            code: "INTEGRATION_ERROR",
            data: { nodeId },
        },
    ];

    for (const { sdkError, type, code, data } of cases) {
        test(`maps ${sdkError.constructor.name} to ${type.name} with its data`, () => {
            expectClassified(classifyDecommissioningError(nodeId, sdkError), { type, code, data, cause: sdkError });
        });
    }
});
