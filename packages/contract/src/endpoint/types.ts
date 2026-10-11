import type { EndpointId, NodeId, RoomId } from "../common/ids.ts";

/** What is stored for an endpoint. */
export interface EndpointRecord {
    readonly id: EndpointId;
    readonly nodeId: NodeId;

    /** The Matter endpoint number, unique within its node. */
    readonly matterNumber: number;
    readonly name: string;
    readonly roomId: RoomId | null;
}
