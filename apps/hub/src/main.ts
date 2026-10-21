import { join } from "node:path";
import { inspect } from "node:util";

import { loadConfig } from "@nedalto/config/config.ts";
import { type Environment, resolveEnvironment } from "@nedalto/config/environment.ts";
import type { Config } from "@nedalto/contract/config/schemas.ts";

import manifest from "../package.json" with { type: "json" };
import { createHub } from "./hub.ts";
import { run } from "./run.ts";

let environment: Environment;
let config: Config;
try {
    environment = resolveEnvironment();
    config = loadConfig(join(environment.configPath, "hub.json"));
} catch (error) {
    process.stderr.write(`nedalto: failed to start: ${inspect(error)}\n`);
    process.exit(1);
}

await run({ lifecycle: createHub(environment, config, manifest.version), process });
