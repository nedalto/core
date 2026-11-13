import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import { ValidationError } from "@nedalto/contract/common/errors.ts";

import { resolveEnvironment } from "../src/environment.ts";

const TOKEN = "secret-token";
const ROOT = join(homedir(), ".nedalto");

function assertTokenRejected(env: NodeJS.ProcessEnv): void {
    assert.throws(
        () => resolveEnvironment(env),
        (error: unknown) => {
            assert.ok(error instanceof ValidationError, JSON.stringify(env));
            assert.equal(error.code, "VALIDATION_ERROR");
            assert.partialDeepStrictEqual(error.data, { issues: [{ path: "NEDALTO_AUTH_TOKEN" }] });
            return true;
        },
    );
}

describe("resolveEnvironment", () => {
    test("puts every path under the default root when only the token is set", () => {
        assert.deepEqual(resolveEnvironment({ NEDALTO_AUTH_TOKEN: TOKEN }), {
            configPath: ROOT,
            storagePath: join(ROOT, "storage"),
            logPath: join(ROOT, "log"),
            authToken: TOKEN,
        });
    });

    test("takes each path from its own variable", () => {
        const environment = resolveEnvironment({
            NEDALTO_AUTH_TOKEN: TOKEN,
            NEDALTO_CONFIG_PATH: "/etc/nedalto",
            NEDALTO_STORAGE_PATH: "/var/lib/nedalto",
            NEDALTO_LOG_PATH: "/var/log/nedalto",
        });

        assert.deepEqual(environment, {
            configPath: "/etc/nedalto",
            storagePath: "/var/lib/nedalto",
            logPath: "/var/log/nedalto",
            authToken: TOKEN,
        });
    });

    test("trims the values and treats an empty one as unset", () => {
        const environment = resolveEnvironment({
            NEDALTO_AUTH_TOKEN: `  ${TOKEN}  `,
            NEDALTO_CONFIG_PATH: "",
            NEDALTO_STORAGE_PATH: "   ",
            NEDALTO_LOG_PATH: " /var/log/nedalto ",
        });

        assert.deepEqual(environment, {
            configPath: ROOT,
            storagePath: join(ROOT, "storage"),
            logPath: "/var/log/nedalto",
            authToken: TOKEN,
        });
    });

    test("accepts a token of every allowed character", () => {
        const token = "Secret-Token_9!#$%&'*+.^`|~";

        assert.equal(resolveEnvironment({ NEDALTO_AUTH_TOKEN: token }).authToken, token);
    });

    test("accepts a token of the minimum length", () => {
        assert.equal(resolveEnvironment({ NEDALTO_AUTH_TOKEN: "12345678" }).authToken, "12345678");
    });

    test("throws a ValidationError naming the variable when the token is unset or blank", () => {
        for (const env of [{}, { NEDALTO_AUTH_TOKEN: "" }, { NEDALTO_AUTH_TOKEN: "   " }]) {
            assertTokenRejected(env);
        }
    });

    test("throws a ValidationError naming the variable when the token is shorter than the minimum", () => {
        assertTokenRejected({ NEDALTO_AUTH_TOKEN: "1234567" });
    });

    test("throws a ValidationError naming the variable when the token has a character outside the set", () => {
        for (const token of ["has spaces here", "bad/token=value", "tökentökentöken"]) {
            assertTokenRejected({ NEDALTO_AUTH_TOKEN: token });
        }
    });
});
