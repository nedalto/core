import { homedir } from "node:os";
import { join } from "node:path";

import { ValidationError } from "@nedalto/contract/common/errors.ts";

export interface Environment {
    readonly configPath: string;
    readonly storagePath: string;
    readonly logPath: string;
    readonly authToken: string;
}

const TOKEN_VARIABLE = "NEDALTO_AUTH_TOKEN";
const TOKEN_MIN_LENGTH = 8;

// RFC 7230 token characters. Node 26.10: `new WebSocket(url, [token])` throws a `SyntaxError` for
// anything else, a space or `/` for instance.
const TOKEN_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

const read = (env: NodeJS.ProcessEnv, name: string): string | undefined => env[name]?.trim() || undefined;

const invalidToken = (message: string): ValidationError =>
    new ValidationError(message, { issues: [{ path: TOKEN_VARIABLE, message }] });

function requireAuthToken(env: NodeJS.ProcessEnv): string {
    const token = read(env, TOKEN_VARIABLE);

    if (token === undefined) {
        throw invalidToken("Auth token must not be empty");
    }
    if (token.length < TOKEN_MIN_LENGTH) {
        throw invalidToken(`Auth token must be at least ${TOKEN_MIN_LENGTH} characters`);
    }
    if (!TOKEN_PATTERN.test(token)) {
        throw invalidToken("Auth token may only contain letters, digits, and -_.~!#$%&'*+^|`");
    }

    return token;
}

/**
 * Resolves the environment variables into the paths and the auth token the hub runs with.
 * It creates no directory and reads no file. Throws `ValidationError` if the token is missing or invalid.
 */
export function resolveEnvironment(env: NodeJS.ProcessEnv = process.env): Environment {
    const defaultRoot = join(homedir(), ".nedalto");

    return {
        configPath: read(env, "NEDALTO_CONFIG_PATH") ?? defaultRoot,
        storagePath: read(env, "NEDALTO_STORAGE_PATH") ?? join(defaultRoot, "storage"),
        logPath: read(env, "NEDALTO_LOG_PATH") ?? join(defaultRoot, "log"),
        authToken: requireAuthToken(env),
    };
}
