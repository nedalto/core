import "./sdk-config.ts";
import { ObserverGroup } from "@matter/main";
import type { ClientNode } from "@matter/main/node";

import type { Unsubscribe } from "@nedalto/contract/common/bus.ts";
import type { EndpointId, NodeId } from "@nedalto/contract/common/ids.ts";
import type { EndpointRepository } from "@nedalto/contract/endpoint/ports.ts";
import type { EndpointRecord } from "@nedalto/contract/endpoint/types.ts";
import type { Logger } from "@nedalto/contract/logger/ports.ts";
import type { NodeRepository } from "@nedalto/contract/node/ports.ts";

/** An endpoint of an SDK node, by its Matter endpoint number. */
export interface PeerEndpoint {
    readonly nodeId: NodeId;
    readonly node: ClientNode;
    readonly number: number;
}

/** An SDK node with the endpoints registered for it, by their Matter endpoint number. */
export interface TrackedNode {
    readonly nodeId: NodeId;
    readonly node: ClientNode;
    readonly endpoints: ReadonlyMap<EndpointId, number>;
}

interface RegisteredNode extends TrackedNode {
    readonly endpoints: Map<EndpointId, number>;
}

/** Puts the observers of a gateway for a node on `observers`, which `Identity` closes when the node is removed. */
export type Attach = (observers: ObserverGroup, tracked: TrackedNode) => void;

interface Subscription {
    readonly attach: Attach;
    readonly groups: Map<NodeId, ObserverGroup>;
}

/**
 * The translation from our ids to the SDK's: a `NodeId` to its node, and an `EndpointId` to its node and endpoint
 * number.
 * The gateways share it, so it is also where they learn that a node was added or removed.
 */
export class Identity {
    readonly #logger: Logger;
    readonly #nodes = new Map<NodeId, RegisteredNode>();
    readonly #endpoints = new Map<EndpointId, PeerEndpoint>();
    readonly #subscriptions = new Set<Subscription>();

    constructor(logger: Logger) {
        this.#logger = logger;
    }

    node(nodeId: NodeId): ClientNode | undefined {
        return this.#nodes.get(nodeId)?.node;
    }

    nodeIdOf(node: ClientNode): NodeId | undefined {
        for (const tracked of this.#nodes.values()) {
            if (tracked.node === node) {
                return tracked.nodeId;
            }
        }
        return undefined;
    }

    tracked(nodeId: NodeId): TrackedNode | undefined {
        return this.#nodes.get(nodeId);
    }

    endpoint(endpointId: EndpointId): PeerEndpoint | undefined {
        return this.#endpoints.get(endpointId);
    }

    /** The id registered for the endpoint with Matter endpoint `number` of the node. */
    endpointIdOf(nodeId: NodeId, number: number): EndpointId | undefined {
        for (const [endpointId, registered] of this.#nodes.get(nodeId)?.endpoints ?? []) {
            if (registered === number) {
                return endpointId;
            }
        }
        return undefined;
    }

    /** Registers the node with its endpoints, and lets each subscription observe it. */
    add(nodeId: NodeId, node: ClientNode, endpoints: readonly EndpointRecord[]): void {
        const tracked: RegisteredNode = {
            nodeId,
            node,
            endpoints: new Map(endpoints.map(({ id, matterNumber }) => [id, matterNumber])),
        };
        this.#nodes.set(nodeId, tracked);
        for (const [endpointId, number] of tracked.endpoints) {
            this.#endpoints.set(endpointId, { nodeId, node, number });
        }
        for (const { attach, groups } of this.#subscriptions) {
            const observers = new ObserverGroup();
            groups.set(nodeId, observers);
            attach(observers, tracked);
        }
    }

    /** Forgets the node and its endpoints, and closes the observers that the subscriptions attached to it. */
    remove(nodeId: NodeId): void {
        const tracked = this.#nodes.get(nodeId);
        if (tracked === undefined) {
            return;
        }
        for (const endpointId of tracked.endpoints.keys()) {
            this.#endpoints.delete(endpointId);
        }
        this.#nodes.delete(nodeId);
        for (const { groups } of this.#subscriptions) {
            groups.get(nodeId)?.close();
            groups.delete(nodeId);
        }
    }

    /** Registers `added` and forgets `removed` on a registered node. */
    update(nodeId: NodeId, added: readonly EndpointRecord[], removed: readonly EndpointId[]): void {
        const tracked = this.#nodes.get(nodeId);
        if (tracked === undefined) {
            return;
        }
        for (const endpointId of removed) {
            tracked.endpoints.delete(endpointId);
            this.#endpoints.delete(endpointId);
        }
        for (const { id, matterNumber } of added) {
            tracked.endpoints.set(id, matterNumber);
            this.#endpoints.set(id, { nodeId, node: tracked.node, number: matterNumber });
        }
    }

    /**
     * Calls `attach` for each node added from now on.
     * The SDK's observables hand out no unsubscribe handle and a decommissioned node stays alive, so the group
     * that `attach` receives is what detaches its observers: it is closed when the node is removed, and all of
     * them when the returned function is called.
     */
    observe(attach: Attach): Unsubscribe {
        const subscription: Subscription = { attach, groups: new Map() };
        this.#subscriptions.add(subscription);
        return () => {
            this.#subscriptions.delete(subscription);
            for (const observers of subscription.groups.values()) {
                observers.close();
            }
            subscription.groups.clear();
        };
    }

    /**
     * Registers each node of the repository that has a peer in the SDK, with all its endpoints of the repository.
     * Those the peer no longer has, or does not have yet, are for the reconciliation to settle.
     */
    hydrate(peers: Iterable<ClientNode>, nodeRepository: NodeRepository, endpointRepository: EndpointRepository): void {
        const byMatterId = new Map<bigint, ClientNode>();
        for (const peer of peers) {
            const address = peer.state.commissioning.peerAddress;
            if (address !== undefined) {
                byMatterId.set(address.nodeId, peer);
            }
        }
        for (const record of nodeRepository.findAll()) {
            const peer = byMatterId.get(record.matterId);
            if (peer === undefined) {
                // The database and the fabric disagree, e.g. after restoring one of them from a backup.
                this.#logger.warn("persisted node has no Matter peer", record.id);
                continue;
            }
            this.add(record.id, peer, endpointRepository.findByNode(record.id));
        }
    }
}
