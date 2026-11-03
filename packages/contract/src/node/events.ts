import type { NodeId } from "../common/ids.ts";
import type { EndpointState } from "../endpoint/types.ts";
import type { NodeConnection, NodeState } from "./types.ts";

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

    /** The connection of the node took a new value, on each change and as it is. */
    "node:connection-changed": {
        readonly nodeId: NodeId;
        readonly connection: NodeConnection;
        readonly timestamp: number;
    };
}
