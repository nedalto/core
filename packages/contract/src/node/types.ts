import type { NodeId } from "../common/ids.ts";

/** What is stored for a node. */
export interface NodeRecord {
    readonly id: NodeId;
}
