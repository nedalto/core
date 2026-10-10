/**
 * Writes log lines. A component calls `get()` once with its own facility, so renaming or
 * extracting it does not reach into the composition root.
 */
export interface Logger {
    debug(...values: unknown[]): void;
    info(...values: unknown[]): void;
    notice(...values: unknown[]): void;
    warn(...values: unknown[]): void;
    error(...values: unknown[]): void;
    fatal(...values: unknown[]): void;

    /**
     * A logger with the same destination and level that prints `facility` on each line.
     * Facilities do not nest: `get("X").get("Y")` writes under `"Y"`.
     */
    get(facility: string): Logger;
}
