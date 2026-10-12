import "../src/sdk-config.ts";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { describe, test } from "node:test";

import { Environment, Logger, LogLevel as SdkLogLevel } from "@matter/main";

import { LogLevel } from "@nedalto/contract/logger/types.ts";

import { configureEnvironment } from "../src/environment.ts";

// `configureEnvironment` changes `Environment.default` and the destination of the SDK's `Logger`, which are
// global to the process. `node --test` runs each file in its own process, so what these tests change does not
// reach the other files, which is why they live apart.

class MemorySink extends Writable {
    readonly chunks: string[] = [];

    override _write(chunk: Buffer, _encoding: string, callback: () => void): void {
        this.chunks.push(chunk.toString());
        callback();
    }
}

describe("configureEnvironment", () => {
    test("returns the default environment, storing under the given path", () => {
        const environment = configureEnvironment("/storage", new MemorySink(), { logLevel: LogLevel.Info });

        assert.equal(environment, Environment.default);
        assert.equal(environment.vars.get("storage.path"), "/storage");
    });

    test("limits mDNS to the configured network interface", () => {
        const environment = configureEnvironment("/storage", new MemorySink(), {
            networkInterface: "wlan0",
            logLevel: LogLevel.Info,
        });

        assert.equal(environment.vars.get("mdns.networkInterface"), "wlan0");
    });

    test("writes the SDK log to the stream, one plain line each", () => {
        const sink = new MemorySink();
        configureEnvironment("/storage", sink, { logLevel: LogLevel.Info });

        Logger.get("Probe").info("hello");

        assert.equal(sink.chunks.length, 1);
        assert.match(sink.chunks[0] ?? "", /INFO Probe hello\n$/);
    });

    for (const level of Object.values(LogLevel)) {
        test(`sets the SDK log level to ${level}`, () => {
            configureEnvironment("/storage", new MemorySink(), { logLevel: level });

            assert.equal(SdkLogLevel.names[SdkLogLevel(Logger.level)], level);
        });
    }

    test("writes only what reaches the configured level", () => {
        const sink = new MemorySink();
        configureEnvironment("/storage", sink, { logLevel: LogLevel.Warn });

        Logger.get("Probe").info("quiet");
        Logger.get("Probe").warn("loud");

        assert.equal(sink.chunks.length, 1);
        assert.match(sink.chunks[0] ?? "", /WARN Probe loud\n$/);
    });
});
