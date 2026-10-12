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
import { FabricIndex, NodeId as MatterNodeId, Status } from "@matter/main/types";

import { type AppError, IntegrationError } from "@nedalto/contract/common/errors.ts";
import { createEndpointId, createNodeId } from "@nedalto/contract/common/ids.ts";
import {
    AttributeNotFoundError,
    CommandNotFoundError,
    EndpointUnreachableError,
    InteractionRejectedError,
} from "@nedalto/contract/endpoint/errors.ts";
import {
    CommissioningFailedError,
    CommissioningRejectedError,
    NodeUnreachableError,
} from "@nedalto/contract/node/errors.ts";

import {
    classifyCommissioningError,
    classifyDecommissioningError,
    classifyInteractionError,
    classifyAttributeStatus,
    classifyCommandStatus,
} from "../src/errors.ts";

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

describe("classifyInteractionError", () => {
    const endpointId = createEndpointId();
    const clusterId = 6;
    const peerAddress = PeerAddress({ fabricIndex: FabricIndex(1), nodeId: MatterNodeId(1n) });
    const cases = [
        {
            sdkError: new IcdPeerAsleepError(peerAddress, Millis(1000)),
            type: EndpointUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { endpointId, reason: "asleep" },
        },
        {
            sdkError: new NoResponseTimeoutError("no response"),
            type: EndpointUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { endpointId, reason: "offline" },
        },
        {
            sdkError: new TransientPeerCommunicationError("transient"),
            type: EndpointUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { endpointId, reason: "offline" },
        },
        {
            // A subclass of the transient error.
            sdkError: new PeerUnreachableError(Millis(5000)),
            type: EndpointUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { endpointId, reason: "offline" },
        },
        {
            sdkError: new Error("exchange closed"),
            type: IntegrationError,
            code: "INTEGRATION_ERROR",
            data: { endpointId, clusterId },
        },
    ];

    for (const { sdkError, type, code, data } of cases) {
        test(`maps ${sdkError.constructor.name} to ${type.name} with its data`, () => {
            expectClassified(classifyInteractionError(endpointId, clusterId, sdkError), {
                type,
                code,
                data,
                cause: sdkError,
            });
        });
    }
});

describe("classifyAttributeStatus", () => {
    const endpointId = createEndpointId();
    const clusterId = 6;
    const attributeId = 0;
    const notFound = [Status.UnsupportedEndpoint, Status.UnsupportedCluster, Status.UnsupportedAttribute];
    const rejected = [Status.UnsupportedRead, Status.UnsupportedWrite, Status.UnsupportedAccess, Status.Failure];

    for (const status of notFound) {
        test(`maps ${Status[status]} to AttributeNotFoundError`, () => {
            const error = classifyAttributeStatus(endpointId, clusterId, attributeId, status);

            assert.ok(error instanceof AttributeNotFoundError);
            assert.deepEqual(error.data, { endpointId, clusterId, attributeId });
        });
    }

    for (const status of rejected) {
        test(`maps ${Status[status]} to InteractionRejectedError with the status`, () => {
            const error = classifyAttributeStatus(endpointId, clusterId, attributeId, status);

            assert.ok(error instanceof InteractionRejectedError);
            assert.deepEqual(error.data, { endpointId, clusterId, attributeId, status });
        });
    }
});

describe("classifyCommandStatus", () => {
    const endpointId = createEndpointId();
    const clusterId = 6;
    const commandId = 1;
    const notFound = [Status.UnsupportedEndpoint, Status.UnsupportedCluster, Status.UnsupportedCommand];
    const rejected = [Status.UnsupportedAccess, Status.InvalidCommand, Status.Failure];

    for (const status of notFound) {
        test(`maps ${Status[status]} to CommandNotFoundError`, () => {
            const error = classifyCommandStatus(endpointId, clusterId, commandId, status);

            assert.ok(error instanceof CommandNotFoundError);
            assert.deepEqual(error.data, { endpointId, clusterId, commandId });
        });
    }

    for (const status of rejected) {
        test(`maps ${Status[status]} to InteractionRejectedError with the status`, () => {
            const error = classifyCommandStatus(endpointId, clusterId, commandId, status);

            assert.ok(error instanceof InteractionRejectedError);
            assert.deepEqual(error.data, { endpointId, clusterId, commandId, status });
        });
    }
});
