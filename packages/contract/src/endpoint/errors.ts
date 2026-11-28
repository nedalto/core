import { IntegrationError, NotFoundError, UnreachableError } from "../common/errors.ts";
import type { EndpointId } from "../common/ids.ts";

// Matter writes ids in hexadecimal; this is how @matter/types 0.18.0 writes them in its log.
const hex = (id: number): string => `0x${id.toString(16)}`;

/** The endpoint does not exist. */
export class EndpointNotFoundError extends NotFoundError {
    declare readonly data: { readonly endpointId: EndpointId };

    constructor(endpointId: EndpointId) {
        super(`Endpoint ${endpointId} not found`, { data: { endpointId } satisfies EndpointNotFoundError["data"] });
    }
}

/** The endpoint does not have the attribute. */
export class AttributeNotFoundError extends NotFoundError {
    declare readonly data: {
        readonly endpointId: EndpointId;
        readonly clusterId: number;
        readonly attributeId: number;
    };

    constructor(endpointId: EndpointId, clusterId: number, attributeId: number) {
        super(`Attribute ${hex(attributeId)} of cluster ${hex(clusterId)} not found on endpoint ${endpointId}`, {
            data: { endpointId, clusterId, attributeId } satisfies AttributeNotFoundError["data"],
        });
    }
}

/** The endpoint does not accept the command. */
export class CommandNotFoundError extends NotFoundError {
    declare readonly data: { readonly endpointId: EndpointId; readonly clusterId: number; readonly commandId: number };

    constructor(endpointId: EndpointId, clusterId: number, commandId: number) {
        super(`Command ${hex(commandId)} of cluster ${hex(clusterId)} not found on endpoint ${endpointId}`, {
            data: { endpointId, clusterId, commandId } satisfies CommandNotFoundError["data"],
        });
    }
}

type InteractionTarget = { readonly attributeId: number } | { readonly commandId: number };

// What the device answered: a Matter status code, and the status code of the cluster when it gives one.
type InteractionStatus = { readonly status: number; readonly clusterStatus?: number };

/**
 * The device refused the request. `data.status` is the Matter status code it answered with, and `data.clusterStatus`
 * the status code of the cluster, when the device gives one, as a lock does for a duplicate code.
 */
export class InteractionRejectedError extends IntegrationError {
    declare readonly data: {
        readonly endpointId: EndpointId;
        readonly clusterId: number;
        readonly status: number;
        readonly clusterStatus?: number;
    } & InteractionTarget;

    constructor(
        endpointId: EndpointId,
        clusterId: number,
        target: InteractionTarget,
        { status, clusterStatus }: InteractionStatus,
    ) {
        super(
            `Device rejected the request on cluster ${hex(clusterId)} of endpoint ${endpointId}: status ` +
                (clusterStatus === undefined ? hex(status) : `${hex(status)}, cluster status ${hex(clusterStatus)}`),
            {
                data: {
                    endpointId,
                    clusterId,
                    ...target,
                    status,
                    ...(clusterStatus === undefined ? {} : { clusterStatus }),
                } satisfies InteractionRejectedError["data"],
            },
        );
    }
}

type EndpointUnreachabilityReason = "asleep" | "no-response";

/**
 * The endpoint did not answer. `data.reason` says what the hub knows:
 * - `asleep`: the device sleeps and did not wake within the wait; the hub held the request and never sent it, so
 *   repeating it is safe.
 * - `no-response`: no answer arrived. A write or a command may have been applied, and the changes of attributes
 *   tell how the device was left.
 */
export class EndpointUnreachableError extends UnreachableError {
    declare readonly data: { readonly endpointId: EndpointId; readonly reason: EndpointUnreachabilityReason };

    constructor(endpointId: EndpointId, reason: EndpointUnreachabilityReason, cause: unknown) {
        super(`Endpoint ${endpointId} is unreachable: ${reason}`, {
            cause,
            data: { endpointId, reason } satisfies EndpointUnreachableError["data"],
        });
    }
}
