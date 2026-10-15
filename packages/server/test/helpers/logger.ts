import type { Logger } from "@nedalto/contract/logger/ports.ts";

type Level = "debug" | "notice" | "warn" | "error";

/** A `Logger` that keeps what the package writes at each level. */
export class RecordingLogger implements Logger {
    readonly calls: { level: Level; values: unknown[] }[] = [];

    debug(...values: unknown[]): void {
        this.calls.push({ level: "debug", values });
    }

    notice(...values: unknown[]): void {
        this.calls.push({ level: "notice", values });
    }

    warn(...values: unknown[]): void {
        this.calls.push({ level: "warn", values });
    }

    error(...values: unknown[]): void {
        this.calls.push({ level: "error", values });
    }

    get(): Logger {
        return this;
    }

    info(): never {
        throw new Error("Unexpected call");
    }

    fatal(): never {
        throw new Error("Unexpected call");
    }

    /** What was written at `level`. */
    at(level: Level): unknown[][] {
        return this.calls.filter((call) => call.level === level).map((call) => call.values);
    }
}
