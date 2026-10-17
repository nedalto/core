import type { EndpointId, NodeId, RoomId } from "../common/ids.ts";
import type { WireValue } from "../common/wire.ts";

/** What is stored for an endpoint. */
export interface EndpointRecord {
    readonly id: EndpointId;
    readonly nodeId: NodeId;

    /** The Matter endpoint number, unique within its node. */
    readonly matterNumber: number;
    readonly name: string;
    readonly roomId: RoomId | null;
}

/** What a client sees of an endpoint: what is stored joined with what the Matter network knows. */
export interface EndpointState {
    readonly id: EndpointId;
    readonly nodeId: NodeId;

    /** The Matter device type id. */
    readonly deviceType: number;
    readonly name: string;
    readonly roomId: RoomId | null;
    readonly clusters: readonly ClusterState[];
}

/** The value of an attribute or the fields of a command. */
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
    /** The Matter device type id. */
    readonly deviceType: number;
    readonly clusters: readonly ClusterState[];
}
