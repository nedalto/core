import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, type TestContext, test } from "node:test";

import type { Environment } from "@nedalto/config/environment.ts";
import { validateConfig } from "@nedalto/contract/config/schemas.ts";

import { createHub } from "../src/hub.ts";

const VERSION = "0.0.1";

function temporaryEnvironment(context: TestContext): Environment {
    const directory = mkdtempSync(join(tmpdir(), "nedalto-hub-"));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    return {
        configPath: directory,
        storagePath: join(directory, "storage"),
        logPath: join(directory, "log"),
        authToken: "test-token",
    };
}

// Linux lists the descriptors of the process in /dev/fd.
const openDescriptors = (): number => readdirSync("/dev/fd").length;

describe("createHub", () => {
    test("stop() before start() does nothing", async (context) => {
        const hub = createHub(temporaryEnvironment(context), validateConfig({}), VERSION);

        await assert.doesNotReject(hub.stop());
    });

    test("start() rejects when a directory cannot be created", async (context) => {
        const environment = temporaryEnvironment(context);
        writeFileSync(join(environment.configPath, "blocker"), "");
        const hub = createHub(
            { ...environment, storagePath: join(environment.configPath, "blocker", "storage") },
            validateConfig({}),
            VERSION,
        );

        await assert.rejects(hub.start(), { code: "ENOTDIR" });
    });

    test("start() logs the error, then that it stopped, and closes the log files when the database cannot be opened", async (context) => {
        const environment = temporaryEnvironment(context);
        mkdirSync(join(environment.storagePath, "hub.db"), { recursive: true });
        const hub = createHub(environment, validateConfig({}), VERSION);
        const descriptors = openDescriptors();

        await assert.rejects(hub.start(), { code: "ERR_SQLITE_ERROR" });

        const log = readFileSync(join(environment.logPath, "hub.log"), "utf8");
        assert.match(log, / ERROR Hub failed to start /);
        // The last line, written before hub.log closed.
        assert.match(log, / NOTICE Hub stopped\n$/);
        assert.equal(openDescriptors(), descriptors);
    });
});
