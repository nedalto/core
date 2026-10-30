import "../src/sdk-config.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CrashedDependencyError, DestroyedDependencyError, Millis, NoResponseTimeoutError } from "@matter/main";
import {
    DeviceNotDiscoveredError,
    DiscoveryAggregateError,
    DiscoveryIncompleteError,
    FabricOperationInProgressError,
    IcdPeerAsleepError,
    NoDiscoveryTransportError,
} from "@matter/main/node";
import {
    DeviceAlreadyCommissionedToThisFabricError,
    MaximumCommissionedFabricsReachedError,
    PasscodeMismatchError,
    PeerAddress,
    PeerUnreachableError,
    TransientPeerCommunicationError,
} from "@matter/main/protocol";
import { FabricIndex, NodeId as SdkNodeId, Status } from "@matter/main/types";

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
    DecommissioningRejectedError,
    NodeNotFoundError,
    NodeUnreachableError,
} from "@nedalto/contract/node/errors.ts";

import {
    classifyCommissioningError,
    classifyDecommissioningError,
    classifyInteractionError,
    classifyAttributeStatus,
    classifyCommandStatus,
} from "../src/classify.ts";

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
            title: "a device that was not discovered",
            sdkError: new DeviceNotDiscoveredError("no device"),
            type: CommissioningFailedError,
            code: "INTEGRATION_ERROR",
            data: { reason: "not-found" },
        },
        {
            title: "a device found whose attempts did not finish",
            sdkError: new DiscoveryIncompleteError("all canceled"),
            type: CommissioningFailedError,
            code: "INTEGRATION_ERROR",
            data: { reason: "pairing-failed" },
        },
        {
            title: "a discovery with no scanner",
            sdkError: new NoDiscoveryTransportError("no scanner"),
            type: IntegrationError,
            code: "INTEGRATION_ERROR",
            data: undefined,
        },
        {
            title: "attempts that all failed with a passcode mismatch",
            sdkError: new DiscoveryAggregateError(
                [new PasscodeMismatchError("wrong"), new PasscodeMismatchError("wrong")],
                "all attempts failed",
            ),
            type: CommissioningFailedError,
            code: "INTEGRATION_ERROR",
            data: { reason: "passcode-rejected" },
        },
        {
            title: "an attempt that wraps a passcode mismatch as its cause",
            sdkError: new DiscoveryAggregateError(
                [new Error("PASE failed", { cause: new PasscodeMismatchError("wrong") })],
                "all attempts failed",
            ),
            type: CommissioningFailedError,
            code: "INTEGRATION_ERROR",
            data: { reason: "passcode-rejected" },
        },
        {
            title: "attempts of which one is not a passcode mismatch",
            sdkError: new DiscoveryAggregateError(
                [new PasscodeMismatchError("wrong"), new Error("PASE failed")],
                "all attempts failed",
            ),
            type: CommissioningFailedError,
            code: "INTEGRATION_ERROR",
            data: { reason: "pairing-failed" },
        },
        {
            title: "attempts that failed for another reason",
            sdkError: new DiscoveryAggregateError([new Error("PASE failed")], "all attempts failed"),
            type: CommissioningFailedError,
            code: "INTEGRATION_ERROR",
            data: { reason: "pairing-failed" },
        },
        {
            title: "a device already commissioned to the fabric",
            sdkError: new DeviceAlreadyCommissionedToThisFabricError("already commissioned"),
            type: CommissioningRejectedError,
            code: "CONFLICT_ERROR",
            data: { reason: "already-commissioned" },
        },
        {
            title: "a full fabric table",
            sdkError: new MaximumCommissionedFabricsReachedError("table full"),
            type: CommissioningRejectedError,
            code: "CONFLICT_ERROR",
            data: { reason: "fabric-table-full" },
        },
        {
            title: "any other error",
            sdkError: new Error("anything else"),
            type: IntegrationError,
            code: "INTEGRATION_ERROR",
            data: undefined,
        },
    ];

    for (const { title, sdkError, type, code, data } of cases) {
        test(`maps ${title} to ${type.name} with its data`, () => {
            expectClassified(classifyCommissioningError(sdkError), { type, code, data, cause: sdkError });
        });
    }
});

describe("classifyDecommissioningError", () => {
    const nodeId = createNodeId();
    const peerAddress = PeerAddress({ fabricIndex: FabricIndex(1), nodeId: SdkNodeId(1n) });
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
            sdkError: new FabricOperationInProgressError("a commission is running"),
            type: DecommissioningRejectedError,
            code: "CONFLICT_ERROR",
            data: { nodeId, reason: "in-progress" },
        },
        {
            sdkError: new DestroyedDependencyError("node", "is closing or being deleted"),
            type: NodeNotFoundError,
            code: "NOT_FOUND_ERROR",
            data: { nodeId },
        },
        {
            sdkError: new CrashedDependencyError("node", "crashed"),
            type: IntegrationError,
            code: "INTEGRATION_ERROR",
            data: { nodeId },
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
    const peerAddress = PeerAddress({ fabricIndex: FabricIndex(1), nodeId: SdkNodeId(1n) });
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
