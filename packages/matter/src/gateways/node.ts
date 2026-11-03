import "../sdk-config.ts";
import { ObserverGroup } from "@matter/main";
import { BasicInformationClient } from "@matter/main/behaviors/basic-information";
import {
    type ClientNode,
    type CommissioningClient,
    type Endpoint,
    EndpointLifecycle,
    NodeConnectionState,
    type ServerNode,
} from "@matter/main/node";
import { ManualPairingCodeCodec, type QrCodeData, QrPairingCodeCodec } from "@matter/main/types";

import type { Unsubscribe } from "@nedalto/contract/common/bus.ts";
import { InternalError, ValidationError } from "@nedalto/contract/common/errors.ts";
import { createEndpointId, createNodeId, type NodeId } from "@nedalto/contract/common/ids.ts";
import type { EndpointRecord } from "@nedalto/contract/endpoint/types.ts";
import type { DomainEventBus } from "@nedalto/contract/events.ts";
import type { Logger } from "@nedalto/contract/logger/ports.ts";
import { DecommissioningRejectedError, NodeNotFoundError } from "@nedalto/contract/node/errors.ts";
import type { NodeGateway } from "@nedalto/contract/node/ports.ts";
import type { CommissioningResult, EndpointChanges, NodeConnection, NodeInfo } from "@nedalto/contract/node/types.ts";

import { classifyCommissioningError, classifyDecommissioningError } from "../classify.ts";
import type { Identity } from "../identity.ts";

const QR_PREFIX = "MT:";

const invalidSetupCode = (message: string, cause?: unknown): ValidationError =>
    new ValidationError(`Setup code ${message}`, {
        cause,
        issues: [{ path: "setupCode", message: `setupCode ${message}` }],
    });

/** A trimmed `value`, or `undefined` when it is blank. */
const nonBlank = (value: string | undefined): string | undefined => value?.trim() || undefined;

// Endpoint 0 is the node's administration, not something to control. `endpoints` indexes the whole tree, unlike `parts`,
// which holds only the direct children and would miss what a bridge exposes.
const controllableEndpoints = (node: ClientNode): Endpoint[] => node.endpoints.filter(({ number }) => number !== 0);

/** What a client calls each state of the connection to a peer, one to one. */
export function toNodeConnection(state: NodeConnectionState): NodeConnection {
    switch (state) {
        case NodeConnectionState.Connected:
            return "connected";
        case NodeConnectionState.Disconnected:
            return "disconnected";
        case NodeConnectionState.Reconnecting:
            return "reconnecting";
        case NodeConnectionState.WaitingForDeviceDiscovery:
            return "waiting-for-discovery";
        default:
            return state satisfies never;
    }
}

/** The `NodeGateway` over the peers of the controller node. */
export class MatterNodeGateway implements NodeGateway {
    readonly #logger: Logger;
    readonly #bus: DomainEventBus;
    readonly #identity: Identity;
    readonly #controller: ServerNode;
    readonly #decommissioning = new Set<NodeId>();
    readonly #collectionObservers = new ObserverGroup();
    readonly #peerObservers = new Map<ClientNode, ObserverGroup>();
    readonly #structureListeners = new Set<(nodeId: NodeId) => void>();
    readonly #deletionListeners = new Set<(nodeId: NodeId) => void>();

