import type { Unsubscribe } from "@nedalto/contract/common/bus.ts";
import type { DomainEventBus, DomainEventMap } from "@nedalto/contract/events.ts";
import type { Logger } from "@nedalto/contract/logger/ports.ts";

type EventName = keyof DomainEventMap;
type Handler<K extends EventName> = (payload: DomainEventMap[K]) => void;
type Subscriptions = { [K in EventName]: Set<Handler<K>> };

class SyncEventBus implements DomainEventBus {
    readonly #logger: Logger;
    // A set per event, all created here: the compiler rejects an event of the map left out.
    readonly #subscriptions: Subscriptions = {
        "node:added": new Set(),
        "node:removed": new Set(),
        "node:connected": new Set(),
        "node:disconnected": new Set(),
        "endpoint:changed": new Set(),
        "endpoint:renamed": new Set(),
        "endpoint:room-changed": new Set(),
        "room:added": new Set(),
        "room:renamed": new Set(),
        "room:removed": new Set(),
    };

    constructor(logger: Logger) {
        this.#logger = logger;
    }

    emit<K extends EventName>(eventName: K, payload: DomainEventMap[K]): void {
        // A copy, so that a handler added by another handler waits for the next event.
        for (const handler of this.#subscriptions[eventName].values().toArray()) {
            try {
                handler(payload);
            } catch (error) {
                this.#logger.error("event handler failed", eventName, error);
            }
        }
    }

    on<K extends EventName>(eventName: K, handler: Handler<K>): Unsubscribe {
        // A function of its own per subscription, so that removing it never touches another
        // subscription of the same handler.
        const subscription: Handler<K> = (payload) => handler(payload);
        this.#subscriptions[eventName].add(subscription);
        return () => {
            this.#subscriptions[eventName].delete(subscription);
        };
    }
}

/** A `DomainEventBus` that logs the handlers that throw, with `logger`. */
export const createSyncEventBus = (logger: Logger): DomainEventBus => new SyncEventBus(logger.get("EventBus"));
