import type { Logger } from "@nedalto/contract/logger/ports.ts";
import type { JsonRpcResponse } from "@nedalto/contract/server/schemas.ts";
import { JsonRpcErrorCode } from "@nedalto/contract/server/types.ts";

import { errorResponse, isUnexpected, type ParseOutcome, successResponse, toJsonRpcError } from "./wire.ts";

type Handler = (params: unknown) => unknown;

/** Routes parsed client messages to the handler of their method. */
export class Dispatcher {
    readonly #logger: Logger;
    // A map, so that a method named `toString` is not found in the prototype of a plain object.
    readonly #handlers: ReadonlyMap<string, Handler>;

    constructor(logger: Logger, handlers: Readonly<Record<string, Handler>>) {
        this.#logger = logger;
        this.#handlers = new Map(Object.entries(handlers));
    }

    /** The response to send, or `null` if there is none. */
    async route(outcome: ParseOutcome): Promise<JsonRpcResponse | null> {
        if ("error" in outcome) {
            return outcome.error;
        }
        if ("notification" in outcome) {
            this.#logger.debug("discarded client notification", outcome.notification.method);
            return null;
        }

        const { id, method, params } = outcome.request;
        const handler = this.#handlers.get(method);
        if (handler === undefined) {
            return errorResponse(id, {
                code: JsonRpcErrorCode.MethodNotFound,
                message: "Method not found",
                data: { method },
            });
        }

        try {
            return successResponse(id, await handler(params));
        } catch (error) {
            if (isUnexpected(error)) {
                this.#logger.error("handler failed unexpectedly", method, error);
            }
            return errorResponse(id, toJsonRpcError(error));
        }
    }
}
