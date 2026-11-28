import "../src/sdk-config.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    AbortedError,
    CrashedDependencyError,
    DestroyedDependencyError,
    Millis,
    NoResponseTimeoutError,
    Seconds,
} from "@matter/main";
import {
    DeviceNotDiscoveredError,
    DiscoveryAggregateError,
    DiscoveryIncompleteError,
    FabricOperationInProgressError,
    IcdPeerAsleepError,
    NoDiscoveryTransportError,
} from "@matter/main/node";
import {
    CommissioningTimeoutError,
    DeviceAlreadyCommissionedToThisFabricError,
    MaximumCommissionedFabricsReachedError,
    OperativeConnectionFailedError,
    PasscodeMismatchError,
    PeerAddress,
    PeerUnreachableError,
    Read,
    TransientPeerCommunicationError,
} from "@matter/main/protocol";
import { AttributeId, ClusterId, EndpointNumber, FabricIndex, NodeId as SdkNodeId, Status } from "@matter/main/types";

import { type AppError, IntegrationError } from "@nedalto/contract/common/errors.ts";
import { toEndpointId, toNodeId } from "@nedalto/contract/common/ids.ts";
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
    classifyAttributeStatus,
    classifyCommandStatus,
    classifyCommissioningError,
    classifyDecommissioningError,
    classifyInteractionError,
} from "../src/classify.ts";
import { putToSleep, TestNetwork } from "./helpers/network.ts";

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
            title: "a commissioning that takes longer than its maximum time",
            sdkError: new CommissioningTimeoutError("too long"),
            type: CommissioningFailedError,
            code: "INTEGRATION_ERROR",
            data: { reason: "pairing-failed" },
        },
        {
            title: "a device that stops answering in a step",
            sdkError: new NoResponseTimeoutError("no answer"),
            type: CommissioningFailedError,
            code: "INTEGRATION_ERROR",
            data: { reason: "pairing-failed" },
        },
        {
            title: "a device that stops answering in the operational reconnection",
            sdkError: new OperativeConnectionFailedError("failed", { cause: new NoResponseTimeoutError("no answer") }),
            type: CommissioningFailedError,
            code: "INTEGRATION_ERROR",
            data: { reason: "pairing-failed" },
        },
        {
            title: "a device that was not discovered, with a timeout in its chain",
            sdkError: new DeviceNotDiscoveredError("no device", { cause: new NoResponseTimeoutError("no answer") }),
            type: CommissioningFailedError,
            code: "INTEGRATION_ERROR",
            data: { reason: "not-found" },
        },
        {
            title: "attempts that all failed with a passcode mismatch, with a timeout in their chain",
            sdkError: new DiscoveryAggregateError(
                [new PasscodeMismatchError("wrong", { cause: new NoResponseTimeoutError("no answer") })],
                "all attempts failed",
            ),
            type: CommissioningFailedError,
            code: "INTEGRATION_ERROR",
            data: { reason: "passcode-rejected" },
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
    const nodeId = toNodeId(1n);
    const peerAddress = PeerAddress({ fabricIndex: FabricIndex(1), nodeId: SdkNodeId(1n) });
    const asleep = new IcdPeerAsleepError(peerAddress, Millis(1000));
    const cases = [
        {
            title: "a sleeping device",
            sdkError: asleep,
            type: NodeUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { nodeId, reason: "asleep" },
        },
        {
            title: "an error caused by a sleeping device, also when it is a failure to reach it",
            sdkError: new TransientPeerCommunicationError("transient", { cause: asleep }),
            type: NodeUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { nodeId, reason: "asleep" },
        },
        {
            title: "a response that did not arrive",
            sdkError: new NoResponseTimeoutError("no response"),
            type: NodeUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { nodeId, reason: "no-response" },
        },
        {
            title: "a transient failure to reach the device",
            sdkError: new TransientPeerCommunicationError("transient"),
            type: NodeUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { nodeId, reason: "no-response" },
        },
        {
            title: "an unreachable device, a subtype of the transient failure",
            sdkError: new PeerUnreachableError(Millis(5000)),
            type: NodeUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { nodeId, reason: "no-response" },
        },
        {
            // What @matter/main 0.18.0 throws for a device that does not answer.
            title: "an abort caused by an unreachable device",
            sdkError: new AbortedError("aborted", { cause: new PeerUnreachableError(Millis(90_000)) }),
            type: NodeUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { nodeId, reason: "no-response" },
        },
        {
            title: "another operation on the node",
            sdkError: new FabricOperationInProgressError("a commission is running"),
            type: DecommissioningRejectedError,
            code: "CONFLICT_ERROR",
            data: { nodeId, reason: "in-progress" },
        },
        {
            title: "a node the SDK has already deleted",
            sdkError: new DestroyedDependencyError("node", "is closing or being deleted"),
            type: NodeNotFoundError,
            code: "NOT_FOUND_ERROR",
            data: { nodeId },
        },
        {
            title: "a node that crashed",
            sdkError: new CrashedDependencyError("node", "crashed"),
            type: IntegrationError,
            code: "INTEGRATION_ERROR",
            data: { nodeId },
        },
        {
            title: "any other error",
            sdkError: new Error("fabric removal rejected"),
            type: IntegrationError,
            code: "INTEGRATION_ERROR",
            data: { nodeId },
        },
    ];

    for (const { title, sdkError, type, code, data } of cases) {
        test(`maps ${title} to ${type.name} with its data`, () => {
            expectClassified(classifyDecommissioningError(nodeId, sdkError), { type, code, data, cause: sdkError });
        });
    }

    test("maps what the SDK throws for a device it holds asleep to NodeUnreachableError as asleep", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const peer = await network.peer(manualCode);
        await putToSleep(peer);
        const request = {
            ...Read({
                attributes: [{ endpointId: EndpointNumber(1), clusterId: ClusterId(6), attributeId: AttributeId(0) }],
            }),
            icdAwaitTimeout: Seconds(1),
        };

        const error = await (async () => {
            try {
                for await (const chunk of peer.interaction.read(request)) {
                    void chunk;
                }
            } catch (thrown) {
                return thrown;
            }
            return undefined;
        })();

        assert.ok(peer.peerAddress !== undefined);
        const sleeping = toNodeId(peer.peerAddress.nodeId);
        expectClassified(classifyDecommissioningError(sleeping, error), {
            type: NodeUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { nodeId: sleeping, reason: "asleep" },
            cause: error,
        });
    });
});

