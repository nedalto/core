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
    FabricManager,
    MaximumCommissionedFabricsReachedError,
    OperativeConnectionFailedError,
    PasscodeMismatchError,
    PeerAddress,
    PeerUnreachableError,
    Read,
    TransientPeerCommunicationError,
} from "@matter/main/protocol";
import { AttributeId, ClusterId, EndpointNumber, FabricIndex, NodeId as SdkNodeId } from "@matter/main/types";

import { type AppError, IntegrationError } from "@nedalto/contract/common/errors.ts";
import { toNodeId } from "@nedalto/contract/common/ids.ts";
import {
    CommissioningFailedError,
    CommissioningRejectedError,
    DecommissioningRejectedError,
    NodeNotFoundError,
    NodeUnreachableError,
} from "@nedalto/contract/node/errors.ts";

import { classifyCommissioningError, classifyDecommissioningError } from "../src/classify.ts";
import { TestNetwork } from "./helpers/network.ts";

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
            data: { nodeId, reason: "offline" },
        },
        {
            title: "a transient failure to reach the device",
            sdkError: new TransientPeerCommunicationError("transient"),
            type: NodeUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { nodeId, reason: "offline" },
        },
        {
            title: "an unreachable device, a subtype of the transient failure",
            sdkError: new PeerUnreachableError(Millis(5000)),
            type: NodeUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { nodeId, reason: "offline" },
        },
        {
            // What @matter/main 0.18.0 throws for a device that does not answer.
            title: "an abort caused by an unreachable device",
            sdkError: new AbortedError("aborted", { cause: new PeerUnreachableError(Millis(90_000)) }),
            type: NodeUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { nodeId, reason: "offline" },
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
        const address = peer.peerAddress;
        assert.ok(address !== undefined && peer.owner !== undefined);
        // @matter/protocol 0.18.0: the sleep is made up in the registry of intermittently connected devices that the
        // fabric keeps, which is internal to the SDK; how a real long idle device checks in is not exercised.
        const icd = peer.owner.env.get(FabricManager).for(address.fabricIndex).icd;
        // No check-in arrives, so the key and counters are never used.
        icd.addPeer({ peerNodeId: address.nodeId, key: new Uint8Array(16), counterStart: 0, lastOffset: 0 }, () => {});
        await icd.wakefulnessFor(address.nodeId)?.awake.emit(false);
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

        const sleeping = toNodeId(address.nodeId);
        expectClassified(classifyDecommissioningError(sleeping, error), {
            type: NodeUnreachableError,
            code: "UNREACHABLE_ERROR",
            data: { nodeId: sleeping, reason: "asleep" },
            cause: error,
        });
    });
});
