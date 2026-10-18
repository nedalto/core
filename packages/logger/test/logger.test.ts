import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { describe, test } from "node:test";
import { inspect } from "node:util";

import { LogLevel } from "@nedalto/contract/logger/types.ts";

import { createLogger } from "../src/logger.ts";
import { captureStderr } from "./helpers/stderr.ts";

class MemorySink extends Writable {
    readonly lines: string[] = [];

    override _write(chunk: Buffer, _encoding: string, callback: () => void): void {
        this.lines.push(chunk.toString());
        callback();
    }

    /** The only line written so far; fails if there is not exactly one. */
    get only(): string {
        const [line] = this.lines;
        assert.equal(this.lines.length, 1);
        assert.ok(line !== undefined);
        return line;
    }
}

describe("createLogger", () => {
    test("writes a line with the level, facility and values", () => {
        const sink = new MemorySink();

        createLogger(sink, LogLevel.Debug, "App").info("hello", "world");

        assert.match(sink.only, / INFO App hello world\n$/);
    });

    test("starts the line with the local time, zero-padded", (context) => {
        const sink = new MemorySink();
        context.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 0, 2, 3, 4, 5, 6) });

        createLogger(sink, LogLevel.Info, "App").info("hello");

        assert.ok(sink.only.startsWith("2026-01-02 03:04:05.006 INFO"));
    });

    test("ends the line at the facility when called without values", () => {
        const sink = new MemorySink();

        createLogger(sink, LogLevel.Info, "App").info();

        assert.match(sink.only, / INFO App\n$/);
    });

    test("drops the calls below the level and writes the rest", () => {
        const sink = new MemorySink();
        const logger = createLogger(sink, LogLevel.Warn, "App");

        logger.debug("dropped");
        logger.info("dropped");
        logger.notice("dropped");
        logger.warn("written");
        logger.error("written");
        logger.fatal("written");

        assert.deepEqual(
            sink.lines.map((line) => line.split(" ")[2]),
            ["WARN", "ERROR", "FATAL"],
        );
    });

    test("renders values other than strings with inspect", () => {
        const sink = new MemorySink();

        createLogger(sink, LogLevel.Info, "App").info("count:", 42, { key: "value" });

        assert.match(sink.only, / INFO App count: 42 \{ key: 'value' \}\n$/);
    });

    test("renders an Error with its stack", () => {
        const sink = new MemorySink();

        createLogger(sink, LogLevel.Info, "App").error(new Error("boom"));

        assert.match(sink.only, /Error: boom\n\s+at /);
    });

    test("reports the line head to stderr instead of throwing when a value cannot be rendered", async () => {
        const sink = new MemorySink();
        const unrenderable = {
            [inspect.custom]() {
                throw new Error("boom");
            },
        };

        const written = await captureStderr(() => {
            createLogger(sink, LogLevel.Info, "App").info("message", unrenderable);
        });

        assert.equal(sink.lines.length, 0);
        assert.equal(written.length, 1);
        assert.match(written[0] ?? "", /INFO App/);
    });

    test("get() keeps the destination and the level and replaces the facility", () => {
        const sink = new MemorySink();

        const child = createLogger(sink, LogLevel.Error, "App").get("Outer").get("Inner");
        child.warn("dropped");
        child.error("written");

        assert.match(sink.only, / ERROR Inner written\n$/);
    });
});
