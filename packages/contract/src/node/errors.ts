import { ConflictError, IntegrationError, NotFoundError, UnreachableError } from "../common/errors.ts";
import type { NodeId } from "../common/ids.ts";

/** The node does not exist. */
export class NodeNotFoundError extends NotFoundError {
    constructor(nodeId: NodeId, cause?: unknown) {
        super(`Node ${nodeId} not found`, { cause, data: { nodeId } });
    }
}

/**
 * The device could not be commissioned. `data.reason` says why: it was not found, it was found and could not be
 * paired, or it rejected the passcode.
 */
export class CommissioningFailedError extends IntegrationError {
    constructor(reason: "not-found" | "pairing-failed" | "passcode-rejected", cause: unknown) {
        super(`Commissioning failed: ${reason}`, { cause, data: { reason } });
    }
}

/** The device refused to join the fabric. `data.reason` says why. */
export class CommissioningRejectedError extends ConflictError {
    constructor(reason: "already-commissioned" | "fabric-table-full", cause: unknown) {
        super(`Commissioning rejected: ${reason}`, { cause, data: { reason } });
    }
}

/** The hub rejected the request to remove the node, not the device. `data.reason` says why. */
export class DecommissioningRejectedError extends ConflictError {
    constructor(nodeId: NodeId, reason: "in-progress", cause?: unknown) {
        super(`Decommissioning rejected: ${reason}`, { cause, data: { nodeId, reason } });
    }
}

/** The node did not answer. `data.reason` tells a sleeping device, which wakes by itself, from an offline one. */
export class NodeUnreachableError extends UnreachableError {
    constructor(nodeId: NodeId, reason: "asleep" | "offline", cause: unknown) {
        super(`Node ${nodeId} is unreachable: ${reason}`, { cause, data: { nodeId, reason } });
    }
}
