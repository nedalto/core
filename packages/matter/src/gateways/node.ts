import "../sdk-config.ts";
import { ObserverGroup } from "@matter/main";
import { BasicInformationClient } from "@matter/main/behaviors/basic-information";
import { BridgedDeviceBasicInformationClient } from "@matter/main/behaviors/bridged-device-basic-information";
import {
    type ClientNode,
    type CommissioningClient,
    type Endpoint,
    EndpointLifecycle,
    NodeConnectionState,
    type ServerNode,
} from "@matter/main/node";
import { ManualPairingCodeCodec, type QrCodeData, QrPairingCodeCodec } from "@matter/main/types";

import { InternalError, ValidationError } from "@nedalto/contract/common/errors.ts";
import { type NodeId, parseNodeId } from "@nedalto/contract/common/ids.ts";
import type { DeviceEventBus } from "@nedalto/contract/device-events.ts";
import type { DeviceEndpoint } from "@nedalto/contract/endpoint/types.ts";
import type { Logger } from "@nedalto/contract/logger/ports.ts";
import { NodeNotFoundError } from "@nedalto/contract/node/errors.ts";
import type { NodeGateway } from "@nedalto/contract/node/ports.ts";
import type { CommissioningResult, NodeConnection, NodeInfo } from "@nedalto/contract/node/types.ts";

import { endpointIdOf, isExposed, nodeIdOf, peerOf } from "../addressing.ts";
import { classifyCommissioningError, classifyDecommissioningError } from "../classify.ts";

const QR_PREFIX = "MT:";

const invalidSetupCode = (message: string, cause?: unknown): ValidationError =>
    new ValidationError(`Setup code ${message}`, {
        cause,
        issues: [{ path: "setupCode", message: `setupCode ${message}` }],
    });

/** A trimmed `value`, or `undefined` when it is blank. */
const nonBlank = (value: string | undefined): string | undefined => value?.trim() || undefined;

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

// The name of the nearest endpoint, from `endpoint` up, whose Bridged Device Basic Information gives one, so that the
// outlets of a bridged power strip take the name of the strip; otherwise that of the node.
function defaultName(peer: ClientNode, endpoint: Endpoint): string {
    for (
        let current: Endpoint | undefined = endpoint;
        current !== undefined && current !== peer;
        current = current.owner
    ) {
        if (current.behaviors.has(BridgedDeviceBasicInformationClient)) {
            const bridged = current.stateOf(BridgedDeviceBasicInformationClient);
            const name = nonBlank(bridged.nodeLabel) ?? nonBlank(bridged.productName);
            if (name !== undefined) {
                return name;
            }
        }
    }
    const basic = peer.stateOf(BasicInformationClient);
    return nonBlank(basic.nodeLabel) ?? nonBlank(basic.productName) ?? "Matter Device";
}

interface ObservedPeer {
    readonly observers: ObserverGroup;

    // Kept because the SDK no longer gives the address of a peer it deletes.
    nodeId: NodeId | undefined;
}

/** The `NodeGateway` over the peers of the controller node, which reports what it notices of them on `bus`. */
export class MatterNodeGateway implements NodeGateway {
    readonly #logger: Logger;
    readonly #bus: DeviceEventBus;
    readonly #controller: ServerNode;
    readonly #collectionObservers = new ObserverGroup();
    readonly #peers = new Map<ClientNode, ObservedPeer>();