describe("classifyInteractionError", () => {
    const endpointId = toEndpointId(toNodeId(1n), 1);
    const clusterId = 6;
    const peerAddress = PeerAddress({ fabricIndex: FabricIndex(1), nodeId: SdkNodeId(1n) });
    const expired = new DOMException("The operation timed out.", "TimeoutError");
    const cases = [
        {
            title: "a sleeping device, even when the request timed out",
            sdkError: new IcdPeerAsleepError(peerAddress, Millis(1000)),
            timedOut: true,
            type: EndpointUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { endpointId, reason: "asleep" },
        },
        {
            title: "a failure to reach the device before the request timed out",
            sdkError: new AbortedError("aborted", { cause: new PeerUnreachableError(Millis(5000)) }),
            timedOut: false,
            type: EndpointUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { endpointId, reason: "no-response" },
        },
        {
            // What @matter/main 0.18.0 throws from `read` and `write` on a session to a device that vanished.
            title: "the reason of the timeout, as it is",
            sdkError: expired,
            timedOut: true,
            type: EndpointUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { endpointId, reason: "no-response" },
        },
        {
            // What @matter/main 0.18.0 throws from `invoke` on a session to a device that vanished.
            title: "an abort without a cause when the request timed out",
            sdkError: new AbortedError("aborted"),
            timedOut: true,
            type: EndpointUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { endpointId, reason: "no-response" },
        },
        {
            title: "an abort caused by the timeout",
            sdkError: new AbortedError("aborted", { cause: expired }),
            timedOut: true,
            type: EndpointUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { endpointId, reason: "no-response" },
        },
        {
            title: "any other error before the request timed out",
            sdkError: new AbortedError("aborted"),
            timedOut: false,
            type: IntegrationError,
            code: "INTEGRATION_ERROR",
            data: { endpointId, clusterId },
        },
    ];

    for (const { title, sdkError, timedOut, type, code, data } of cases) {
        test(`maps ${title} to ${type.name} with its data`, () => {
            expectClassified(classifyInteractionError(endpointId, clusterId, sdkError, timedOut), {
                type,
                code,
                data,
                cause: sdkError,
            });
        });
    }
});

