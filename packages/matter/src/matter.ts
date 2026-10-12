import "./sdk-config.ts";
import type { Writable } from "node:stream";

import { type ControllerCollaborators, type MatterController, SdkMatterController } from "./controller.ts";
import { configureEnvironment, type MatterOptions } from "./environment.ts";

export type { MatterController } from "./controller.ts";
export type { MatterOptions } from "./environment.ts";

/** The logger, node repository and bus the controller works with, and the stream where the SDK writes its log. */
export interface MatterCollaborators extends ControllerCollaborators {
    readonly stream: Writable;
}

/**
 * A `MatterController` on the SDK's default environment, which keeps its state under `storagePath`.
 * There is one per process, because the default environment is global.
 */
export const createSdkMatterController = (
    storagePath: string,
    { stream, ...collaborators }: MatterCollaborators,
    options: MatterOptions,
): MatterController => new SdkMatterController(configureEnvironment(storagePath, stream, options), collaborators);
