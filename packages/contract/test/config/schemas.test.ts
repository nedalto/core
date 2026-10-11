import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ValidationError } from "../../src/common/errors.ts";
import { validateConfig } from "../../src/config/schemas.ts";
import { LogLevel } from "../../src/logger/types.ts";

const DEFAULTS = {
    server: { host: "0.0.0.0", port: 8080 },
    logger: { level: "info", maxFileSize: "10M", maxFiles: 5 },
    matter: {},
};

/** The issues of the `ValidationError` that validating `input` throws. */
function issuesOf(input: unknown): unknown {
    try {
        validateConfig(input);
    } catch (error) {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.code, "VALIDATION_ERROR");
        return error.data?.issues;
    }
    return assert.fail(`expected ${JSON.stringify(input)} to be rejected`);
}

/** The path of each issue, to check which field a value was rejected for. */
function rejectedPaths(input: unknown): unknown[] {
    const issues = issuesOf(input);
    assert.ok(Array.isArray(issues));
    return issues.map((issue) => {
        assert.ok(typeof issue === "object" && issue !== null && "path" in issue);
        return issue.path;
    });
}

describe("validateConfig", () => {
    test("returns the defaults for an empty object", () => {
        assert.deepEqual(validateConfig({}), DEFAULTS);
    });

    test("returns the defaults for sections that are empty objects", () => {
        assert.deepEqual(validateConfig({ server: {}, logger: {}, matter: {} }), DEFAULTS);
    });

    test("keeps the defaults of the fields that are absent", () => {
        const config = validateConfig({ server: { port: 9000 }, logger: { maxFiles: 2 } });

        assert.deepEqual(config, {
            server: { host: DEFAULTS.server.host, port: 9000 },
            logger: { ...DEFAULTS.logger, maxFiles: 2 },
            matter: DEFAULTS.matter,
        });
    });

    test("accepts the ends of the port range", () => {
        assert.equal(validateConfig({ server: { port: 1024 } }).server.port, 1024);
        assert.equal(validateConfig({ server: { port: 65535 } }).server.port, 65535);
    });

    test("rejects a port outside the range, fractional or not a number", () => {
        for (const port of [80, 1023, 65536, 8080.5, "8080", null]) {
            assert.deepEqual(rejectedPaths({ server: { port } }), ["server.port"], String(port));
        }
    });

    test("rejects an empty host", () => {
        assert.deepEqual(rejectedPaths({ server: { host: "" } }), ["server.host"]);
    });

    test("accepts every log level", () => {
        for (const level of Object.values(LogLevel)) {
            assert.equal(validateConfig({ logger: { level } }).logger.level, level);
        }
    });

    test("rejects a log level that does not exist", () => {
        assert.deepEqual(rejectedPaths({ logger: { level: "verbose" } }), ["logger.level"]);
    });

    test("accepts a file size of a positive integer and each unit", () => {
        for (const maxFileSize of ["100B", "10K", "10M", "1G"]) {
            assert.equal(validateConfig({ logger: { maxFileSize } }).logger.maxFileSize, maxFileSize);
        }
    });

    test("rejects a file size without a number, without a unit, with another unit or not positive", () => {
        for (const maxFileSize of ["M", "10", "10T", "10m", "0M", "1.5M", "-1M", 10]) {
            assert.deepEqual(rejectedPaths({ logger: { maxFileSize } }), ["logger.maxFileSize"], String(maxFileSize));
        }
    });

    test("rejects a number of files below one or fractional", () => {
        for (const maxFiles of [0, -1, 5.5]) {
            assert.deepEqual(rejectedPaths({ logger: { maxFiles } }), ["logger.maxFiles"], String(maxFiles));
        }
    });

    test("accepts a network interface name", () => {
        assert.equal(validateConfig({ matter: { networkInterface: "eth0" } }).matter.networkInterface, "eth0");
    });

    test("rejects an empty network interface name or null", () => {
        for (const networkInterface of ["", null]) {
            assert.deepEqual(
                rejectedPaths({ matter: { networkInterface } }),
                ["matter.networkInterface"],
                String(networkInterface),
            );
        }
    });

    test("rejects an unknown key, naming the keys the section admits", () => {
        assert.deepEqual(issuesOf({ logger: { maxsize: "10M" } }), [
            {
                path: "logger.maxsize",
                message: 'unknown key "maxsize", expected one of: level, maxFileSize, maxFiles',
            },
        ]);
    });

    test("rejects an unknown key at the root and in every section", () => {
        assert.deepEqual(rejectedPaths({ serverr: {} }), ["serverr"]);
        assert.deepEqual(rejectedPaths({ server: { prot: 9000 } }), ["server.prot"]);
        assert.deepEqual(rejectedPaths({ matter: { interface: "eth0" } }), ["matter.interface"]);
    });

    test("rejects input that is not a JSON object", () => {
        for (const input of ["text", 42, true, null, undefined, []]) {
            assert.deepEqual(rejectedPaths(input), [null], String(input));
        }
    });
});
