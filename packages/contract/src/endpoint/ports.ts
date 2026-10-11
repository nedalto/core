import type { EndpointId, NodeId, RoomId } from "../common/ids.ts";
import type { EndpointRecord } from "./types.ts";

/** Persistence of endpoints. */
export interface EndpointRepository {
    findById(id: EndpointId): EndpointRecord | null;
    findAll(): EndpointRecord[];
    findByNode(nodeId: NodeId): EndpointRecord[];

    /** Inserts the record. Its node must already be saved. */
    save(record: EndpointRecord): void;

    /** Throws `EndpointNotFoundError` if the endpoint does not exist. */
    setName(id: EndpointId, name: string): void;

    /**
     * Assigns the room, or clears it with `null`.
     * Throws `EndpointNotFoundError` if the endpoint does not exist.
     */
    setRoom(id: EndpointId, roomId: RoomId | null): void;
}
