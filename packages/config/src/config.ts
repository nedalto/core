import { readFileSync } from "node:fs";

import { ValidationError } from "@nedalto/contract/common/errors.ts";
import { type Config, validateConfig } from "@nedalto/contract/config/schemas.ts";

/**
 * Reads the configuration file at `filePath` and returns its contents validated, with the defaults
 * applied; a missing file gives the defaults alone. Other read errors propagate as they are.
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
        throw error;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(contents);
    } catch (error) {
        throw new ValidationError(`Config file ${filePath} is not valid JSON`, { cause: error, data: { filePath } });
    }

    return validateConfig(parsed);
}
