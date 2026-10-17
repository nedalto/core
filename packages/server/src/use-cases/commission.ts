import type { NodeId } from "@nedalto/contract/common/ids.ts";
import type { Transactor } from "@nedalto/contract/database/ports.ts";
import type { EndpointRepository } from "@nedalto/contract/endpoint/ports.ts";
import type { EndpointState } from "@nedalto/contract/endpoint/types.ts";
import type { DomainEventBus } from "@nedalto/contract/events.ts";
import type { Logger } from "@nedalto/contract/logger/ports.ts";
import type { NodeGateway, NodeRepository } from "@nedalto/contract/node/ports.ts";
import type { CommissioningResult } from "@nedalto/contract/node/types.ts";

import { composeEndpoint, type EndpointComposition } from "../views/endpoint.ts";

export interface CommissionUseCaseDeps extends EndpointComposition {
    readonly nodeRepository: NodeRepository;
    readonly endpointRepository: EndpointRepository;
    readonly transactor: Transactor;
    readonly nodeGateway: NodeGateway;
    readonly bus: DomainEventBus;
}

/** Joins a device to the fabric, stores it and announces it. */
export class CommissionUseCase {
    readonly #logger: Logger;
    readonly #nodeRepository: NodeRepository;
    readonly #endpointRepository: EndpointRepository;
    readonly #transactor: Transactor;
    readonly #nodeGateway: NodeGateway;
    readonly #bus: DomainEventBus;
    readonly #composition: EndpointComposition;

    constructor({
        logger,
        nodeRepository,
        endpointRepository,
        transactor,
        nodeGateway,
        endpointGateway,
        bus,
    }: CommissionUseCaseDeps) {
        this.#logger = logger;
        this.#nodeRepository = nodeRepository;
        this.#endpointRepository = endpointRepository;
        this.#transactor = transactor;
        this.#nodeGateway = nodeGateway;
        this.#bus = bus;
        this.#composition = { logger, endpointGateway };
    }

    /**
     * Stores the node and its endpoints in one transaction and emits `node:added`.
     * If the transaction fails, the device is taken out of the fabric again and the error is thrown.
     */
    async execute(setupCode: string): Promise<NodeId> {
        const result = await this.#nodeGateway.commission(setupCode);
        try {
            this.#transactor.run(() => {
                this.#nodeRepository.save(result.node);
                for (const endpoint of result.endpoints) {
                    this.#endpointRepository.save(endpoint);
                }
            });
        } catch (error) {
            await this.#leaveFabric(result.node.id);
            throw error;
        }
        this.#announce(result);
        return result.node.id;
    }

    // No `await` from the write to the emit, so no change of the node is announced between composing it and emitting it.
    #announce({ node, endpoints }: CommissioningResult): void {
        const states: EndpointState[] = [];
        for (const record of endpoints) {
            const state = composeEndpoint(this.#composition, record);
            if (state !== null) {
                states.push(state);
            }
        }
        this.#bus.emit("node:added", {
            node: { id: node.id, reachable: this.#nodeGateway.isReachable(node.id) },
            endpoints: states,
            timestamp: Date.now(),
        });
    }

    async #leaveFabric(nodeId: NodeId): Promise<void> {
        try {
            await this.#nodeGateway.decommission(nodeId);
        } catch (error) {
            this.#logger.error("device stays in the fabric with no record of it", nodeId, error);
        }
    }
}
