import { EventEmitter } from "node:events";

import type { Unsubscribe } from "@nedalto/contract/common/bus.ts";
import type { DeviceEventBus, DeviceEventMap } from "@nedalto/contract/device-events.ts";

/** A `DeviceEventBus` that keeps what was emitted and lets a test await the next event of a name. */
export class RecordingBus implements DeviceEventBus {
    readonly emitted: { name: keyof DeviceEventMap; payload: unknown }[] = [];
    readonly #emitter = new EventEmitter();

    emit<K extends keyof DeviceEventMap>(name: K, payload: DeviceEventMap[K]): void {
        this.emitted.push({ name, payload });
        this.#emitter.emit(name, payload);
    }

    on<K extends keyof DeviceEventMap>(name: K, handler: (payload: DeviceEventMap[K]) => void): Unsubscribe {
        this.#emitter.on(name, handler);
        return () => {
            this.#emitter.off(name, handler);
        };
    }

    /** Resolves with the payload of the next `name` event that satisfies `matches`. */
    next<K extends keyof DeviceEventMap>(
        name: K,
        matches: (payload: DeviceEventMap[K]) => boolean = () => true,
    ): Promise<DeviceEventMap[K]> {
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
