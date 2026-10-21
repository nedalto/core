import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

const stacks = new WeakMap<TestContext, AsyncDisposableStack>();

/**
 * Runs `cleanup` when the test ends, last in first out, so what uses a resource is released before
 * the resource. Node 26.10: `context.after` runs its hooks in the order they were registered.
 */
export function defer(context: TestContext, cleanup: () => void | PromiseLike<void>): void {
    let stack = stacks.get(context);
    if (stack === undefined) {
        const created = new AsyncDisposableStack();
        stacks.set(context, created);
        context.after(() => created.disposeAsync());
        stack = created;
    }
    stack.defer(cleanup);
}

/** A new directory under the system's temporary one, removed when the test ends. */
export async function scratchDirectory(context: TestContext, prefix: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    defer(context, () => rm(directory, { recursive: true, force: true }));
    return directory;
}
