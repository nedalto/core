import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, type TestContext, test } from "node:test";

import { InternalError } from "@nedalto/contract/common/errors.ts";

import { createRotatingLogFile } from "../src/log-file.ts";
import { captureStderr } from "./helpers/stderr.ts";

const ROTATION = { maxFileSize: "10M", maxFiles: 3 };

function temporaryDirectory(context: TestContext): string {
    const directory = mkdtempSync(join(tmpdir(), "nedalto-logger-"));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    return directory;
}

/** A path whose parent is a regular file, so opening it fails with ENOTDIR. */
function unopenablePath(context: TestContext): string {
    const blocker = join(temporaryDirectory(context), "blocker");
    writeFileSync(blocker, "");
    return join(blocker, "hub.log");
}

const isInternalError = (error: unknown): boolean => error instanceof InternalError && error.code === "INTERNAL_ERROR";

describe("createRotatingLogFile", () => {
    test("writes everything to the file by the time stop() resolves", async (context) => {
        const directory = temporaryDirectory(context);
        const file = createRotatingLogFile(join(directory, "hub.log"), ROTATION);

        await file.start();
        file.stream.write("first line\n");
        file.stream.write("second line\n");
        await file.stop();

        assert.equal(readFileSync(join(directory, "hub.log"), "utf8"), "first line\nsecond line\n");
    });

    test("rotates the file when it reaches maxFileSize", async (context) => {
        const directory = temporaryDirectory(context);
        const file = createRotatingLogFile(join(directory, "hub.log"), { maxFileSize: "1K", maxFiles: 3 });
        const chunk = `${"x".repeat(599)}\n`;

        await file.start();
        file.stream.write(chunk);
        file.stream.write(chunk);
        file.stream.write("last line\n");
        await file.stop();

        assert.equal(readFileSync(join(directory, "hub.log"), "utf8"), "last line\n");
    });

    test("keeps at most maxFiles rotated files", async (context) => {
        const directory = temporaryDirectory(context);
        const file = createRotatingLogFile(join(directory, "hub.log"), { maxFileSize: "1K", maxFiles: 1 });
        const chunk = `${"x".repeat(1023)}\n`;

        await file.start();
        for (let rotation = 0; rotation < 4; rotation++) {
            file.stream.write(chunk);
        }
        await file.stop();

        // The current file and the history file the library keeps for the limit are not rotated files.
        const rotated = readdirSync(directory).filter((name) => name !== "hub.log" && !name.endsWith(".txt"));
        assert.equal(rotated.length, 1);
    });

    test("rejects start() with the open error when the path cannot be opened", { timeout: 5_000 }, async (context) => {
        const file = createRotatingLogFile(unopenablePath(context), ROTATION);

        await assert.rejects(() => file.start(), { code: "ENOTDIR" });
    });

    test("throws InternalError from stream before start()", (context) => {
        const file = createRotatingLogFile(join(temporaryDirectory(context), "hub.log"), ROTATION);

        assert.throws(() => file.stream, isInternalError);
    });

    test("throws InternalError from stream after a failed start()", { timeout: 5_000 }, async (context) => {
        const file = createRotatingLogFile(unopenablePath(context), ROTATION);
        await assert.rejects(() => file.start());

        assert.throws(() => file.stream, isInternalError);
    });

    test("throws InternalError from stream after stop()", async (context) => {
        const file = createRotatingLogFile(join(temporaryDirectory(context), "hub.log"), ROTATION);
        await file.start();
        await file.stop();

        assert.throws(() => file.stream, isInternalError);
    });

    test("resolves stop() without creating the file when start() was never called", async (context) => {
        const directory = temporaryDirectory(context);
        const file = createRotatingLogFile(join(directory, "hub.log"), ROTATION);

        await file.stop();

        assert.deepEqual(readdirSync(directory), []);
    });

    test("resolves stop() after a failed start()", { timeout: 5_000 }, async (context) => {
        const file = createRotatingLogFile(unopenablePath(context), ROTATION);
        await assert.rejects(() => file.start());

        await file.stop();
    });

    test("resolves stop() when a failure already destroyed the stream", { timeout: 5_000 }, async (context) => {
        const file = createRotatingLogFile(join(temporaryDirectory(context), "hub.log"), ROTATION);
        await file.start();

        await captureStderr(async () => {
            const stream = file.stream;
            const closed = new Promise((resolve) => stream.once("close", resolve));
            stream.destroy(new Error("disk full"));
            await closed;
        });

        await file.stop();
    });

    test("reports a stream error after start() to stderr", async (context) => {
        const file = createRotatingLogFile(join(temporaryDirectory(context), "hub.log"), ROTATION);
        await file.start();

        const written = await captureStderr(async () => {
            const stream = file.stream;
            const closed = new Promise((resolve) => stream.once("close", resolve));
            stream.destroy(new Error("disk full"));
            await closed;
        });

        assert.equal(written.length, 1);
        assert.match(written[0] ?? "", /hub\.log.*disk full/);
        await file.stop();
    });

    test("reports a stream warning after start() to stderr", async (context) => {
        const file = createRotatingLogFile(join(temporaryDirectory(context), "hub.log"), ROTATION);
        await file.start();

        const written = await captureStderr(() => {
            file.stream.emit("warning", new Error("slow disk"));
        });

        assert.equal(written.length, 1);
        assert.match(written[0] ?? "", /hub\.log.*slow disk/);
        await file.stop();
    });
});