describe("classifyAttributeStatus", () => {
    const endpointId = toEndpointId(toNodeId(1n), 1);
    const clusterId = 6;
    const attributeId = 0;
    const notFound = [Status.UnsupportedEndpoint, Status.UnsupportedCluster, Status.UnsupportedAttribute];
    const rejected = [Status.UnsupportedRead, Status.UnsupportedWrite, Status.UnsupportedAccess, Status.Failure];

    for (const status of notFound) {
        test(`maps ${Status[status]} to AttributeNotFoundError`, () => {
            const error = classifyAttributeStatus(endpointId, clusterId, attributeId, { status });

            assert.ok(error instanceof AttributeNotFoundError);
            assert.deepEqual(error.data, { endpointId, clusterId, attributeId });
        });
    }

    for (const status of rejected) {
        test(`maps ${Status[status]} to InteractionRejectedError with the status`, () => {
            const error = classifyAttributeStatus(endpointId, clusterId, attributeId, { status });

            assert.ok(error instanceof InteractionRejectedError);
            assert.deepEqual(error.data, { endpointId, clusterId, attributeId, status });
        });
    }

    test("maps a status with the status of the cluster to InteractionRejectedError with both", () => {
        const error = classifyAttributeStatus(endpointId, clusterId, attributeId, {
            status: Status.Failure,
            clusterStatus: 2,
        });

        assert.ok(error instanceof InteractionRejectedError);
        assert.deepEqual(error.data, { endpointId, clusterId, attributeId, status: Status.Failure, clusterStatus: 2 });
    });
});

describe("classifyCommandStatus", () => {
    const endpointId = toEndpointId(toNodeId(1n), 1);
    const clusterId = 6;
    const commandId = 1;
    const notFound = [Status.UnsupportedEndpoint, Status.UnsupportedCluster, Status.UnsupportedCommand];
    const rejected = [Status.UnsupportedAccess, Status.InvalidCommand, Status.Failure];

    for (const status of notFound) {
        test(`maps ${Status[status]} to CommandNotFoundError`, () => {
            const error = classifyCommandStatus(endpointId, clusterId, commandId, { status });

            assert.ok(error instanceof CommandNotFoundError);
            assert.deepEqual(error.data, { endpointId, clusterId, commandId });
        });
    }

    for (const status of rejected) {
        test(`maps ${Status[status]} to InteractionRejectedError with the status`, () => {
            const error = classifyCommandStatus(endpointId, clusterId, commandId, { status });

            assert.ok(error instanceof InteractionRejectedError);
            assert.deepEqual(error.data, { endpointId, clusterId, commandId, status });
        });
    }

    test("maps a status with the status of the cluster to InteractionRejectedError with both", () => {
        const error = classifyCommandStatus(endpointId, clusterId, commandId, {
            status: Status.Failure,
            clusterStatus: 2,
        });

        assert.ok(error instanceof InteractionRejectedError);
        assert.deepEqual(error.data, { endpointId, clusterId, commandId, status: Status.Failure, clusterStatus: 2 });
    });
});
