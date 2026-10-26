import { spawn } from "node:child_process";
import { existsSync, type FSWatcher, mkdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { defer, scratchDirectory } from "./cleanup.ts";

export interface RunningHub {
    readonly url: string;
    readonly logPath: string;
    readonly storagePath: string;

    /** What this start of the hub has written to `hub.log`. */
    readonly log: () => string;

    /** Resolves with what this start has written to `hub.log` once it matches `pattern`. */
    readonly awaitLog: (pattern: RegExp) => Promise<string>;

    /** Signals the hub and fails unless it exits with 0 in time; the end of the test does it if the test has not. */
    readonly stop: () => Promise<void>;
}

export interface Exit {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly stdout: string;
    readonly stderr: string;
}

interface HubOptions {
    /** The directory with the configuration, storage and logs; a new one unless a restart passes the previous. */
    readonly root?: string;
}

export const AUTH_TOKEN = "e2e-test-token";

// The config schema keeps ports at 1024 or above, so the hub cannot be asked for a free one.
// One hub at a time, which is why the e2e script runs one file at a time: every hub listens on this port, and every
// simulated light has the same passcode and discriminator, so a hub could commission the light of another file.
const PORT = 18432;

// The exit of a hub that was asked to stop takes milliseconds; these bound a hang, they are not waited out.
const READY_LIMIT_MS = 15_000;
const STOP_LIMIT_MS = 10_000;
const LOG_TAIL_LINES = 20;

const BUNDLE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "main.js");

/** `E2E_HUB_BIN` is the installed command; without it, the bundle under the Node that runs the tests. */
function hubCommand(): [string, ...string[]] {
    const installed = process.env.E2E_HUB_BIN;
    const executable = installed ? resolvePath(installed) : BUNDLE;
    if (!existsSync(executable)) {
        const hint = installed ? "E2E_HUB_BIN points at it" : 'run "npm run --workspace=@nedalto/hub build" first';
        throw new Error(`${executable} does not exist: ${hint}`);
    }
    return installed ? [executable] : [process.execPath, executable];
}

const describeExit = ({ code, signal }: Exit): string => (signal === null ? `code ${code}` : `signal ${signal}`);

const output = ({ stdout, stderr }: Exit): string => `stdout:\n${stdout}\nstderr:\n${stderr}`;

/** The hub as a process, started the way a service manager does: an environment and a configuration file. */
function launch(root: string, authToken: string | undefined) {
    const environment = Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.startsWith("NEDALTO_")),
    );
    environment.NEDALTO_CONFIG_PATH = root;
    environment.NEDALTO_STORAGE_PATH = join(root, "storage");
    environment.NEDALTO_LOG_PATH = join(root, "log");
    if (authToken !== undefined) {
        environment.NEDALTO_AUTH_TOKEN = authToken;
    }

    const [command, ...args] = hubCommand();
    const child = spawn(command, args, { env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));

    // On `close`, not `exit`, so that the output is complete.
    const exited = new Promise<Exit>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
    return { child, exited };
}

/** Resolves with `"limit"` if `promise` has not settled in `limitMs`, which bounds a hang and is not a wait. */
async function within<T>(promise: Promise<T>, limitMs: number): Promise<T | "limit"> {
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<"limit">((resolve) => {
        timer = globalThis.setTimeout(() => resolve("limit"), limitMs);
    });
    try {
        return await Promise.race([promise, limit]);
    } finally {
        globalThis.clearTimeout(timer);
    }
}

/**
 * Starts a hub on a fixed port and waits for it to announce it is ready.
 * It is signalled when the test ends, and the test fails unless it exits with 0 by itself in time.
 */
