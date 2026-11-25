import "./sdk-config.ts";
import type { ClientNode, Endpoint, ServerNode } from "@matter/main/node";

import {
    type EndpointId,
    type NodeId,
    parseEndpointId,
    parseNodeId,
    toEndpointId,
    toNodeId,
} from "@nedalto/contract/common/ids.ts";

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

function peerWith(controller: ServerNode, matterId: bigint): ClientNode | undefined {
    // @matter/node 0.18.0: `peers.get(address)` walks the peers comparing their addresses too.
    for (const peer of controller.peers) {
        if (peer.peerAddress?.nodeId === matterId) {
            return peer;
        }
    }
    return undefined;
}

/** The peer that the controller has for `nodeId`, or `undefined` when it has none. */
export const peerOf = (controller: ServerNode, nodeId: NodeId): ClientNode | undefined =>
    peerWith(controller, parseNodeId(nodeId));

export const endpointIdOf = (nodeId: NodeId, endpoint: Endpoint): EndpointId => toEndpointId(nodeId, endpoint.number);

// Endpoint 0 is the node's administration, not something to control.
// @matter/node 0.18.0: the index of a node holds an endpoint from `installed`, before its state can be read.
export const isExposed = (endpoint: Endpoint): boolean =>
    endpoint.number !== 0 && endpoint.lifecycle.isPartsReady && !endpoint.lifecycle.isGone;

/** An endpoint of a peer, with the node it belongs to. */
export interface PeerEndpoint {
    readonly nodeId: NodeId;
    readonly peer: ClientNode;
    readonly endpoint: Endpoint;
}

/** The endpoint that `endpointId` names, or `undefined` when the controller has none that it exposes. */
export function endpointOf(controller: ServerNode, endpointId: EndpointId): PeerEndpoint | undefined {
    const { matterId, number } = parseEndpointId(endpointId);
    const peer = peerWith(controller, matterId);
    // @matter/node 0.18.0: `endpoints` indexes the whole tree, unlike `parts`, and `for()` throws for a number it does
    // not hold, as it does for every number but 0 of a peer whose structure is not seeded yet; `for(0)` is the peer.
    if (peer === undefined || !peer.endpoints.has(number)) {
        return undefined;
    }
    const endpoint = peer.endpoints.for(number);
    return isExposed(endpoint) ? { nodeId: toNodeId(matterId), peer, endpoint } : undefined;
}
