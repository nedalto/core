import type { Logger } from "@nedalto/contract/logger/ports.ts";

/** A `Logger` that drops what the package writes, `info` and `notice`, and throws on anything else. */
export class QuietLogger implements Logger {
    get(): Logger {
        return this;
    }

    info(): void {}

    notice(): void {}

    debug(): never {
        throw new Error("Unexpected call");
    }

    warn(): never {
        throw new Error("Unexpected call");
    }

    error(): never {
        throw new Error("Unexpected call");
    }
}
