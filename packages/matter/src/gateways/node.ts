import "../sdk-config.ts";
import { ObserverGroup } from "@matter/main";
import { BasicInformationClient } from "@matter/main/behaviors/basic-information";
import {
    type ClientNode,
    type CommissioningClient,
    type Endpoint,
    EndpointLifecycle,
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
import type { CommissioningResult, EndpointChanges, NodeInfo } from "@nedalto/contract/node/types.ts";

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

/** The `NodeGateway` over the peers of the controller node. */
export class MatterNodeGateway implements NodeGateway {
    readonly #logger: Logger;
    readonly #bus: DomainEventBus;
    readonly #identity: Identity;
    readonly #controller: ServerNode;
    readonly #decommissioning = new Set<NodeId>();
    readonly #unobserve: () => void;
    readonly #peerObservers = new ObserverGroup();
    readonly #structureListeners = new Set<(nodeId: NodeId) => void>();
    readonly #deletionListeners = new Set<(nodeId: NodeId) => void>();

    constructor(logger: Logger, bus: DomainEventBus, identity: Identity, controller: ServerNode) {
        this.#logger = logger;
        this.#bus = bus;
        this.#identity = identity;
        this.#controller = controller;
        this.#unobserve = identity.observe((observers, { nodeId, node }) => {
            observers.on(node.lifecycle.online, () => {
                this.#bus.emit("node:connected", { nodeId, timestamp: Date.now() });
            });
            observers.on(node.lifecycle.offline, () => {
                if (!this.#decommissioning.has(nodeId)) {
                    this.#bus.emit("node:disconnected", { nodeId, timestamp: Date.now() });
                }
            });
            observers.on(node.lifecycle.changed, (change, endpoint) => {
                if (
                    (change === EndpointLifecycle.Change.PartsReady || change === EndpointLifecycle.Change.Destroyed) &&
                    endpoint !== node &&
                    !this.#isLeaving(nodeId, node)
                ) {
                    this.#notify(this.#structureListeners, nodeId);
                }
            });
            observers.on(node.lifecycle.seeded, () => {
                this.#notify(this.#structureListeners, nodeId);
            });
        });
        // @matter/node 0.18.0: a peer leaves this set when it is destroyed, also while the controller closes, which is
        // why `close()` comes first.
        this.#peerObservers.on(controller.peers.deleted, (node) => {
            const nodeId = this.#identity.nodeIdOf(node);
            if (nodeId !== undefined && !this.#decommissioning.has(nodeId)) {
                this.#identity.remove(nodeId);
                this.#logger.info("the SDK deleted the node", nodeId);
                this.#notify(this.#deletionListeners, nodeId);
            }
        });
    }

    /** Stops announcing the nodes' connections, structure and deletion. */
    close(): void {
        this.#unobserve();
        this.#peerObservers.close();
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
        // The node goes offline while it leaves the fabric, which is not a disconnection to announce.
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

    isReachable(nodeId: NodeId): boolean {
        return this.#identity.node(nodeId)?.lifecycle.isOnline ?? false;
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

    // @matter/node 0.18.0: `delete()` and `close()` report `destroying` on the node before they destroy its endpoints,
    // which is taking the node down and not a change of its structure.
    #isLeaving(nodeId: NodeId, node: ClientNode): boolean {
        return this.#decommissioning.has(nodeId) || node.lifecycle.isGone;
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
