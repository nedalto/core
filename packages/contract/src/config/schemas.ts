import * as v from "valibot";

import { ValidationError } from "../common/errors.ts";
import { LogLevel } from "../logger/types.ts";

// valibot 1.5.0: an object schema accepts an array, so a section rejects one before it.
// Its own message for an unknown key is `Invalid key: Expected never but received "key"`; this
// one tells the operator which keys the section takes instead.
const strictSection = <TEntries extends v.ObjectEntries>(entries: TEntries) =>
    v.pipe(
        v.unknown(),
        v.check((input) => !Array.isArray(input), "must be an object, not an array"),
        v.strictObject(
            entries,
            (issue) => `unknown key ${issue.received}, expected one of: ${Object.keys(entries).join(", ")}`,
        ),
    );

const serverConfigSchema = strictSection({
    host: v.optional(v.pipe(v.string(), v.minLength(1, "host must not be empty")), "0.0.0.0"),
    port: v.optional(
        v.pipe(
            v.number(),
            v.integer("port must be an integer"),
            v.minValue(1024, "port must be >= 1024"),
            v.maxValue(65535, "port must be <= 65535"),
        ),
        8080,
    ),
});

// rotating-file-stream 4.0.0 takes `size` as a positive integer followed by B, K, M or G, and
// throws on zero or on any other unit.
const FILE_SIZE_PATTERN = /^[1-9]\d*[BKMG]$/;

const loggerConfigSchema = strictSection({
    level: v.optional(v.picklist(Object.values(LogLevel)), LogLevel.Info),
    maxFileSize: v.optional(
        v.pipe(
            v.string(),
            v.regex(FILE_SIZE_PATTERN, 'maxFileSize must be of the form <integer><B|K|M|G>, e.g. "10M"'),
        ),
        "10M",
    ),
    maxFiles: v.optional(
        v.pipe(v.number(), v.integer("maxFiles must be an integer"), v.minValue(1, "maxFiles must be >= 1")),
        5,
    ),
});

export type LoggerConfig = v.InferOutput<typeof loggerConfigSchema>;

const matterConfigSchema = strictSection({
    networkInterface: v.optional(v.pipe(v.string(), v.minLength(1, "networkInterface must not be empty"))),
});

const configSchema = strictSection({
    server: v.optional(serverConfigSchema, {}),
    logger: v.optional(loggerConfigSchema, {}),
    matter: v.optional(matterConfigSchema, {}),
});

export type Config = v.InferOutput<typeof configSchema>;

/**
 * Validates the parsed contents of the configuration file and returns it with the defaults applied,
 * or throws a `ValidationError` with an issue for every failure.
 */
export function validateConfig(input: unknown): Config {
    const result = v.safeParse(configSchema, input);
    if (result.success) {
        return result.output;
    }
    throw new ValidationError("Invalid config", {
        issues: result.issues.map((issue) => ({ path: v.getDotPath(issue), message: issue.message })),
    });
}