    constructor(logger: Logger, bus: DeviceEventBus, controller: ServerNode) {
        this.#logger = logger;
        this.#bus = bus;
        this.#controller = controller;
        // @matter/node 0.18.0: the peers restored from storage join the collection as it is created, before it can be
        // observed. It also holds the devices discovered and not commissioned, which have no address.
        for (const peer of controller.peers) {
            this.#observePeer(peer);
            this.#nodeIdOf(peer);
        }
        // Not resolved here: the address of a peer cannot be read inside `peers.added`.
        this.#collectionObservers.on(controller.peers.added, (peer) => {
            this.#observePeer(peer);
        });
        // @matter/node 0.18.0: a peer leaves this set when it is destroyed, also while the controller closes, which is
        // why `close()` comes first.
        this.#collectionObservers.on(controller.peers.deleted, (peer) => {
            const nodeId = this.#nodeIdOf(peer);
            this.#peers.get(peer)?.observers.close();
            this.#peers.delete(peer);
            if (nodeId !== undefined) {
                this.#logger.info("the controller no longer has the node", nodeId);
                this.#bus.emit("$node:deleted", { nodeId });
            }
        });
    }

    /** Stops reporting the nodes' connections and structure, and their deletion. */
    close(): void {
        this.#collectionObservers.close();
        for (const { observers } of this.#peers.values()) {
            observers.close();
        }
        this.#peers.clear();
    }

    async commission(setupCode: string): Promise<CommissioningResult> {
        const options = this.#commissioningOptions(setupCode);
        let peer: ClientNode;
        try {
            peer = await this.#controller.peers.commission(options);
        } catch (error) {
            throw classifyCommissioningError(error);
        }

        // From here the device belongs to the fabric: a failure below leaves it there, unknown to the caller.
        // @matter/node 0.18.0: for a newly commissioned peer, `commission()` returns after the initial read of
        // the peer's structure (unless `autoStateInitialize` is false), so its endpoints and Basic Information
        // are already available.
        const nodeId = this.#nodeIdOf(peer);
        if (nodeId === undefined) {
            throw new InternalError("Commissioned node has no peer address");
        }
        const endpoints = this.#deviceEndpoints(nodeId, peer);
        this.#logger.info("commissioned node", nodeId, endpoints.length);
        return { nodeId, endpoints };
    }

    async decommission(nodeId: NodeId, force = false): Promise<void> {
        const peer = this.#peer(nodeId);
        try {
            // `delete()` forgets the node without contacting the device; `decommission()` removes our fabric from it.
            // @matter/node 0.18.0: both delete the peer, and with it report it deleted, before they return.
            await (force ? peer.delete() : peer.decommission());
        } catch (error) {
            throw classifyDecommissioningError(nodeId, error);
        }
        this.#logger.info("decommissioned node", nodeId, force ? "forced" : "from the fabric");
    }

    connectionOf(nodeId: NodeId): NodeConnection {
        const peer = peerOf(this.#controller, nodeId);
        return peer === undefined ? "disconnected" : toNodeConnection(peer.lifecycle.connectionState);
    }

    getInfo(nodeId: NodeId): NodeInfo | null {
        const peer = this.#peer(nodeId);
        // @matter/node 0.18.0: until then the node has no Basic Information to read.
        if (!peer.lifecycle.isSeeded) {
            return null;
        }
        const basic = peer.stateOf(BasicInformationClient);
        return {
            id: nodeId,
            matterId: parseNodeId(nodeId),
            commissionedAt: peer.state.commissioning.commissionedAt ?? null,
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

    endpointsOf(nodeId: NodeId): readonly DeviceEndpoint[] | null {
        const peer = this.#peer(nodeId);
        if (!peer.lifecycle.isSeeded) {
            return null;
        }
        return this.#deviceEndpoints(nodeId, peer);
    }

    #observePeer(peer: ClientNode): void {
        // @matter/general 0.18.0: a group holds on to what it observes until it is closed, so each peer has its own, which
        // goes when the peer does.
        const observers = new ObserverGroup();
        this.#peers.set(peer, { observers, nodeId: undefined });
        observers.on(peer.lifecycle.connectionStateChanged, (state) => {
            this.#report(peer, (nodeId) => {
                this.#bus.emit("$node:connection-changed", { nodeId, connection: toNodeConnection(state) });
            });
        });
        observers.on(peer.lifecycle.changed, (change, endpoint) => {
            // The peer is endpoint 0, which is not exposed.
            if (endpoint === peer) {
                return;
            }
            if (change === EndpointLifecycle.Change.PartsReady || change === EndpointLifecycle.Change.Destroyed) {
                this.#report(peer, (nodeId) => {
                    this.#bus.emit("$node:endpoints-changed", { nodeId });
                });
            } else if (change === EndpointLifecycle.Change.ServersChanged) {
                this.#report(peer, (nodeId) => {
                    this.#bus.emit("$endpoint:clusters-changed", { endpointId: endpointIdOf(nodeId, endpoint) });
                });
            }
        });
        observers.on(peer.lifecycle.seeded, () => {
            this.#report(peer, (nodeId) => {
                this.#bus.emit("$node:endpoints-changed", { nodeId });
            });
        });
    }

    // Nothing is reported of a peer with no address yet, nor of one being deleted: its deletion destroys each of its
    // endpoints, which is not a change of its structure, and `peers.deleted` reports it.
    #report(peer: ClientNode, emit: (nodeId: NodeId) => void): void {
        if (peer.lifecycle.isGone) {
            return;
        }
        const nodeId = this.#nodeIdOf(peer);
        if (nodeId !== undefined) {
            emit(nodeId);
        }
    }

    // The id is read once the peer has an address and kept from then on.
    #nodeIdOf(peer: ClientNode): NodeId | undefined {
        const observed = this.#peers.get(peer);
        if (observed?.nodeId !== undefined) {
            return observed.nodeId;
        }
        const nodeId = nodeIdOf(peer);
        if (observed !== undefined) {
            observed.nodeId = nodeId;
        }
        return nodeId;
    }

    #deviceEndpoints(nodeId: NodeId, peer: ClientNode): DeviceEndpoint[] {
        // @matter/node 0.18.0: the index of the node holds an endpoint from `installed`, before its state can be read.
        // `endpoints` indexes the whole tree, unlike `parts`, which holds only the direct children and would miss what
        // a bridge exposes.
        return peer.endpoints
            .filter((endpoint) => isExposed(endpoint) && endpoint.lifecycle.isPartsReady && !endpoint.lifecycle.isGone)
            .map((endpoint) => ({ nodeId, number: endpoint.number, name: defaultName(peer, endpoint) }));
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

    #peer(nodeId: NodeId): ClientNode {
        const peer = peerOf(this.#controller, nodeId);
        if (peer === undefined) {
            throw new NodeNotFoundError(nodeId);
        }
        return peer;
    }
}
