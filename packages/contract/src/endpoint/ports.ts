import type { EndpointId, NodeId, RoomId } from "../common/ids.ts";
import type { EndpointRecord, NewEndpoint } from "./types.ts";

/** Persistence of endpoints. */
export interface EndpointRepository {
    findById(id: EndpointId): EndpointRecord | null;
    findAll(): EndpointRecord[];
    findByNode(nodeId: NodeId): EndpointRecord[];

    /** Its node must already be stored. */
    create(endpoint: NewEndpoint): EndpointRecord;

    /** Throws `EndpointNotFoundError` if the endpoint does not exist. */
    setName(id: EndpointId, name: string): void;

    /**
     * Assigns the room, which must exist, or clears it with `null`.
     * Throws `EndpointNotFoundError` if the endpoint does not exist.
     */
    setRoom(id: EndpointId, roomId: RoomId | null): void;

    /** Throws `EndpointNotFoundError` if the endpoint does not exist. */
    delete(id: EndpointId): void;
}
