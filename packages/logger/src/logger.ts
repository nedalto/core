import type { Writable } from "node:stream";
import { inspect } from "node:util";

import type { Logger } from "@nedalto/contract/logger/ports.ts";
import { LogLevel } from "@nedalto/contract/logger/types.ts";

const SEVERITY = {
    [LogLevel.Debug]: 0,
    [LogLevel.Info]: 1,
    [LogLevel.Notice]: 2,
    [LogLevel.Warn]: 3,
    [LogLevel.Error]: 4,
    [LogLevel.Fatal]: 5,
} as const satisfies Record<LogLevel, number>;

const pad = (value: number, width: number): string => String(value).padStart(width, "0");

const render = (value: unknown): string => (typeof value === "string" ? value : inspect(value));

function timestamp(date: Date): string {
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
    const time = `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}`;
    return `${day} ${time}.${pad(date.getMilliseconds(), 3)}`;
}

class PlainLogger implements Logger {
    readonly #stream: Writable;
    readonly #threshold: number;
    readonly #facility: string;

    constructor(stream: Writable, threshold: number, facility: string) {
        this.#stream = stream;
        this.#threshold = threshold;
        this.#facility = facility;
    }

    debug(...values: unknown[]): void {
        this.#write(LogLevel.Debug, values);
    }

    info(...values: unknown[]): void {
        this.#write(LogLevel.Info, values);
    }

    notice(...values: unknown[]): void {
        this.#write(LogLevel.Notice, values);
    }

    warn(...values: unknown[]): void {
        this.#write(LogLevel.Warn, values);
    }

    error(...values: unknown[]): void {
        this.#write(LogLevel.Error, values);
    }

    fatal(...values: unknown[]): void {
        this.#write(LogLevel.Fatal, values);
    }

    get(facility: string): Logger {
        return new PlainLogger(this.#stream, this.#threshold, facility);
    }

    #write(level: LogLevel, values: unknown[]): void {
        if (SEVERITY[level] < this.#threshold) {
            return;
        }
        const head = `${level.toUpperCase()} ${this.#facility}`;
        try {
            const message = values.map(render).join(" ");
            const tail = message === "" ? head : `${head} ${message}`;
            this.#stream.write(`${timestamp(new Date())} ${tail}\n`);
        } catch {
            // `inspect` runs the value's own `inspect.custom`, which can throw, and a log call
            // must not. The message is what could not be built, so only the head is reported.
            process.stderr.write(`nedalto: log line failed, dropping it: ${head}\n`);
        }
    }
}

/**
 * The application `Logger`, writing `YYYY-MM-DD HH:mm:ss.SSS LEVEL Facility values…` lines in
 * local time to `stream`, which the caller owns. Strings are written as they are and any other
 * value through `util.inspect`.
 */
export const createLogger = (stream: Writable, level: LogLevel, facility: string = "Hub"): Logger =>
    new PlainLogger(stream, SEVERITY[level], facility);
