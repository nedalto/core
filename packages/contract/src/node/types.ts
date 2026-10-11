import type { NodeId } from "../common/ids.ts";

/** What is stored for a node. */
export interface NodeRecord {
    readonly id: NodeId;

    /** The Matter node id, an unsigned 64-bit integer. */
    readonly matterId: bigint;
}
