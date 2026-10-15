import * as v from "valibot";

import { parseOrThrow } from "../internal/valibot.ts";
import { LogLevel } from "../logger/types.ts";

// valibot 1.5.0: its own message for an unknown key is `Expected never but received "key"`.
// This one tells the operator which keys the section takes instead.
const strictSection = <TEntries extends v.ObjectEntries>(entries: TEntries) =>
    v.strictObject(
        entries,
        (issue) => `unknown key ${issue.received}, expected one of: ${Object.keys(entries).join(", ")}`,
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

export type ServerConfig = v.InferOutput<typeof serverConfigSchema>;

// rotating-file-stream 3.2.10 takes `size` as a positive integer followed by B, K, M or G, and
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

export type MatterConfig = v.InferOutput<typeof matterConfigSchema>;

// valibot 1.5.0: an object schema accepts an array, so `[]` needs its own check.
const configSchema = v.pipe(
    v.unknown(),
    v.check((input) => !Array.isArray(input), "config must be a JSON object, not an array"),
    strictSection({
        server: v.optional(serverConfigSchema, {}),
        logger: v.optional(loggerConfigSchema, {}),
        matter: v.optional(matterConfigSchema, {}),
    }),
);

export type Config = v.InferOutput<typeof configSchema>;

/** Validates the parsed contents of the configuration file and returns it with the defaults applied. */
export const validateConfig = (input: unknown): Config => parseOrThrow(configSchema, input);
