import type { NodeId } from "@nedalto/contract/common/ids.ts";
import type { DomainEventBus } from "@nedalto/contract/events.ts";
import type { Logger } from "@nedalto/contract/logger/ports.ts";
import { NodeNotFoundError } from "@nedalto/contract/node/errors.ts";
import type { NodeGateway, NodeRepository } from "@nedalto/contract/node/ports.ts";

export interface DecommissionUseCaseDeps {
    readonly logger: Logger;
    readonly nodeRepository: NodeRepository;
    readonly nodeGateway: NodeGateway;
    readonly bus: DomainEventBus;
}

/** Takes a node out of the fabric, deletes it and announces it. */
export class DecommissionUseCase {
    readonly #logger: Logger;
    readonly #nodeRepository: NodeRepository;
    readonly #nodeGateway: NodeGateway;
    readonly #bus: DomainEventBus;

    constructor({ logger, nodeRepository, nodeGateway, bus }: DecommissionUseCaseDeps) {
        this.#logger = logger;
        this.#nodeRepository = nodeRepository;
        this.#nodeGateway = nodeGateway;
        this.#bus = bus;
    }

    /**
     * Throws `NodeNotFoundError` if the node is not stored.
     * Whatever the gateway throws for the fabric, other than not knowing the node, is thrown and the node is kept.
     */
    async execute(id: NodeId, force?: boolean): Promise<void> {
        if (this.#nodeRepository.findById(id) === null) {
            throw new NodeNotFoundError(id);
        }

        try {
            await this.#nodeGateway.decommission(id, force);
        } catch (error) {
            if (!(error instanceof NodeNotFoundError)) {
                throw error;
            }
            this.#logger.notice("node has no peer, deleting it from the database only", id);
        }

        try {
            this.#nodeRepository.delete(id);
        } catch (error) {
            // Not found: a decommissioning of the same node that ran alongside this one deleted it first.
            if (!(error instanceof NodeNotFoundError)) {
                // The fabric no longer holds the node, so a retry deletes it from the database only.
                this.#logger.error("node left the fabric but could not be deleted", id, error);
            }
            throw error;
        }
        this.#bus.emit("node:removed", { nodeId: id, timestamp: Date.now() });
    }
}
