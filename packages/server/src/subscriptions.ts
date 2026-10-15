import { WebSocket } from "ws";

import { encode } from "@nedalto/contract/common/wire.ts";
import type { DomainEventMap } from "@nedalto/contract/events.ts";
import type { Logger } from "@nedalto/contract/logger/ports.ts";
import { type JsonRpcRequest, validateSubscribeParams } from "@nedalto/contract/server/schemas.ts";
import type { MethodMap } from "@nedalto/contract/server/types.ts";

import type { SUBSCRIBE_METHOD } from "./methods.ts";
import type { RoomView } from "./views/room.ts";
import { errorResponse, isUnexpected, notification, successResponse, toJsonRpcError } from "./wire.ts";

export interface SubscriptionsDeps {
    readonly logger: Logger;
    readonly roomView: RoomView;
}

/** The connections that receive every event of the bus. */
export class Subscriptions {
    readonly #logger: Logger;
    readonly #roomView: RoomView;
    readonly #subscribers = new Set<WebSocket>();

    constructor({ logger, roomView }: SubscriptionsDeps) {
        this.#logger = logger;
        this.#roomView = roomView;
    }

    /** Answers `hub.subscribe` with the snapshot and adds the connection, with no `await` in between. */
    subscribe(ws: WebSocket, request: JsonRpcRequest): void {
        try {
            validateSubscribeParams(request.params);
            const snapshot: MethodMap[typeof SUBSCRIBE_METHOD]["result"] = { rooms: this.#roomView.list() };
            ws.send(encode(successResponse(request.id, snapshot)));
            this.#subscribers.add(ws);
        } catch (error) {
            if (isUnexpected(error)) {
                this.#logger.error("handler failed unexpectedly", request.method, error);
            }
            ws.send(encode(errorResponse(request.id, toJsonRpcError(error))));
        }
    }

    forward<K extends keyof DomainEventMap>(eventName: K, payload: DomainEventMap[K]): void {
        const frame = encode(notification(eventName, payload));
        for (const ws of this.#subscribers) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(frame);
            }
        }
    }

    remove(ws: WebSocket): void {
        this.#subscribers.delete(ws);
    }
}
