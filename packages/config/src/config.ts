import { readFileSync } from "node:fs";

import { ValidationError } from "@nedalto/contract/common/errors.ts";
import { type Config, validateConfig } from "@nedalto/contract/config/schemas.ts";

/**
 * Reads the configuration file at `filePath` and returns its contents validated, with the defaults
 * applied; a missing file gives the defaults alone. Any other read error is the `cause` of an error
 * that names the file.
 * Synchronous: it runs once, while the hub starts.
 */
export function loadConfig(filePath: string): Config {
    let contents: string;
    try {
        contents = readFileSync(filePath, "utf8");
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return validateConfig({});
        }
        throw new Error(`Cannot read config file ${filePath}`, { cause: error });
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(contents);
    } catch (error) {
        throw new ValidationError(`Config file ${filePath} is invalid`, {
            cause: error,
            issues: [{ path: null, message: "not valid JSON" }],
        });
    }

    try {
        return validateConfig(parsed);
    } catch (error) {
        if (!(error instanceof ValidationError)) {
            throw error;
        }
        throw new ValidationError(`Config file ${filePath} is invalid`, { issues: error.data.issues });
    }
}
