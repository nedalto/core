import { IntegrationError, NotFoundError, UnreachableError } from "../common/errors.ts";
import type { EndpointId } from "../common/ids.ts";

/** The endpoint does not exist. */
export class EndpointNotFoundError extends NotFoundError {
    constructor(endpointId: EndpointId) {
        super(`Endpoint ${endpointId} not found`, { data: { endpointId } });
    }
}

/** The endpoint does not serve the attribute. */
export class AttributeNotFoundError extends NotFoundError {
    constructor(endpointId: EndpointId, clusterId: number, attributeId: number) {
        super(`Attribute ${attributeId} of cluster ${clusterId} not found on endpoint ${endpointId}`, {
            data: { endpointId, clusterId, attributeId },
        });
    }
}

/** The cluster has no such command. */
export class CommandNotFoundError extends NotFoundError {
    constructor(endpointId: EndpointId, clusterId: number, commandId: number) {
        super(`Command ${commandId} of cluster ${clusterId} not found on endpoint ${endpointId}`, {
            data: { endpointId, clusterId, commandId },
        });
    }
}

/** The device refused the request. `data.status` is the status code it answered with. */
export class InteractionRejectedError extends IntegrationError {
    constructor(
        endpointId: EndpointId,
        clusterId: number,
        target: { readonly attributeId: number } | { readonly commandId: number },
        status: number,
    ) {
        super(`Device rejected the request on cluster ${clusterId} of endpoint ${endpointId}: status ${status}`, {
            data: { endpointId, clusterId, ...target, status },
        });
    }
}

/** The endpoint did not answer. `data.reason` tells a sleeping device, which wakes by itself, from an offline one. */
export class EndpointUnreachableError extends UnreachableError {
    constructor(endpointId: EndpointId, reason: "asleep" | "offline", cause: unknown) {
        super(`Endpoint ${endpointId} is unreachable: ${reason}`, { cause, data: { endpointId, reason } });
    }
}
