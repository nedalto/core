import { inspect } from "node:util";

import type { Lifecycle } from "@nedalto/contract/common/lifecycle.ts";

/** The part of the process that `run` uses. */
export interface HostProcess {
    on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
    exit(code: number): void;
    readonly stderr: { write(text: string): unknown };
}

export interface RunDeps {
    readonly lifecycle: Lifecycle;
    readonly process: HostProcess;
}

/**
 * Runs `lifecycle` until SIGINT or SIGTERM and then exits: with 0 after stopping it, with 1 if it fails to start.
 * The signals are handled from before `start()`, so one that arrives while it runs stops the lifecycle once it is up.
 */
export async function run({ lifecycle, process }: RunDeps): Promise<void> {
    const { promise: stopRequested, resolve: requestStop } = Promise.withResolvers<void>();
    // Resolving again does nothing, which is how a second signal is ignored.
    process.on("SIGINT", requestStop);
    process.on("SIGTERM", requestStop);

    try {
        await lifecycle.start();
    } catch (error) {
        process.stderr.write(`nedalto: failed to start: ${inspect(error)}\n`);
        process.exit(1);
        return;
    }

    await stopRequested;
    await lifecycle.stop();
    // Explicit, as on a failed start, so that a handle a component leaves open cannot keep the process from ending.
    process.exit(0);
}
