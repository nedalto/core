declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

/** A commissioned device: its Matter node id as 16 lowercase hex digits. */
export type NodeId = Brand<string, "NodeId">;

/**
 * A functional unit of a node, what the user sees as a device (a light, a switch, a sensor): the id of its node, `-`
 * and its Matter endpoint number in decimal.
 */
export type EndpointId = Brand<string, "EndpointId">;

/** A user-defined group of endpoints, with no Matter counterpart: its number in decimal. */
export type RoomId = Brand<string, "RoomId">;

const NODE_ID_LENGTH = 16;

export const toNodeId = (matterId: bigint): NodeId => matterId.toString(16).padStart(NODE_ID_LENGTH, "0") as NodeId;

export const toEndpointId = (nodeId: NodeId, number: number): EndpointId => `${nodeId}-${number}` as EndpointId;

export const toRoomId = (rowId: bigint): RoomId => String(rowId) as RoomId;

/** The Matter node id, an unsigned 64-bit integer. */
export const parseNodeId = (nodeId: NodeId): bigint => BigInt(`0x${nodeId}`);

/** The Matter node id and endpoint number. */
export const parseEndpointId = (endpointId: EndpointId): { readonly matterId: bigint; readonly number: number } => ({
    matterId: parseNodeId(endpointId.slice(0, NODE_ID_LENGTH) as NodeId),
    number: Number(endpointId.slice(NODE_ID_LENGTH + 1)),
});
