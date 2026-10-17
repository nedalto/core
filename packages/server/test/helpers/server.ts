import type { TestContext } from "node:test";

import { decode } from "@nedalto/contract/common/wire.ts";
import { validateServerMessage } from "@nedalto/contract/server/schemas.ts";

import { createHttpServer, type HttpServer } from "../../src/server.ts";
import { RecordingBus } from "./bus.ts";
import { FakeEndpointGateway, FakeNodeGateway } from "./gateway.ts";
import { RecordingLogger } from "./logger.ts";
import { MemoryEndpointRepository, MemoryNodeRepository, MemoryRoomRepository } from "./repository.ts";
import { RecordingTransactor } from "./transactor.ts";

export const TOKEN = "s3cret-token";

/** The messages a connection receives, in order, for a test to await one at a time. */
class Inbox {
    readonly #frames: string[] = [];
    readonly #waiting: ((frame: string) => void)[] = [];

    constructor(ws: WebSocket) {
        ws.addEventListener("message", (event) => {
            const frame = String(event.data);
            const waiting = this.#waiting.shift();
            if (waiting === undefined) {
                this.#frames.push(frame);
            } else {
                waiting(frame);
            }
        });
    }

    /** The text of the next message. */
    nextFrame(): Promise<string> {
        const frame = this.#frames.shift();
        return frame === undefined ? new Promise((resolve) => this.#waiting.push(resolve)) : Promise.resolve(frame);
    }

    /** The next message, parsed and checked to be a response or a notification. */
    async next(): Promise<Record<string, unknown>> {
        return Object.fromEntries(Object.entries(validateServerMessage(decode(await this.nextFrame()))));
    }
}

/** Resolves with the code and reason when the connection closes. */
const closure = (ws: WebSocket): Promise<{ code: number; reason: string }> =>
    new Promise((resolve) => {
        ws.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason }));
    });

export interface Client {
    readonly ws: WebSocket;
    readonly inbox: Inbox;
    readonly closed: Promise<{ code: number; reason: string }>;

    /** Sends a request and resolves with the next message, which is expected to be its response. */
    readonly call: (method: string, params?: unknown, id?: number | string) => Promise<Record<string, unknown>>;
}

export interface ConnectOptions {
    /** The subprotocols to offer: the token unless the test says otherwise. */
    readonly protocols?: string[];

    /** The text of `?v=`: 1 unless the test says otherwise, and none for `null`. */
    readonly version?: string | null;
}

/** A fake for each collaborator of the server. */
export const createFakes = () => ({
    bus: new RecordingBus(),
    logger: new RecordingLogger(),
    nodeRepository: new MemoryNodeRepository(),
    endpointRepository: new MemoryEndpointRepository(),
    roomRepository: new MemoryRoomRepository(),
    transactor: new RecordingTransactor(),
    nodeGateway: new FakeNodeGateway(),
    endpointGateway: new FakeEndpointGateway(),
});

export type Started = ReturnType<typeof createFakes> & {
    readonly server: HttpServer;

    /** Opens a connection that the test closes at its end. */
    readonly connect: (options?: ConnectOptions) => Promise<Client>;
};

/** Starts a server on a free loopback port, to be stopped when the test ends. */
export async function startServer(context: TestContext): Promise<Started> {
    const fakes = createFakes();
    const server = createHttpServer(fakes, { host: "127.0.0.1", port: 0, authToken: TOKEN });
    await server.start();

    const sockets: WebSocket[] = [];
    context.after(async () => {
        for (const ws of sockets) {
            ws.close();
        }
        await server.stop();
    });

    async function connect({ protocols = [TOKEN], version = "1" }: ConnectOptions = {}): Promise<Client> {
        const query = version === null ? "" : `?v=${version}`;
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/${query}`, protocols);
        sockets.push(ws);
        const inbox = new Inbox(ws);
        const closed = closure(ws);
        await new Promise<void>((resolve, reject) => {
            ws.addEventListener("open", () => resolve());
            ws.addEventListener("error", () => reject(new Error("The connection failed")));
        });
        let nextId = 1;
        return {
            ws,
            inbox,
            closed,
            call: async (method, params, id = nextId++) => {
                ws.send(JSON.stringify({ jsonrpc: "2.0", method, params, id }));
                return inbox.next();
            },
        };
    }

    return { ...fakes, server, connect };
}
