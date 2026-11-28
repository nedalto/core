import type { EndpointId, NodeId, RoomId } from "../common/ids.ts";
import type { WireValue } from "../common/wire.ts";

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

/** The value of an attribute, the fields of a command or its response. */
export type AttributeValue = WireValue;

/** An attribute of a cluster and its last known value. */
export interface AttributeState {
    /** The Matter attribute id. */
    readonly id: number;
    readonly value: AttributeValue;
}

/** A cluster of an endpoint, with the attributes the device reports and the commands it accepts. */
export interface ClusterState {
    /** The Matter cluster id. */
    readonly id: number;

    /** The attributes the cluster defines, without the global ones, that have a known value. */
    readonly attributes: readonly AttributeState[];

    /** The ids of the commands the device accepts. */
    readonly acceptedCommands: readonly number[];
}

/** What the Matter network knows about an endpoint. */
export interface EndpointShape {
    /** The endpoint this one hangs from, or `null` when it hangs from the root of the node. */
    readonly parentId: EndpointId | null;

    /** The Matter device type id. */
    readonly deviceType: number;
    readonly clusters: readonly ClusterState[];
}