    constructor(logger: Logger, bus: DomainEventBus, identity: Identity, controller: ServerNode) {
        this.#logger = logger;
        this.#bus = bus;
        this.#identity = identity;
        this.#controller = controller;
        // @matter/node 0.18.0: the peers restored from storage join the collection as it is created, before it can be
        // observed. It also holds the devices discovered and not commissioned, which nothing is announced for because
        // they are not registered, as with a node between its commissioning and its registration.
        for (const peer of controller.peers) {
            this.#observePeer(peer);
        }
        this.#collectionObservers.on(controller.peers.added, (peer) => {
            this.#observePeer(peer);
        });
        // @matter/node 0.18.0: a peer leaves this set when it is destroyed, also while the controller closes, which is
        // why `close()` comes first.
        this.#collectionObservers.on(controller.peers.deleted, (peer) => {
            // First and whoever the peer was, so that nothing of it runs while the node is reported as deleted.
            this.#peerObservers.get(peer)?.close();
            this.#peerObservers.delete(peer);
            const nodeId = this.#identity.nodeIdOf(peer);
            if (nodeId !== undefined && !this.#decommissioning.has(nodeId)) {
                this.#identity.remove(nodeId);
                this.#logger.info("the SDK deleted the node", nodeId);
                this.#notify(this.#deletionListeners, nodeId);
            }
        });
    }

    /** Stops announcing the nodes' connections, structure and deletion. */
    close(): void {
        this.#collectionObservers.close();
        for (const observers of this.#peerObservers.values()) {
            observers.close();
        }
        this.#peerObservers.clear();
    }

    async commission(setupCode: string): Promise<CommissioningResult> {
        const options = this.#commissioningOptions(setupCode);
        let node: ClientNode;
        try {
            node = await this.#controller.peers.commission(options);
        } catch (error) {
            throw classifyCommissioningError(error);
        }

        // From here the device belongs to the fabric: a failure below leaves it there, unknown to the caller.
        // @matter/node 0.18.0: for a newly commissioned peer, `commission()` returns after the initial read of
        // the peer's structure (unless `autoStateInitialize` is false), so its endpoints and Basic Information
        // are already available.
        const nodeId = createNodeId();
        const matterId = this.#matterIdOf(node);
        const endpoints = this.#endpointRecords(nodeId, node, controllableEndpoints(node));
        this.#identity.add(nodeId, node, endpoints);
        this.#logger.info("commissioned node", nodeId, endpoints.length);
        return { node: { id: nodeId, matterId }, endpoints };
    }

    async decommission(nodeId: NodeId, force = false): Promise<void> {
        const node = this.#node(nodeId);
        // A second call is refused before the SDK: its `finally` would drop the id while the first call still runs.
        if (this.#decommissioning.has(nodeId)) {
            throw new DecommissioningRejectedError(nodeId, "in-progress");
        }
        // While the node leaves the fabric, the teardown of its endpoints is not a change of structure, and its deletion
        // is ours and not one by the SDK.
        this.#decommissioning.add(nodeId);
        try {
            // `delete()` forgets the node without contacting the device; `decommission()` removes our fabric from it.
            await (force ? node.delete() : node.decommission());
        } catch (error) {
            const classified = classifyDecommissioningError(nodeId, error);
            // The SDK no longer has the node, so it is forgotten here too, as after a decommission that succeeds.
            if (classified instanceof NodeNotFoundError) {
                this.#identity.remove(nodeId);
            }
            throw classified;
        } finally {
            this.#decommissioning.delete(nodeId);
        }
        this.#identity.remove(nodeId);
        this.#logger.info("decommissioned node", nodeId, force ? "forced" : "from the fabric");
    }

    connectionOf(nodeId: NodeId): NodeConnection {
        const node = this.#identity.node(nodeId);
        return node === undefined ? "disconnected" : toNodeConnection(node.lifecycle.connectionState);
    }

    getInfo(nodeId: NodeId): NodeInfo {
        const node = this.#node(nodeId);
        const basic = node.stateOf(BasicInformationClient);
        return {
            id: nodeId,
            matterId: this.#matterIdOf(node),
            commissionedAt: node.state.commissioning.commissionedAt ?? null,
            label: basic.nodeLabel ?? "",
            vendorName: basic.vendorName,
            productName: basic.productName,
            vendorId: basic.vendorId,
            productId: basic.productId,
            hardwareVersion: basic.hardwareVersion,
            softwareVersion: basic.softwareVersion,
            softwareVersionString: basic.softwareVersionString,
        };
    }

    reconcileEndpoints(nodeId: NodeId): EndpointChanges {
        const tracked = this.#identity.tracked(nodeId);
        if (tracked === undefined) {
            throw new NodeNotFoundError(nodeId);
        }
        const { node, endpoints } = tracked;
        if (!node.lifecycle.isSeeded) {
            return { added: [], removed: [] };
        }
        const registered = new Set(endpoints.values());
        const removed = [...endpoints]
            .filter(([, number]) => !node.endpoints.has(number) || node.endpoints.for(number).lifecycle.isGone)
            .map(([endpointId]) => endpointId);
        const added = this.#endpointRecords(
            nodeId,
            node,
            // @matter/node 0.18.0: the index of the node holds an endpoint from `installed`, before its state can be
            // read, and `ClientStructure` installs a parent before the parts it names, so a parent is registered first.
            controllableEndpoints(node).filter(
                ({ number, lifecycle }) => !registered.has(number) && lifecycle.isPartsReady && !lifecycle.isGone,
            ),
        );
        this.#identity.update(nodeId, added, removed);
        if (added.length > 0 || removed.length > 0) {
            this.#logger.info("the endpoints of the node changed", nodeId, added.length, removed.length);
        }
        return { added, removed };
    }

    onStructureChanged(listener: (nodeId: NodeId) => void): Unsubscribe {
        this.#structureListeners.add(listener);
        return () => {
            this.#structureListeners.delete(listener);
        };
    }

    onNodeDeleted(listener: (nodeId: NodeId) => void): Unsubscribe {
        this.#deletionListeners.add(listener);
        return () => {
            this.#deletionListeners.delete(listener);
        };
    }

    #observePeer(peer: ClientNode): void {
        // @matter/general 0.18.0: a group holds on to what it observes until it is closed, so each peer has its own, which
        // goes when the peer does.
        const observers = new ObserverGroup();
        this.#peerObservers.set(peer, observers);
        observers.on(peer.lifecycle.connectionStateChanged, (state) => {
            const nodeId = this.#identity.nodeIdOf(peer);
            if (nodeId !== undefined) {
                this.#bus.emit("node:connection-changed", {
                    nodeId,
                    connection: toNodeConnection(state),
                    timestamp: Date.now(),
                });
            }
        });
        observers.on(peer.lifecycle.changed, (change, endpoint) => {
            if (
                (change !== EndpointLifecycle.Change.PartsReady && change !== EndpointLifecycle.Change.Destroyed) ||
                endpoint === peer
            ) {
                return;
            }
            const nodeId = this.#identity.nodeIdOf(peer);
            // @matter/node 0.18.0: `delete()` and `close()` report `destroying` on the node before they destroy its
            // endpoints, which is taking the node down and not a change of its structure, as is our decommission.
            if (nodeId !== undefined && !this.#decommissioning.has(nodeId) && !peer.lifecycle.isGone) {
                this.#notify(this.#structureListeners, nodeId);
            }
        });
        observers.on(peer.lifecycle.seeded, () => {
            const nodeId = this.#identity.nodeIdOf(peer);
            if (nodeId !== undefined) {
                this.#notify(this.#structureListeners, nodeId);
            }
        });
    }

    #notify(listeners: ReadonlySet<(nodeId: NodeId) => void>, nodeId: NodeId): void {
        for (const listener of listeners) {
            listener(nodeId);
        }
    }

    #commissioningOptions(setupCode: string): CommissioningClient.CommissioningOptions {
        // @matter/node 0.18.0: `pairingCode` is read as a manual pairing code, so a QR payload is decoded here.
        // The manual code is decoded too, so that a mistyped one is refused before the SDK is reached.
        if (!setupCode.startsWith(QR_PREFIX)) {
            try {
                ManualPairingCodeCodec.decode(setupCode);
            } catch (error) {
                throw invalidSetupCode("is not a valid manual pairing code", error);
            }
            return { pairingCode: setupCode };
        }
        let payloads: QrCodeData[];
        try {
            payloads = QrPairingCodeCodec.decode(setupCode);
        } catch (error) {
            throw invalidSetupCode("is not a readable QR payload", error);
        }
        const payload = payloads.length === 1 ? payloads[0] : undefined;
        if (payload === undefined) {
            throw invalidSetupCode(`names ${payloads.length} devices; provide the code of a single device`);
        }
        return { passcode: payload.passcode, discriminator: payload.discriminator };
    }

    #node(nodeId: NodeId): ClientNode {
        const node = this.#identity.node(nodeId);
        if (node === undefined) {
            throw new NodeNotFoundError(nodeId);
        }
        return node;
    }

    #matterIdOf(node: ClientNode): bigint {
        const address = node.state.commissioning.peerAddress;
        if (address === undefined) {
            throw new InternalError("Commissioned node has no peer address");
        }
        return address.nodeId;
    }

    #endpointRecords(nodeId: NodeId, node: ClientNode, endpoints: readonly Endpoint[]): EndpointRecord[] {
        const basic = node.stateOf(BasicInformationClient);
        const name = nonBlank(basic.nodeLabel) ?? nonBlank(basic.productName) ?? "Matter Device";
        return endpoints.map(({ number }) => ({
            id: createEndpointId(),
            nodeId,
            matterNumber: number,
            name,
            roomId: null,
        }));
    }
}
