import type { Logger } from "@nedalto/contract/logger/ports.ts";

/** A `Logger` that records the `warn` calls it receives. The package writes nothing else that a test reads. */
export class RecordingLogger implements Logger {
    readonly warnings: unknown[][] = [];

    warn(...values: unknown[]): void {
        this.warnings.push(values);
    }

    get(): Logger {
        return this;
    }

    info(): void {}

    notice(): void {}

    debug(): never {
        throw new Error("Unexpected call");
    }

    error(): never {
        throw new Error("Unexpected call");
    }

    fatal(): never {
        throw new Error("Unexpected call");
    }
}
