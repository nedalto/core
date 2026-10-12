import "./sdk-config.ts";
import { NoResponseTimeoutError } from "@matter/main";
import { DiscoveryAggregateError, DiscoveryError, IcdPeerAsleepError } from "@matter/main/node";
import {
    DeviceAlreadyCommissionedToThisFabricError,
    MaximumCommissionedFabricsReachedError,
    TransientPeerCommunicationError,
} from "@matter/main/protocol";

import { type AppError, IntegrationError } from "@nedalto/contract/common/errors.ts";
import type { NodeId } from "@nedalto/contract/common/ids.ts";
import {
    CommissioningFailedError,
    CommissioningRejectedError,
    NodeUnreachableError,
} from "@nedalto/contract/node/errors.ts";

/** The contract error for what the SDK threw while commissioning, which keeps it as the `cause`. */
export function classifyCommissioningError(error: unknown): AppError {
    // @matter/node 0.17.9: of the commissioning discovery, `DiscoveryError` is thrown when no attempt failed
    // (no device discovered, or every attempt canceled or timed out) and `DiscoveryAggregateError` when attempts
    // failed, carrying their errors. `DiscoveryAggregateError` also gathers failures of the discovery scanners,
    // which are reported as `pairing-failed` too rather than told apart by the errors inside it.
    if (error instanceof DiscoveryError) {
        return new CommissioningFailedError("not-found", error);
    }
    if (error instanceof DiscoveryAggregateError) {
        return new CommissioningFailedError("pairing-failed", error);
    }
    if (error instanceof DeviceAlreadyCommissionedToThisFabricError) {
        return new CommissioningRejectedError("already-commissioned", error);
    }
    if (error instanceof MaximumCommissionedFabricsReachedError) {
        return new CommissioningRejectedError("fabric-table-full", error);
    }
    return new IntegrationError("Commissioning failed", { cause: error });
}

/** The contract error for what the SDK threw while removing the node, which keeps it as the `cause`. */
export function classifyDecommissioningError(nodeId: NodeId, error: unknown): AppError {
    if (error instanceof IcdPeerAsleepError) {
        return new NodeUnreachableError(nodeId, "asleep", error);
    }
    if (error instanceof NoResponseTimeoutError || error instanceof TransientPeerCommunicationError) {
        return new NodeUnreachableError(nodeId, "offline", error);
    }
    return new IntegrationError("Decommissioning failed", { cause: error, data: { nodeId } });
}
