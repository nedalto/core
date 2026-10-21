import type { TestContext } from "node:test";

import { SCHEMA_VERSION } from "@nedalto/contract/common/version.ts";
import { decode, encode } from "@nedalto/contract/common/wire.ts";
import { validateServerMessage } from "@nedalto/contract/server/schemas.ts";

import { defer } from "./cleanup.ts";
import { AUTH_TOKEN } from "./hub.ts";

export interface Notification {
    readonly method: string;
    readonly params: unknown;
}

/** Long enough for a commissioning on a loaded runner; short enough to fail naming the request, since `node --test` has no timeout. */
const WAIT_LIMIT_MS = 30_000;

/** An open connection to a hub, closed when the test ends. */
export interface Client {
    /** Resolves with the result of the request, or throws with the error the hub answered. */
    readonly call: (method: string, params?: unknown) => Promise<unknown>;

    /** Resolves with the first notification of that method whose params satisfy `matches`, received since the client opened. */
    readonly notification: (method: string, matches?: (params: unknown) => boolean) => Promise<Notification>;
}

/** Whether `value` is a plain object, for narrowing what `call` returns. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** Connects the way a client does: the schema version in the query and the token as the only subprotocol. */
export async function connect(context: TestContext, url: string): Promise<Client> {
    const ws = new WebSocket(`${url}/?v=${SCHEMA_VERSION}`, [AUTH_TOKEN]);
    defer(context, () => ws.close());

    const responses = new Map<number, PromiseWithResolvers<unknown>>();
    const received: Notification[] = [];
    const waiting: {
        matches: (notification: Notification) => boolean;
        resolve: (notification: Notification) => void;
    }[] = [];
    let nextId = 0;

    ws.addEventListener("message", (event) => {
        const message = validateServerMessage(decode(String(event.data)));
        if ("method" in message) {
            const notification = { method: message.method, params: message.params };
            received.push(notification);
            for (const waiter of waiting.filter(({ matches }) => matches(notification))) {
                waiter.resolve(notification);
            }
        } else if (typeof message.id === "number") {
            const response = responses.get(message.id);
            if ("error" in message) {
                response?.reject(new Error(`the hub answered with an error: ${encode(message.error)}`));
            } else {
                response?.resolve(message.result);
            }
        }
    });

    const { promise: opened, resolve, reject } = Promise.withResolvers<void>();
    ws.addEventListener("open", () => resolve(), { once: true });
    // The client reports a refused upgrade as an error event with no status.
    ws.addEventListener("error", () => reject(new Error("the hub refused the upgrade")), { once: true });
    await opened;

    return {
        call: (method, params) => {
            const id = ++nextId;
            const response = Promise.withResolvers<unknown>();
            responses.set(id, response);
            ws.send(encode({ jsonrpc: "2.0", method, params, id }));
            return limited(response.promise, `${method} went unanswered`);
        },
        notification: (method, matches = () => true) => {
            const wanted = (notification: Notification): boolean =>
                notification.method === method && matches(notification.params);
            const arrived = received.find(wanted);
            if (arrived !== undefined) {
                return Promise.resolve(arrived);
            }
            const next = Promise.withResolvers<Notification>();
            waiting.push({ matches: wanted, resolve: next.resolve });
            return limited(
                next.promise,
                `${method} never arrived, received: ${received.map((n) => n.method).join(", ")}`,
            );
        },
    };
}

/** Rejects with `message` if `promise` has not settled within the limit, which is a bound and not a wait. */
async function limited<T>(promise: Promise<T>, message: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<never>((_resolve, reject) => {
        timer = globalThis.setTimeout(() => reject(new Error(`${message} for ${WAIT_LIMIT_MS}ms`)), WAIT_LIMIT_MS);
    });
    try {
        return await Promise.race([promise, limit]);
    } finally {
        globalThis.clearTimeout(timer);
    }
}
