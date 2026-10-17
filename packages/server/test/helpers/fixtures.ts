import { createEndpointId, createNodeId, type NodeId, type RoomId } from "@nedalto/contract/common/ids.ts";
import type { EndpointRecord, EndpointShape, EndpointState } from "@nedalto/contract/endpoint/types.ts";
import type { NodeRecord } from "@nedalto/contract/node/types.ts";

/** What the Matter network knows of a light that is on. */
export const LIGHT_SHAPE: EndpointShape = {
    deviceType: 0x0100,
    clusters: [{ id: 6, attributes: [{ id: 0, value: true }], acceptedCommands: [0, 1] }],
};

export const createNode = (): NodeRecord => ({ id: createNodeId(), matterId: 1n });

/** A light of the node, in a room or in none. */
export const createLight = (nodeId: NodeId, matterNumber: number, roomId: RoomId | null = null): EndpointRecord => ({
    id: createEndpointId(),
    nodeId,
    matterNumber,
    name: `Light ${matterNumber}`,
    roomId,
});

/** What a client sees of `record` when the network describes it as `shape`. */
export const stateOf = (record: EndpointRecord, shape: EndpointShape = LIGHT_SHAPE): EndpointState => ({
    id: record.id,
    nodeId: record.nodeId,
    deviceType: shape.deviceType,
    name: record.name,
    roomId: record.roomId,
    clusters: shape.clusters,
});
