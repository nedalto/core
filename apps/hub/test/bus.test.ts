import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createRoomId } from "@nedalto/contract/common/ids.ts";
import type { DomainEventMap } from "@nedalto/contract/events.ts";
import type { Logger } from "@nedalto/contract/logger/ports.ts";

import { createSyncEventBus } from "../src/bus.ts";

class RecordingLogger implements Logger {
    readonly errors: unknown[][] = [];

    error(...values: unknown[]): void {
        this.errors.push(values);
    }

    get(): Logger {
        return this;
    }

    debug(): never {
        throw new Error("Unexpected call");
    }

    info(): never {
        throw new Error("Unexpected call");
    }

    notice(): never {
        throw new Error("Unexpected call");
    }

    warn(): never {
        throw new Error("Unexpected call");
    }

    fatal(): never {
        throw new Error("Unexpected call");
    }
}

const removed = (): DomainEventMap["room:removed"] => ({ roomId: createRoomId(), timestamp: 0 });

describe("createSyncEventBus", () => {
    test("delivers an event to the handlers of that event and to no other", () => {
        const bus = createSyncEventBus(new RecordingLogger());
        const received: unknown[] = [];
        const renamed: unknown[] = [];
        bus.on("room:removed", (payload) => received.push(payload));
        bus.on("room:removed", (payload) => received.push(payload));
        bus.on("room:renamed", (payload) => renamed.push(payload));

        const payload = removed();
        bus.emit("room:removed", payload);
        assert.deepEqual(received, [payload, payload]);
        assert.deepEqual(renamed, []);

        const rename = { roomId: createRoomId(), name: "Kitchen", timestamp: 0 };
        bus.emit("room:renamed", rename);
        assert.deepEqual(received, [payload, payload]);
        assert.deepEqual(renamed, [rename]);
    });

    test("logs a handler that throws, still delivers to the rest and does not throw to the emitter", () => {
        const logger = new RecordingLogger();
        const bus = createSyncEventBus(logger);
        const failure = new Error("handler failed");
        const received: unknown[] = [];
        bus.on("room:removed", () => {
            throw failure;
        });
        bus.on("room:removed", (payload) => received.push(payload));

        const payload = removed();
        bus.emit("room:removed", payload);

        assert.deepEqual(received, [payload]);
        assert.equal(logger.errors.length, 1);
        assert.equal(logger.errors[0]?.includes(failure), true);
    });

    test("does not deliver the event in flight to a handler added while emitting", () => {
        const bus = createSyncEventBus(new RecordingLogger());
        const late: unknown[] = [];
        bus.on("room:removed", () => {
            bus.on("room:removed", (payload) => late.push(payload));
        });

        const first = removed();
        bus.emit("room:removed", first);
        assert.deepEqual(late, []);

        const second = removed();
        bus.emit("room:removed", second);
        assert.deepEqual(late, [second]);
    });

    test("stops delivering after the unsubscribe", () => {
        const bus = createSyncEventBus(new RecordingLogger());
        const received: unknown[] = [];
        const unsubscribe = bus.on("room:removed", (payload) => received.push(payload));

        unsubscribe();
        bus.emit("room:removed", removed());

        assert.deepEqual(received, []);
    });

    test("keeps a later subscription of the same handler when an unsubscribe is called twice", () => {
        const bus = createSyncEventBus(new RecordingLogger());
        const received: unknown[] = [];
        const handler = (payload: unknown): void => {
            received.push(payload);
        };
        const unsubscribe = bus.on("room:removed", handler);
        unsubscribe();
        bus.on("room:removed", handler);

        unsubscribe();
        const payload = removed();
        bus.emit("room:removed", payload);

        assert.deepEqual(received, [payload]);
    });
});
