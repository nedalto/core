import { NotFoundError } from "../common/errors.ts";
import type { NodeId } from "../common/ids.ts";

/** The node does not exist. */
export class NodeNotFoundError extends NotFoundError {
    constructor(nodeId: NodeId) {
        super(`Node ${nodeId} not found`, { data: { nodeId } });
    }
}
