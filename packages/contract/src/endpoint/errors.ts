import { NotFoundError } from "../common/errors.ts";
import type { EndpointId } from "../common/ids.ts";

/** The endpoint does not exist. */
export class EndpointNotFoundError extends NotFoundError {
    constructor(endpointId: EndpointId) {
        super(`Endpoint ${endpointId} not found`, { data: { endpointId } });
    }
}
