import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, type TestContext, test } from "node:test";

import { ValidationError } from "@nedalto/contract/common/errors.ts";
import { validateConfig } from "@nedalto/contract/config/schemas.ts";

import { loadConfig } from "../src/config.ts";

function temporaryDirectory(context: TestContext): string {
    const directory = mkdtempSync(join(tmpdir(), "nedalto-config-"));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    return directory;
}

function writeConfigFile(context: TestContext, contents: string): string {
    const filePath = join(temporaryDirectory(context), "config.json");
    writeFileSync(filePath, contents);
    return filePath;
}

describe("loadConfig", () => {
    test("returns the contents of the file with the defaults applied", (context) => {
        const contents = { server: { port: 9000 } };
        const filePath = writeConfigFile(context, JSON.stringify(contents));

        assert.deepEqual(loadConfig(filePath), validateConfig(contents));
    });

    test("returns the defaults when the file is missing", (context) => {
        const filePath = join(temporaryDirectory(context), "config.json");

        assert.deepEqual(loadConfig(filePath), validateConfig({}));
    });

    test("throws an error naming the file, caused by the read error, when reading fails other than for a missing file", (context) => {
        // A directory where a file is expected fails with EISDIR on Linux, whatever the permissions;
        // Node 26.13 puts no path in that error.
        const directory = temporaryDirectory(context);

        assert.throws(
            () => loadConfig(directory),
            (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.ok(!(error instanceof ValidationError));
                assert.ok(error.message.includes(directory));
                assert.ok(error.cause instanceof Error);
                assert.equal("code" in error.cause && error.cause.code, "EISDIR");
                return true;
            },
        );
    });

    test("throws a ValidationError naming the file when the JSON is malformed", (context) => {
        const filePath = writeConfigFile(context, "{ not json");

        assert.throws(
            () => loadConfig(filePath),
            (error: unknown) => {
                assert.ok(error instanceof ValidationError);
                assert.equal(error.code, "VALIDATION_ERROR");
                assert.partialDeepStrictEqual(error.data, { issues: [{ path: null }] });
                assert.ok(error.message.includes(filePath));
                assert.ok(error.cause instanceof SyntaxError);
                return true;
            },
        );
    });

    test("throws a ValidationError naming the file, with the issues of the schema, when the contents are invalid", (context) => {
        const filePath = writeConfigFile(context, JSON.stringify({ server: { port: 80 } }));

        assert.throws(
            () => loadConfig(filePath),
            (error: unknown) => {
                assert.ok(error instanceof ValidationError);
                assert.equal(error.code, "VALIDATION_ERROR");
                assert.partialDeepStrictEqual(error.data, { issues: [{ path: "server.port" }] });
                assert.ok(error.message.includes(filePath));
                assert.equal(error.cause, undefined);
                return true;
            },
        );
    });
});