export async function startHub(context: TestContext, options: HubOptions = {}): Promise<RunningHub> {
    const root = options.root ?? (await scratchDirectory(context, "nedalto-e2e-hub-"));
    const logPath = join(root, "log");
    const logFile = join(logPath, "hub.log");
    // Created here so that there is a directory to watch before the hub exists.
    mkdirSync(logPath, { recursive: true });
    writeFileSync(join(root, "hub.json"), JSON.stringify({ server: { port: PORT } }));

    // A restart reuses the file, and only what this start writes says whether it is ready.
    const before = existsSync(logFile) ? statSync(logFile).size : 0;
    const { child, exited } = launch(root, AUTH_TOKEN);

    const log = (): string => (existsSync(logFile) ? readFileSync(logFile, "utf8").slice(before) : "");
    // Set when a wait already failed because of the exit, so that the end of the test does not report it again.
    let exitReported = false;

    const awaitLog = (pattern: RegExp): Promise<string> =>
        new Promise((resolve, reject) => {
            let settled = false;
            let fileWatcher: FSWatcher | undefined;
            const finish = (settle: () => void): void => {
                settled = true;
                directoryWatcher.close();
                fileWatcher?.close();
                globalThis.clearTimeout(limit);
                settle();
            };
            // Linux reports an append to both watchers, so a check can come after the wait has settled.
            const check = (): void => {
                if (settled) {
                    return;
                }
                const written = log();
                if (pattern.test(written)) {
                    finish(() => resolve(written));
                }
            };
            // On macOS a watcher on the directory reports hub.log being created but not the lines appended to it,
            // so the file gets a watcher of its own once it exists.
            const watchFile = (): void => {
                if (fileWatcher === undefined && existsSync(logFile)) {
                    fileWatcher = watch(logFile, check);
                }
            };
            const directoryWatcher = watch(logPath, () => {
                watchFile();
                check();
            });
            watchFile();
            const limit = globalThis.setTimeout(() => {
                const message = `${pattern} did not reach hub.log in ${READY_LIMIT_MS}ms, it holds:\n${log()}`;
                finish(() => reject(new Error(message)));
            }, READY_LIMIT_MS);
            const watchExit = async (): Promise<void> => {
                try {
                    const exit = await exited;
                    if (!settled) {
                        exitReported = true;
                        const message = `the hub exited with ${describeExit(exit)} before ${pattern}:\n${output(exit)}`;
                        finish(() => reject(new Error(message)));
                    }
                } catch (error) {
                    finish(() => reject(error));
                }
            };
            void watchExit();
            // After the watcher exists, so that a line written between the two is not lost.
            check();
        });

    const terminate = async (): Promise<void> => {
        const unasked = child.exitCode !== null || child.signalCode !== null;
        if (!unasked) {
            child.kill("SIGTERM");
        }
        const exit = await within(exited, STOP_LIMIT_MS);
        if (exit === "limit") {
            child.kill("SIGKILL");
            const killed = await exited;
            const tail = log().split("\n").slice(-LOG_TAIL_LINES).join("\n");
            throw new Error(
                `the hub did not exit in ${STOP_LIMIT_MS}ms after SIGTERM, the end of hub.log:\n${tail}\n${output(killed)}`,
            );
        }
        if (unasked) {
            if (!exitReported) {
                throw new Error(`the hub exited with ${describeExit(exit)} on its own:\n${output(exit)}`);
            }
        } else if (exit.code !== 0) {
            throw new Error(`the hub exited with ${describeExit(exit)} instead of 0:\n${output(exit)}`);
        }
    };
    let stopping: Promise<void> | undefined;
    const stop = (): Promise<void> => (stopping ??= terminate());
    defer(context, stop);

    await awaitLog(/NOTICE Hub ready/);

    return { url: `ws://127.0.0.1:${PORT}`, logPath, storagePath: join(root, "storage"), log, awaitLog, stop };
}

/** Runs a hub that is expected to refuse to start, and resolves with how it exited. */
export async function runHubWithoutToken(context: TestContext): Promise<Exit> {
    const root = await scratchDirectory(context, "nedalto-e2e-hub-");
    const { child, exited } = launch(root, undefined);
    const exit = await within(exited, STOP_LIMIT_MS);
    if (exit === "limit") {
        child.kill("SIGKILL");
        throw new Error(`the hub kept running for ${STOP_LIMIT_MS}ms without a token:\n${output(await exited)}`);
    }
    return exit;
}
