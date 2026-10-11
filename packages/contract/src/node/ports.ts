import type { NodeId } from "../common/ids.ts";
import type { NodeRecord } from "./types.ts";

/** Persistence of nodes. */
export interface NodeRepository {
    findById(id: NodeId): NodeRecord | null;
    findAll(): NodeRecord[];

    save(record: NodeRecord): void;

    /**
     * Removes the node together with its endpoints.
     * Throws `NodeNotFoundError` if the node does not exist.
     */
    delete(id: NodeId): void;
}
