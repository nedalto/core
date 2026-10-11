import type { Logger } from "@nedalto/contract/logger/ports.ts";

/** A `Logger` that records the notices it receives. The package writes nothing else. */
export class RecordingLogger implements Logger {
    readonly notices: unknown[][] = [];

    notice(...values: unknown[]): void {
        this.notices.push(values);
    }

    get(): Logger {
        return this;
    }

    debug(): never {
        throw new Error("Unexpected call");
    }

    info(): never {
        throw new Error("Unexpected call");
    }

    warn(): never {
        throw new Error("Unexpected call");
    }

    error(): never {
        throw new Error("Unexpected call");
    }

    fatal(): never {
        throw new Error("Unexpected call");
    }
}
