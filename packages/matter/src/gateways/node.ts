import "../sdk-config.ts";
import { ObserverGroup } from "@matter/main";
import { BasicInformationClient } from "@matter/main/behaviors/basic-information";
import type { ClientNode, CommissioningClient, ServerNode } from "@matter/main/node";
import { ManualPairingCodeCodec, type QrCodeData, QrPairingCodeCodec } from "@matter/main/types";

import { InternalError, ValidationError } from "@nedalto/contract/common/errors.ts";
import { createEndpointId, createNodeId, type NodeId } from "@nedalto/contract/common/ids.ts";
import type { EndpointRecord } from "@nedalto/contract/endpoint/types.ts";
import type { DomainEventBus } from "@nedalto/contract/events.ts";
import type { Logger } from "@nedalto/contract/logger/ports.ts";
import { NodeNotFoundError } from "@nedalto/contract/node/errors.ts";
import type { NodeGateway } from "@nedalto/contract/node/ports.ts";
import type { CommissioningResult, NodeInfo, NodeRecord } from "@nedalto/contract/node/types.ts";

import { classifyCommissioningError, classifyDecommissioningError } from "../errors.ts";

const QR_PREFIX = "MT:";

interface TrackedNode {
    readonly node: ClientNode;
    readonly observers: ObserverGroup;
}

/** A `ValidationError` about the setup code, in the shape that schema validation gives its issues. */
const invalidSetupCode = (message: string, cause?: unknown): ValidationError =>
    new ValidationError(`Setup code ${message}`, {
        cause,
        data: { issues: [{ path: "setupCode", message: `setupCode ${message}` }] },
    });

/** A trimmed `value`, or `undefined` when it is blank. */
const nonBlank = (value: string | undefined): string | undefined => value?.trim() || undefined;

/** The `NodeGateway` over the peers of the controller node. */
export class SdkNodeGateway implements NodeGateway {
    readonly #logger: Logger;
    readonly #bus: DomainEventBus;
    readonly #controller: ServerNode;
    readonly #nodes = new Map<NodeId, TrackedNode>();
    readonly #decommissioning = new Set<NodeId>();

    constructor(logger: Logger, bus: DomainEventBus, controller: ServerNode) {
        this.#logger = logger;
        this.#bus = bus;
        this.#controller = controller;
    }

    /** Tracks the SDK peer of each record, matching them by Matter node id. */
    hydrate(records: readonly NodeRecord[]): void {
        const peers = new Map<bigint, ClientNode>();
        for (const peer of this.#controller.peers) {
            const address = peer.state.commissioning.peerAddress;
            if (address !== undefined) {
                peers.set(address.nodeId, peer);
            }
        }
        for (const record of records) {
            const peer = peers.get(record.matterId);
            if (peer === undefined) {
                // The database and the fabric disagree, e.g. after restoring one of them from a backup.
                this.#logger.warn("persisted node has no Matter peer", record.id);
                continue;
            }
            this.#track(record.id, peer);
        }
    }

    /** Stops announcing the nodes' connections. */
    stop(): void {
        for (const { observers } of this.#nodes.values()) {
            observers.close();
        }
        this.#nodes.clear();
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
        // @matter/node 0.17.9: for a newly commissioned peer, `commission()` returns after the initial read of
        // the peer's structure (unless `autoStateInitialize` is false), so its endpoints and Basic Information
        // are already available.
        const nodeId = createNodeId();
        const matterId = this.#matterIdOf(node);
        const endpoints = this.#endpointRecords(nodeId, node);
        this.#track(nodeId, node);
        this.#logger.info("commissioned node", nodeId, endpoints.length);
        return { node: { id: nodeId, matterId }, endpoints };
    }

    async decommission(nodeId: NodeId, force = false): Promise<void> {
        const { node } = this.#tracked(nodeId);
        // The node goes offline while it leaves the fabric, which is not a disconnection to announce.
        this.#decommissioning.add(nodeId);
        try {
            // `delete()` forgets the node without contacting the device; `decommission()` removes our fabric from it.
            await (force ? node.delete() : node.decommission());
        } catch (error) {
            throw classifyDecommissioningError(nodeId, error);
        } finally {
            this.#decommissioning.delete(nodeId);
        }
        this.#untrack(nodeId);
        this.#logger.info("decommissioned node", nodeId, force ? "forced" : "from the fabric");
    }

    isReachable(nodeId: NodeId): boolean {
        return this.#nodes.get(nodeId)?.node.lifecycle.isOnline ?? false;
    }

    getInfo(nodeId: NodeId): NodeInfo {
        const { node } = this.#tracked(nodeId);
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

    #commissioningOptions(setupCode: string): CommissioningClient.CommissioningOptions {
        // @matter/node 0.17.9: `pairingCode` is read as a manual pairing code, so a QR payload is decoded here.
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

    #tracked(nodeId: NodeId): TrackedNode {
        const tracked = this.#nodes.get(nodeId);
        if (tracked === undefined) {
            throw new NodeNotFoundError(nodeId);
        }
        return tracked;
    }

    #track(nodeId: NodeId, node: ClientNode): void {
        // The SDK's observables hand out no unsubscribe handle and a decommissioned node stays alive, so the
        // group is what detaches the observers.
        const observers = new ObserverGroup();
        observers.on(node.lifecycle.online, () => {
            this.#bus.emit("node:connected", { nodeId, timestamp: Date.now() });
        });
        observers.on(node.lifecycle.offline, () => {
            if (!this.#decommissioning.has(nodeId)) {
                this.#bus.emit("node:disconnected", { nodeId, timestamp: Date.now() });
            }
        });
        this.#nodes.set(nodeId, { node, observers });
    }

    #untrack(nodeId: NodeId): void {
        this.#nodes.get(nodeId)?.observers.close();
        this.#nodes.delete(nodeId);
    }

    #matterIdOf(node: ClientNode): bigint {
        const address = node.state.commissioning.peerAddress;
        if (address === undefined) {
            throw new InternalError("Commissioned node has no peer address");
        }
        return address.nodeId;
    }

    #endpointRecords(nodeId: NodeId, node: ClientNode): EndpointRecord[] {
        const basic = node.stateOf(BasicInformationClient);
        const name = nonBlank(basic.nodeLabel) ?? nonBlank(basic.productName) ?? "Matter Device";
        const records: EndpointRecord[] = [];
        // `endpoints` indexes the whole tree, unlike `parts`, which holds only the direct children and would
        // miss what a bridge exposes.
        for (const endpoint of node.endpoints) {
            // Endpoint 0 is the node's administration, not something to control.
            if (endpoint.number !== 0) {
                records.push({ id: createEndpointId(), nodeId, matterNumber: endpoint.number, name, roomId: null });
            }
        }
        return records;
    }
}
