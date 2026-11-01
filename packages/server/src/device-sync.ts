import type { Unsubscribe } from "@nedalto/contract/common/bus.ts";
import type { NodeId } from "@nedalto/contract/common/ids.ts";
import type { Lifecycle } from "@nedalto/contract/common/lifecycle.ts";
import type { Transactor } from "@nedalto/contract/database/ports.ts";
import type { EndpointGateway, EndpointRepository } from "@nedalto/contract/endpoint/ports.ts";
import type { DomainEventBus } from "@nedalto/contract/events.ts";
import type { Logger } from "@nedalto/contract/logger/ports.ts";
import { NodeNotFoundError } from "@nedalto/contract/node/errors.ts";
import type { NodeGateway, NodeRepository } from "@nedalto/contract/node/ports.ts";
import type { EndpointChanges } from "@nedalto/contract/node/types.ts";

import { EndpointView } from "./views/endpoint.ts";

/** The ports the component reads, writes and reports through. */
export interface DeviceSyncDeps {
    readonly logger: Logger;
    readonly nodeRepository: NodeRepository;
    readonly endpointRepository: EndpointRepository;
    readonly transactor: Transactor;
    readonly nodeGateway: NodeGateway;
    readonly endpointGateway: EndpointGateway;
    readonly bus: DomainEventBus;
}

// Stores and announces what changes on the devices by itself: the endpoints they gain or lose and the nodes the SDK
// deletes. See `docs/decisions/0008-endpoints-that-change-on-the-device.md`.
class DeviceSync implements Lifecycle {
    readonly #logger: Logger;
    readonly #nodeRepository: NodeRepository;
    readonly #endpointRepository: EndpointRepository;
    readonly #transactor: Transactor;
    readonly #nodeGateway: NodeGateway;
    readonly #bus: DomainEventBus;
    readonly #endpointView: EndpointView;
    #unsubscribes: readonly Unsubscribe[] = [];

    constructor({
        logger,
        nodeRepository,
        endpointRepository,
        transactor,
        nodeGateway,
        endpointGateway,
        bus,
    }: DeviceSyncDeps) {
        this.#logger = logger;
        this.#nodeRepository = nodeRepository;
        this.#endpointRepository = endpointRepository;
        this.#transactor = transactor;
        this.#nodeGateway = nodeGateway;
        this.#bus = bus;
        this.#endpointView = new EndpointView({ logger, endpointRepository, endpointGateway });
    }

    async start(): Promise<void> {
        // Subscribed first: what changes before this is found by the pass below, and nothing is left in between.
        this.#unsubscribes = [
            this.#nodeGateway.onStructureChanged((nodeId) => this.#onStructureChanged(nodeId)),
            this.#nodeGateway.onNodeDeleted((nodeId) => this.#onNodeDeleted(nodeId)),
        ];
        for (const { id } of this.#nodeRepository.findAll()) {
            try {
                this.#reconcile(id);
            } catch (error) {
                // A stored node without a peer, which the controller warned about when it started.
                if (!(error instanceof NodeNotFoundError)) {
                    throw error;
                }
            }
        }
    }

    async stop(): Promise<void> {
        for (const unsubscribe of this.#unsubscribes) {
            unsubscribe();
        }
        this.#unsubscribes = [];
    }

    #onStructureChanged(nodeId: NodeId): void {
        try {
            this.#reconcile(nodeId);
        } catch (error) {
            // The gateway already follows the device, so the database stays behind until the next start finds it.
            this.#logger.error("the endpoints of the node changed but could not be stored", nodeId, error);
        }
    }

    #onNodeDeleted(nodeId: NodeId): void {
        try {
            this.#nodeRepository.delete(nodeId);
        } catch (error) {
            this.#logger.error("the SDK deleted the node but it could not be deleted", nodeId, error);
            return;
        }
        this.#bus.emit("node:removed", { nodeId, timestamp: Date.now() });
    }

    // No `await` from the gateway to the emit, so no attribute of a new endpoint is announced before the endpoint.
    #reconcile(nodeId: NodeId): void {
        const changes = this.#nodeGateway.reconcileEndpoints(nodeId);
        if (changes.added.length === 0 && changes.removed.length === 0) {
            return;
        }
        this.#transactor.run(() => {
            for (const endpointId of changes.removed) {
                this.#endpointRepository.delete(endpointId);
            }
            for (const record of changes.added) {
                this.#endpointRepository.save(record);
            }
        });
        this.#announce(changes);
    }

    #announce({ added, removed }: EndpointChanges): void {
        for (const endpointId of removed) {
            this.#bus.emit("endpoint:removed", { endpointId, timestamp: Date.now() });
        }
        for (const { id } of added) {
            this.#bus.emit("endpoint:added", { endpoint: this.#endpointView.get(id), timestamp: Date.now() });
        }
    }
}

/**
 * The component that keeps the database and the clients up to date with the devices; nothing happens until `start()`,
 * which rejects if what it finds cannot be stored.
 */
export const createDeviceSync = ({ logger, ...deps }: DeviceSyncDeps): Lifecycle =>
    new DeviceSync({ logger: logger.get("DeviceSync"), ...deps });
