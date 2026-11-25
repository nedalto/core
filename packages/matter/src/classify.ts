import "./sdk-config.ts";
import { causedBy, DestroyedDependencyError, NoResponseTimeoutError, TimeoutError } from "@matter/main";
import {
    DiscoveryAggregateError,
    DiscoveryError,
    DiscoveryIncompleteError,
    FabricOperationInProgressError,
    IcdPeerAsleepError,
    NoDiscoveryTransportError,
} from "@matter/main/node";
import {
    CommissioningTimeoutError,
    DeviceAlreadyCommissionedToThisFabricError,
    MaximumCommissionedFabricsReachedError,
    PasscodeMismatchError,
    type ResultStatus,
    TransientPeerCommunicationError,
} from "@matter/main/protocol";
import { Status } from "@matter/main/types";

import { type AppError, IntegrationError } from "@nedalto/contract/common/errors.ts";
import type { EndpointId, NodeId } from "@nedalto/contract/common/ids.ts";
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

/** The contract error for what the SDK threw while commissioning, which keeps it as the `cause`. */
export function classifyCommissioningError(error: unknown): AppError {
    // @matter/node 0.18.0: `NoDiscoveryTransportError` and `DiscoveryIncompleteError` are subtypes of `DiscoveryError`,
    // so they go first: a hub without scanners is not something a client can act on, and a device that was found
    // but whose attempts did not finish was not missing.
    if (error instanceof NoDiscoveryTransportError) {
        return new IntegrationError("Commissioning failed", { cause: error });
    }
    if (error instanceof DiscoveryIncompleteError) {
        return new CommissioningFailedError("pairing-failed", error);
    }
    if (error instanceof DiscoveryError) {
        return new CommissioningFailedError("not-found", error);
    }
    if (error instanceof DiscoveryAggregateError) {
        // The manual code carries 4 bits of the discriminator, so the passcode may have been rejected by another
        // device in pairing mode: the hub knows it was rejected, not that it was mistyped.
        // @matter/node 0.18.0: the errors of an aggregate may wrap the `PasscodeMismatchError` as a cause.
        const rejected = error.errors.every((cause) => causedBy(cause, PasscodeMismatchError));
        return new CommissioningFailedError(rejected ? "passcode-rejected" : "pairing-failed", error);
    }
    if (error instanceof DeviceAlreadyCommissionedToThisFabricError) {
        return new CommissioningRejectedError("already-commissioned", error);
    }
    if (error instanceof MaximumCommissionedFabricsReachedError) {
        return new CommissioningRejectedError("fabric-table-full", error);
    }
    // @matter/protocol 0.18.0: a step throws a timeout as it is, and `OperativeConnectionFailedError` wraps the one of
    // the operational reconnection as its cause.
    if (causedBy(error, CommissioningTimeoutError, TimeoutError)) {
        return new CommissioningFailedError("pairing-failed", error);
    }
    return new IntegrationError("Commissioning failed", { cause: error });
}

// Why the peer did not answer, or `undefined` when the error is not about reaching it.
function unreachableReason(error: unknown): NodeUnreachableError["data"]["reason"] | undefined {
    // A sleeping device is also one that does not answer, so it is told apart first.
    if (causedBy(error, IcdPeerAsleepError)) {
        return "asleep";
    }
    // @matter/protocol 0.18.0: a peer that cannot be reached fails the operation with an `AbortedError` whose cause
    // is a `PeerUnreachableError`, a subtype of `TransientPeerCommunicationError`.
    if (causedBy(error, NoResponseTimeoutError, TransientPeerCommunicationError)) {
        return "no-response";
    }
    return undefined;
}

/** The contract error for what the SDK threw while removing the node, which keeps it as the `cause`. */
export function classifyDecommissioningError(nodeId: NodeId, error: unknown): AppError {
    const reason = unreachableReason(error);
    if (reason !== undefined) {
        return new NodeUnreachableError(nodeId, reason, error);
    }
    // @matter/node 0.18.0: the SDK refuses a second operation on a node that has one running.
    if (error instanceof FabricOperationInProgressError) {
        return new DecommissioningRejectedError(nodeId, "in-progress", error);
    }
    // @matter/node 0.18.0: the SDK has already deleted the node, e.g. because the device left the fabric.
    if (error instanceof DestroyedDependencyError) {
        return new NodeNotFoundError(nodeId, error);
    }
    return new IntegrationError("Decommissioning failed", { cause: error, data: { nodeId } });
}

/**
 * The contract error for what the SDK threw while reading, writing or invoking, which keeps it as the `cause`.
 * `timedOut` says whether the request ran out of time.
 */
export function classifyInteractionError(
    endpointId: EndpointId,
    clusterId: number,
    error: unknown,
    timedOut: boolean,
): AppError {
    // @matter/main 0.18.0: when the abort signal of a request fires, the SDK throws its reason as it is, an
    // `AbortedError` without a cause, or one caused by the reason, depending on the operation and the session.
    const reason = unreachableReason(error) ?? (timedOut ? "no-response" : undefined);
    if (reason !== undefined) {
        return new EndpointUnreachableError(endpointId, reason, error);
    }
    return new IntegrationError("Interaction failed", { cause: error, data: { endpointId, clusterId } });
}

// @matter/protocol 0.18.0: a device answers a request on a path it does not serve with the status of the first
// level missing, and a write to an attribute it serves read-only with UnsupportedWrite.
const MISSING = new Set([Status.UnsupportedEndpoint, Status.UnsupportedCluster]);

/** The contract error for a status other than success that a device answered a read or write of an attribute with. */
export function classifyAttributeStatus(
    endpointId: EndpointId,
    clusterId: number,
    attributeId: number,
    answered: ResultStatus,
): AppError {
    if (MISSING.has(answered.status) || answered.status === Status.UnsupportedAttribute) {
        return new AttributeNotFoundError(endpointId, clusterId, attributeId);
    }
    return new InteractionRejectedError(endpointId, clusterId, { attributeId }, answered);
}

/** The contract error for a status other than success that a device answered a command with. */
export function classifyCommandStatus(
    endpointId: EndpointId,
    clusterId: number,
    commandId: number,
    answered: ResultStatus,
): AppError {
    if (MISSING.has(answered.status) || answered.status === Status.UnsupportedCommand) {
        return new CommandNotFoundError(endpointId, clusterId, commandId);
    }
    return new InteractionRejectedError(endpointId, clusterId, { commandId }, answered);
}
