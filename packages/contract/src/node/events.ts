import type { NodeId } from "../common/ids.ts";
import type { EndpointState } from "../endpoint/types.ts";
import type { NodeState } from "./types.ts";

/** Events about nodes. Names follow `<subject>:<verb-past-tense>`. */
export interface NodeEvents {
    /** A node was commissioned, with its endpoints. */
    "node:added": {
        readonly node: NodeState;
        readonly endpoints: readonly EndpointState[];
        readonly timestamp: number;
    };

    /** A node was removed, and with it its endpoints. */
    "node:removed": {
        readonly nodeId: NodeId;
        readonly timestamp: number;
    };

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
