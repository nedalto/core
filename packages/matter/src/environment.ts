import "./sdk-config.ts";
import type { Writable } from "node:stream";

import { Environment, LogDestination, LogFormat, Logger } from "@matter/main";

import type { MatterConfig } from "@nedalto/contract/config/schemas.ts";
import type { LogLevel } from "@nedalto/contract/logger/types.ts";

/** What the SDK environment is configured with. */
export interface EnvironmentOptions extends MatterConfig {
    readonly logLevel: LogLevel;
}

/**
 * Points the SDK at `storagePath` and sends its log to `stream`, and returns `Environment.default`.
 * It changes process-wide state of the SDK, so only the production factory calls it.
 */
export function configureEnvironment(storagePath: string, stream: Writable, options: EnvironmentOptions): Environment {
    const environment = Environment.default;
    environment.vars.set("storage.path", storagePath);

    Logger.destinations.default = LogDestination({
        write: (text) => {
            stream.write(`${text}\n`);
        },
    });
    Logger.format = LogFormat.PLAIN;
    // @matter/general 0.17.9: `Logger.level` accepts debug, info, notice, warn, error and fatal, in
    // increasing severity, which are the values and the order of our `LogLevel`.
    Logger.level = options.logLevel;

    // @matter/protocol 0.17.9: without this variable mDNS uses every network interface.
    if (options.networkInterface !== undefined) {
        environment.vars.set("mdns.networkInterface", options.networkInterface);
    }
    return environment;
}
