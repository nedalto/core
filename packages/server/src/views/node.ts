import type { NodeId } from "@nedalto/contract/common/ids.ts";
import { NodeNotFoundError } from "@nedalto/contract/node/errors.ts";
import type { NodeGateway, NodeRepository } from "@nedalto/contract/node/ports.ts";
import type { NodeRecord, NodeState } from "@nedalto/contract/node/types.ts";

export interface NodeViewDeps {
    readonly nodeRepository: NodeRepository;
    readonly nodeGateway: NodeGateway;
}

/** What a client sees of the nodes: the stored ones, each with whether it answers now. */
export class NodeView {
    readonly #repository: NodeRepository;
    readonly #gateway: NodeGateway;

    constructor({ nodeRepository, nodeGateway }: NodeViewDeps) {
        this.#repository = nodeRepository;
        this.#gateway = nodeGateway;
    }

    list(): NodeState[] {
        return this.#repository.findAll().map((record) => this.#compose(record));
    }

    /** Throws `NodeNotFoundError` if the node does not exist. */
    get(id: NodeId): NodeState {
        const record = this.#repository.findById(id);
        if (record === null) {
            throw new NodeNotFoundError(id);
        }
        return this.#compose(record);
    }

    #compose({ id }: NodeRecord): NodeState {
        return { id, reachable: this.#gateway.isReachable(id) };
    }
}
