import "./sdk-config.ts";
import type { Writable } from "node:stream";

import { type MatterControllerDeps, type Controller, MatterController } from "./controller.ts";
import { configureEnvironment, type EnvironmentOptions } from "./environment.ts";

export type { Controller } from "./controller.ts";

/** The configuration of the SDK, and the version of the hub that the controller announces on the fabric. */
export interface MatterOptions extends EnvironmentOptions {
    readonly version: string;
}

/** The logger, node repository and bus the controller works with, and the stream where the SDK writes its log. */
export interface MatterDeps extends MatterControllerDeps {
    readonly stream: Writable;
}

/**
 * A `Controller` on the SDK's default environment, which keeps its state under `storagePath`.
 * There is one per process, because the default environment is global.
 */
export function createMatterController(
    storagePath: string,
    { stream, logger: rootLogger, ...deps }: MatterDeps,
    { version, ...options }: MatterOptions,
): Controller {
    const logger = rootLogger.get("Matter");
    const environment = configureEnvironment(storagePath, stream, options);
    return new MatterController(environment, { logger, ...deps }, version);
}
