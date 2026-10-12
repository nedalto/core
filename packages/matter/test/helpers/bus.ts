import { EventEmitter } from "node:events";

import type { Unsubscribe } from "@nedalto/contract/common/bus.ts";
import type { DomainEventBus, DomainEventMap } from "@nedalto/contract/events.ts";

/** A `DomainEventBus` that keeps what was emitted and lets a test await the next event of a name. */
export class RecordingBus implements DomainEventBus {
    readonly emitted: { name: keyof DomainEventMap; payload: unknown }[] = [];
    readonly #emitter = new EventEmitter();

    emit<K extends keyof DomainEventMap>(name: K, payload: DomainEventMap[K]): void {
        this.emitted.push({ name, payload });
        this.#emitter.emit(name, payload);
    }

    on<K extends keyof DomainEventMap>(name: K, handler: (payload: DomainEventMap[K]) => void): Unsubscribe {
        this.#emitter.on(name, handler);
        return () => {
            this.#emitter.off(name, handler);
        };
    }

    /** Resolves with the payload of the next `name` event that satisfies `matches`. */
    next<K extends keyof DomainEventMap>(
        name: K,
        matches: (payload: DomainEventMap[K]) => boolean = () => true,
    ): Promise<DomainEventMap[K]> {
        return new Promise((resolve) => {
            const unsubscribe = this.on(name, (payload) => {
                if (matches(payload)) {
                    unsubscribe();
                    resolve(payload);
                }
            });
        });
    }
}
