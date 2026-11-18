import type { EndpointId, NodeId, RoomId } from "../common/ids.ts";

/** What is stored for an endpoint. */
export interface EndpointRecord {
    readonly id: EndpointId;
    readonly nodeId: NodeId;

    /** The Matter endpoint number, unique within its node. */
    readonly number: number;
    readonly name: string;
    readonly roomId: RoomId | null;
}

/**
 * An endpoint as the device has it: its node, its number and the name the hub gives it by default.
 * It is what the Matter controller finds, stored or not, and what `EndpointRepository.create` stores.
 */
export type DeviceEndpoint = Pick<EndpointRecord, "nodeId" | "number" | "name">;
