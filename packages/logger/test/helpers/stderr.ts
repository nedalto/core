import { mock } from "node:test";

/** Runs `run` with `process.stderr.write` replaced and returns what was written to it. */
export async function captureStderr(run: () => void | Promise<void>): Promise<string[]> {
    const stderr = mock.method(process.stderr, "write", () => true);
    try {
        await run();
        return stderr.mock.calls.map((call) => String(call.arguments[0]));
    } finally {
        stderr.mock.restore();
    }
}
