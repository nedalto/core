import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Lifecycle } from "@nedalto/contract/common/lifecycle.ts";

import { type HostProcess, run } from "../src/run.ts";

/** Records what `start()` and `stop()` do, and holds each until the test releases it. */
class FakeLifecycle implements Lifecycle {
    readonly calls: string[] = [];
    readonly startGate = Promise.withResolvers<void>();
    readonly stopGate = Promise.withResolvers<void>();
    readonly stopCalled = Promise.withResolvers<void>();
    readonly started = Promise.withResolvers<void>();

    async start(): Promise<void> {
        this.calls.push("start");
        await this.startGate.promise;
        this.calls.push("started");
        this.started.resolve();
    }

    async stop(): Promise<void> {
        this.calls.push("stop");
        this.stopCalled.resolve();
        await this.stopGate.promise;
    }
}

class FakeProcess implements HostProcess {
    readonly exits: number[] = [];
    readonly written: string[] = [];
    readonly stderr = {
        write: (text: string): void => {
            this.written.push(text);
        },
    };
    readonly #listeners = new Map<string, () => void>();

    on(signal: "SIGINT" | "SIGTERM", listener: () => void): void {
        this.#listeners.set(signal, listener);
    }

    exit(code: number): void {
        this.exits.push(code);
    }

    /** Like the real process, a signal nobody handles is not delivered to anything. */
    signal(name: "SIGINT" | "SIGTERM"): void {
        const listener = this.#listeners.get(name);
        if (listener === undefined) {
            throw new Error(`No handler for ${name}`);
        }
        listener();
    }
}

describe("run", () => {
    test("stops after start() finishes when a signal arrives during the start, and exits with 0", async () => {
        const lifecycle = new FakeLifecycle();
        const process = new FakeProcess();
        lifecycle.stopGate.resolve();
        const running = run({ lifecycle, process });

        process.signal("SIGTERM");
        lifecycle.startGate.resolve();
        await running;

        assert.deepEqual(lifecycle.calls, ["start", "started", "stop"]);
        assert.deepEqual(process.exits, [0]);
    });

    test("stops when a signal arrives after the start, and exits with 0", async () => {
        const lifecycle = new FakeLifecycle();
        const process = new FakeProcess();
        lifecycle.startGate.resolve();
        lifecycle.stopGate.resolve();
        const running = run({ lifecycle, process });
        await lifecycle.started.promise;

        process.signal("SIGINT");
        await running;

        assert.deepEqual(lifecycle.calls, ["start", "started", "stop"]);
        assert.deepEqual(process.exits, [0]);
    });

    test("does not stop again on a second signal while it stops", async () => {
        const lifecycle = new FakeLifecycle();
        const process = new FakeProcess();
        lifecycle.startGate.resolve();
        const running = run({ lifecycle, process });
        await lifecycle.started.promise;

        process.signal("SIGTERM");
        await lifecycle.stopCalled.promise;
        process.signal("SIGINT");
        process.signal("SIGTERM");
        lifecycle.stopGate.resolve();
        await running;

        assert.deepEqual(lifecycle.calls, ["start", "started", "stop"]);
        assert.deepEqual(process.exits, [0]);
    });

    test("writes the error to stderr and exits with 1 without stopping when start() fails", async () => {
        const lifecycle = new FakeLifecycle();
        const process = new FakeProcess();
        lifecycle.stopGate.resolve();
        const running = run({ lifecycle, process });

        lifecycle.startGate.reject(new Error("port in use"));
        await running;

        assert.deepEqual(lifecycle.calls, ["start"]);
        assert.deepEqual(process.exits, [1]);
        assert.match(process.written.join(""), /port in use/);
    });
});
