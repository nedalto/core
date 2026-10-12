import type { NodeId } from "../common/ids.ts";

/** Events about nodes. Names follow `<subject>:<verb-past-tense>`. */
export interface NodeEvents {
    /** The node answers: a session was established or re-established. */
    "node:connected": {
        readonly nodeId: NodeId;
        readonly timestamp: number;
    };

    /** The node stopped answering, but still belongs to the fabric. */
    "node:disconnected": {
        readonly nodeId: NodeId;
        readonly timestamp: number;
    };
}
