import { basename, dirname } from "node:path";
import type { Writable } from "node:stream";

import { createStream, type RotatingFileStream } from "rotating-file-stream";

import { InternalError } from "@nedalto/contract/common/errors.ts";
import type { Lifecycle } from "@nedalto/contract/common/lifecycle.ts";
import type { LoggerConfig } from "@nedalto/contract/config/schemas.ts";

/** A log file exposed as a writable stream, for a `Logger` or another writer to share. */
export interface LogFile extends Lifecycle {
    /** Available between `start()` and `stop()`. */
    readonly stream: Writable;
}

export type RotationOptions = Pick<LoggerConfig, "maxFileSize" | "maxFiles">;

class RotatingLogFile implements LogFile {
    readonly #directory: string;
    readonly #fileName: string;
    readonly #options: RotationOptions;
    #stream: RotatingFileStream | undefined;

    constructor(filePath: string, options: RotationOptions) {
        this.#directory = dirname(filePath);
        this.#fileName = basename(filePath);
        this.#options = options;
    }

    get stream(): Writable {
        if (this.#stream === undefined) {
            throw new InternalError(`Log file "${this.#fileName}" accessed outside its start()/stop() window`);
        }
        return this.#stream;
    }

    async start(): Promise<void> {
        const stream = createStream(this.#fileName, {
            path: this.#directory,
            size: this.#options.maxFileSize,
            maxFiles: this.#options.maxFiles,
        });

        // rotating-file-stream 3.2.10: the file opens asynchronously, and a failed open destroys
        // the stream with an `error` and never emits `open`. Rejecting on it fails the start
        // instead of leaving the promise pending.
        await new Promise<void>((resolve, reject) => {
            stream.once("error", reject);
            stream.once("open", () => resolve());
        });

        // Later failures go to stderr: losing log lines beats stopping the hub.
        stream.on("error", (error: Error) => {
            process.stderr.write(`nedalto: log file "${this.#fileName}" error: ${error.message}\n`);
        });
        stream.on("warning", (warning: Error) => {
            process.stderr.write(`nedalto: log file "${this.#fileName}" warning: ${warning.message}\n`);
        });

        this.#stream = stream;
    }

    async stop(): Promise<void> {
        const stream = this.#stream;
        if (stream === undefined) {
            return;
        }
        this.#stream = undefined;

        // rotating-file-stream 3.2.10 on Node 26.10: `end()` on a stream already destroyed by a
        // failure calls back with ERR_STREAM_DESTROYED. That failure went to stderr above, so the
        // error is ignored and the stop still resolves.
        await new Promise<void>((resolve) => {
            stream.end(() => resolve());
        });
    }
}

/** A `LogFile` for the file at `filePath`, rotating according to `options`. */
export const createRotatingLogFile = (filePath: string, options: RotationOptions): LogFile =>
    new RotatingLogFile(filePath, options);
