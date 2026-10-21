import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { scratchDirectory } from "./helpers/cleanup.ts";
import { runHubWithoutToken, startHub } from "./helpers/hub.ts";

describe("hub boot", () => {
    test("announces it is ready once every component is up", async (t) => {
        const hub = await startHub(t);

        assert.match(hub.log(), /NOTICE Hub ready/);
    });

    test("creates its log files, database and Matter storage under the paths of the environment", async (t) => {
        const { logPath, storagePath } = await startHub(t);

        assert.equal(existsSync(join(logPath, "hub.log")), true);
        assert.equal(existsSync(join(logPath, "matter", "hub.log")), true);
        assert.equal(existsSync(join(storagePath, "hub.db")), true);
        assert.equal(existsSync(join(storagePath, "matter")), true);
    });

    test("starts again on the same directory after a clean stop", async (t) => {
        const root = await scratchDirectory(t, "nedalto-e2e-hub-");
        const first = await startHub(t, { root });
        await first.stop();

        await startHub(t, { root });

        // Both starts appended to the one file, so the second did not replace it.
        assert.equal(readFileSync(join(first.logPath, "hub.log"), "utf8").match(/NOTICE Hub ready/g)?.length, 2);
    });

    test("exits with 1 and says why on stderr when NEDALTO_AUTH_TOKEN is not set", async (t) => {
        const exit = await runHubWithoutToken(t);

        assert.equal(exit.code, 1);
        assert.match(exit.stderr, /Auth token must not be empty/);
    });
});
