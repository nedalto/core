import "./sdk-config.ts";
import type { ClientNode, Endpoint, ServerNode } from "@matter/main/node";

import { type EndpointId, type NodeId, parseNodeId, toEndpointId, toNodeId } from "@nedalto/contract/common/ids.ts";

// A `NodeId` is the Matter node id alone, without its fabric: the hub controls a single fabric, so the node id of an
// address is enough to tell a peer.

/**
 * The id of the node of `peer`, or `undefined` while the peer has no address: before it is commissioned, or a device
 * that the controller discovered and never commissioned.
 */
export function nodeIdOf(peer: ClientNode): NodeId | undefined {
    // @matter/node 0.18.0: this throws inside `peers.added`.
    const address = peer.peerAddress;
    return address === undefined ? undefined : toNodeId(address.nodeId);
}

/** The peer that the controller has for `nodeId`, or `undefined` when it has none. */
export function peerOf(controller: ServerNode, nodeId: NodeId): ClientNode | undefined {
    // @matter/node 0.18.0: `peers.get(address)` walks the peers comparing their addresses too.
    const matterId = parseNodeId(nodeId);
    for (const peer of controller.peers) {
        if (peer.peerAddress?.nodeId === matterId) {
            return peer;
        }
    }
    return undefined;
}

export const endpointIdOf = (nodeId: NodeId, endpoint: Endpoint): EndpointId => toEndpointId(nodeId, endpoint.number);

// Endpoint 0 is the node's administration, not something to control.
export const isExposed = (endpoint: Endpoint): boolean => endpoint.number !== 0;
