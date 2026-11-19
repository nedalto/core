import { ConflictError, IntegrationError, NotFoundError, UnreachableError } from "../common/errors.ts";
import type { NodeId } from "../common/ids.ts";

/** The node does not exist. */
export class NodeNotFoundError extends NotFoundError {
    declare readonly data: { readonly nodeId: NodeId };

    constructor(nodeId: NodeId, cause?: unknown) {
        super(`Node ${nodeId} not found`, { cause, data: { nodeId } satisfies NodeNotFoundError["data"] });
    }
}

type CommissioningFailureReason = "not-found" | "pairing-failed" | "passcode-rejected";

/**
 * The device could not be commissioned. `data.reason` says why: it was not found, it was found and could not be
 * paired, or it rejected the passcode.
 */
export class CommissioningFailedError extends IntegrationError {
    declare readonly data: { readonly reason: CommissioningFailureReason };

    constructor(reason: CommissioningFailureReason, cause: unknown) {
        super(`Commissioning failed: ${reason}`, {
            cause,
            data: { reason } satisfies CommissioningFailedError["data"],
        });
    }
}

type CommissioningRejectionReason = "already-commissioned" | "fabric-table-full";

/** The device refused to join the fabric. `data.reason` says why. */
export class CommissioningRejectedError extends ConflictError {
    declare readonly data: { readonly reason: CommissioningRejectionReason };

    constructor(reason: CommissioningRejectionReason, cause: unknown) {
        super(`Commissioning rejected: ${reason}`, {
            cause,
            data: { reason } satisfies CommissioningRejectedError["data"],
        });
    }
}

type DecommissioningRejectionReason = "in-progress";

/** The hub rejected the request to remove the node, not the device. `data.reason` says why. */
export class DecommissioningRejectedError extends ConflictError {
    declare readonly data: { readonly nodeId: NodeId; readonly reason: DecommissioningRejectionReason };

    constructor(nodeId: NodeId, reason: DecommissioningRejectionReason, cause: unknown) {
        super(`Decommissioning rejected: ${reason}`, {
            cause,
            data: { nodeId, reason } satisfies DecommissioningRejectedError["data"],
        });
    }
}

type NodeUnreachabilityReason = "asleep" | "offline";

/** The node did not answer. `data.reason` tells a sleeping device, which wakes by itself, from an offline one. */
export class NodeUnreachableError extends UnreachableError {
    declare readonly data: { readonly nodeId: NodeId; readonly reason: NodeUnreachabilityReason };

    constructor(nodeId: NodeId, reason: NodeUnreachabilityReason, cause: unknown) {
        super(`Node ${nodeId} is unreachable: ${reason}`, {
            cause,
            data: { nodeId, reason } satisfies NodeUnreachableError["data"],
        });
    }
}
