import type { EndpointId } from "@nedalto/contract/common/ids.ts";
import { EndpointNotFoundError } from "@nedalto/contract/endpoint/errors.ts";
import type { EndpointGateway, EndpointRepository } from "@nedalto/contract/endpoint/ports.ts";
import type { EndpointRecord, EndpointShape, EndpointState } from "@nedalto/contract/endpoint/types.ts";
import type { Logger } from "@nedalto/contract/logger/ports.ts";

export interface EndpointComposition {
    readonly logger: Logger;
    readonly endpointGateway: EndpointGateway;
}

/**
 * The state of the endpoint: its record joined with the shape the gateway describes.
 * It is `null`, with a warning, when the gateway cannot describe it: the node has no peer, or no longer has the endpoint.
 */
export function composeEndpoint(
    { logger, endpointGateway }: EndpointComposition,
    record: EndpointRecord,
): EndpointState | null {
    let shape: EndpointShape;
    try {
        shape = endpointGateway.describe(record.id);
    } catch (error) {
        logger.warn("endpoint left out, it cannot be described", record.id, error);
        return null;
    }
    return {
        id: record.id,
        nodeId: record.nodeId,
        deviceType: shape.deviceType,
        name: record.name,
        roomId: record.roomId,
        clusters: shape.clusters,
    };
}

export interface EndpointViewDeps extends EndpointComposition {
    readonly endpointRepository: EndpointRepository;
}

/** What a client sees of the endpoints. One that cannot be described is left out of `list`. */
export class EndpointView {
    readonly #repository: EndpointRepository;
    readonly #composition: EndpointComposition;

    constructor({ logger, endpointRepository, endpointGateway }: EndpointViewDeps) {
        this.#repository = endpointRepository;
        this.#composition = { logger, endpointGateway };
    }

    list(): EndpointState[] {
        return this.#repository.findAll().flatMap((record) => composeEndpoint(this.#composition, record) ?? []);
    }

    /** Throws `EndpointNotFoundError` if the endpoint does not exist or cannot be described. */
    get(id: EndpointId): EndpointState {
        const record = this.#repository.findById(id);
        const state = record === null ? null : composeEndpoint(this.#composition, record);
        if (state === null) {
            throw new EndpointNotFoundError(id);
        }
        return state;
    }
}
