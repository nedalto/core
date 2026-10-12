import { ConflictError, IntegrationError, NotFoundError, UnreachableError } from "../common/errors.ts";
import type { NodeId } from "../common/ids.ts";

/** The node does not exist. */
export class NodeNotFoundError extends NotFoundError {
    constructor(nodeId: NodeId) {
        super(`Node ${nodeId} not found`, { data: { nodeId } });
    }
}

/** The device could not be commissioned. `data.reason` says whether it was found. */
export class CommissioningFailedError extends IntegrationError {
    constructor(reason: "not-found" | "pairing-failed", cause: unknown) {
        super(`Commissioning failed: ${reason}`, { cause, data: { reason } });
    }
}

/** The device refused to join the fabric. `data.reason` says why. */
export class CommissioningRejectedError extends ConflictError {
    constructor(reason: "already-commissioned" | "fabric-table-full", cause: unknown) {
        super(`Commissioning rejected: ${reason}`, { cause, data: { reason } });
    }
}

/** The node did not answer. `data.reason` tells a sleeping device, which wakes by itself, from an offline one. */
export class NodeUnreachableError extends UnreachableError {
    constructor(nodeId: NodeId, reason: "asleep" | "offline", cause: unknown) {
        super(`Node ${nodeId} is unreachable: ${reason}`, { cause, data: { nodeId, reason } });
    }
}
