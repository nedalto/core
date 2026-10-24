import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";

import { type RawData, type WebSocket, WebSocketServer } from "ws";

import type { Unsubscribe } from "@nedalto/contract/common/bus.ts";
import type { Lifecycle } from "@nedalto/contract/common/lifecycle.ts";
import { isCompatibleSchema, SCHEMA_VERSION } from "@nedalto/contract/common/version.ts";
import { encode } from "@nedalto/contract/common/wire.ts";
import type { ServerConfig } from "@nedalto/contract/config/schemas.ts";
import { type DomainEventBus, EVENT_NAMES } from "@nedalto/contract/events.ts";
import type { Logger } from "@nedalto/contract/logger/ports.ts";
import type { JsonRpcResponse } from "@nedalto/contract/server/schemas.ts";
import { HandshakeCloseCode } from "@nedalto/contract/server/types.ts";

import { Dispatcher } from "./dispatcher.ts";
import { type HandlerTable, SUBSCRIBE_METHOD } from "./methods.ts";
import { Subscriptions, type Views } from "./subscriptions.ts";
import { errorResponse, parseClientMessage, toJsonRpcError } from "./wire.ts";

export interface HttpServerDeps {
    readonly logger: Logger;
    readonly bus: DomainEventBus;
    readonly views: Views;

    /** The handler of every method but `hub.subscribe`. */
    readonly handlers: HandlerTable;
}

/** The `server` section of the configuration, and the token that clients present. */
export type ServerOptions = ServerConfig & { readonly authToken: string };

const HEARTBEAT_MS = 30_000;

// No message a client sends comes near it; the default of ws 8.22, 100 MiB, is memory a small hub may not have.
const MAX_PAYLOAD_BYTES = 1024 * 1024;

// RFC 6455: the endpoint is going away, which tells the client to connect again later.
const GOING_AWAY = 1001;

const utf8 = new TextDecoder();

const toText = (data: RawData): string => utf8.decode(Array.isArray(data) ? Buffer.concat(data) : data);

const digest = (text: string): Buffer => createHash("sha256").update(text).digest();

/** The schema version the client declares in the query of the upgrade request, or `null` if it declares none. */
function declaredVersion(url: string | undefined): number | null {
    const version = URL.parse(url ?? "/", "http://localhost")?.searchParams.get("v");
    return /^\d+$/.test(version ?? "") ? Number(version) : null;
}

interface Open {
    readonly server: Server;
    readonly wss: WebSocketServer;
    readonly heartbeat: NodeJS.Timeout;
    readonly unsubscribes: readonly Unsubscribe[];
}

/**
 * The HTTP and WebSocket endpoint of the hub: one JSON-RPC connection per client.
 * Only connections that offer the token as a subprotocol and declare a schema version the hub
 * speaks in `?v=` are served; see `docs/protocol.md`.
 */
export class HttpServer implements Lifecycle {
    readonly #logger: Logger;
    readonly #bus: DomainEventBus;
    readonly #host: string;
    readonly #port: number;
    readonly #tokenDigest: Buffer;
    readonly #subscriptions: Subscriptions;
    readonly #dispatcher: Dispatcher;
    readonly #awaitingPong = new WeakSet<WebSocket>();
    #open: Open | undefined;

    constructor({ logger, bus, views, handlers }: HttpServerDeps, options: ServerOptions) {
        this.#logger = logger;
        this.#bus = bus;
        this.#host = options.host;
        this.#port = options.port;
        this.#tokenDigest = digest(options.authToken);
        this.#subscriptions = new Subscriptions({ logger, views });
        this.#dispatcher = new Dispatcher(logger, handlers);
    }

    /** The port the server listens on, which tells where it is when it was asked for port 0. */
    get port(): number {
        const address = this.#open?.server.address();
        return typeof address === "object" && address !== null ? address.port : this.#port;
    }

    async start(): Promise<void> {
        const server = createServer((_request, response) => {
            response.writeHead(426, { Upgrade: "websocket" }).end();
        });
        const wss = new WebSocketServer({
            noServer: true,
            maxPayload: MAX_PAYLOAD_BYTES,
            // Node 26.10: a WebSocket client fails the handshake, with 1006, if the response selects none
            // of the subprotocols it offered. So a wrong token is answered like a right one, and refused
            // after the upgrade.
            // See `docs/decisions/0002-authentication-in-the-websocket-handshake.md`.
            handleProtocols: (protocols) =>
                [...protocols].find((protocol) => this.#isToken(protocol)) ?? protocols.values().next().value ?? false,
        });

        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(this.#port, this.#host, resolve);
        });

        server.on("error", (error) => this.#logger.error("server error", error));
        server.on("upgrade", (request, socket, head) => {
            wss.handleUpgrade(request, socket, head, (ws) => this.#onConnection(ws, request));
        });

        const heartbeat = setInterval(() => this.#pulse(wss), HEARTBEAT_MS);
        const unsubscribes = EVENT_NAMES.map((eventName) =>
            this.#bus.on(eventName, (payload) => this.#subscriptions.forward(eventName, payload)),
        );
        this.#open = { server, wss, heartbeat, unsubscribes };
        this.#logger.notice("ready", this.#host, this.port);
    }

    async stop(): Promise<void> {
        const open = this.#open;
        if (open === undefined) {
            return;
        }
        this.#open = undefined;

        clearInterval(open.heartbeat);
        for (const unsubscribe of open.unsubscribes) {
            unsubscribe();
        }
        for (const ws of open.wss.clients) {
            ws.close(GOING_AWAY, "The hub is stopping");
        }
        await new Promise<void>((resolve, reject) => {
            open.wss.close((error) => (error === undefined ? resolve() : reject(error)));
        });
        await new Promise<void>((resolve, reject) => {
            open.server.close((error) => (error === undefined ? resolve() : reject(error)));
        });
        this.#logger.notice("closed");
    }

    #isToken(offered: string): boolean {
        return timingSafeEqual(digest(offered), this.#tokenDigest);
    }

    #onConnection(ws: WebSocket, request: IncomingMessage): void {
        ws.on("error", (error) => this.#logger.warn("client socket error", error));
        const refusal = this.#refusal(ws, request);
        if (refusal !== null) {
            this.#logger.notice("refused connection", refusal.reason);
            ws.close(refusal.code, refusal.reason);
            return;
        }
        ws.on("pong", () => this.#awaitingPong.delete(ws));
        ws.on("close", () => this.#subscriptions.remove(ws));
        ws.on("message", (data) => {
            this.#onMessage(ws, data).catch((error: unknown) => this.#logger.error("message failed", error));
        });
    }

    #refusal(ws: WebSocket, request: IncomingMessage): { code: HandshakeCloseCode; reason: string } | null {
        // `handleProtocols` selected the token if the client offered it.
        if (!this.#isToken(ws.protocol)) {
            return { code: HandshakeCloseCode.Unauthorized, reason: "Missing or invalid token" };
        }
        if (!isCompatibleSchema(declaredVersion(request.url))) {
            return {
                code: HandshakeCloseCode.SchemaVersionMismatch,
                reason: `Unsupported schema version, the hub speaks ${SCHEMA_VERSION}`,
            };
        }
        return null;
    }

    async #onMessage(ws: WebSocket, data: RawData): Promise<void> {
        const outcome = parseClientMessage(toText(data));
        if ("request" in outcome && outcome.request.method === SUBSCRIBE_METHOD) {
            this.#subscriptions.subscribe(ws, outcome.request);
            return;
        }
        const response = await this.#dispatcher.route(outcome);
        if (response !== null) {
            ws.send(this.#encodeResponse(response));
        }
    }

    /** The response as text, or, if it cannot be encoded, the `INTERNAL_ERROR` that answers its request instead. */
    #encodeResponse(response: JsonRpcResponse): string {
        try {
            return encode(response);
        } catch (error) {
            this.#logger.error("response could not be encoded", response.id, error);
            return encode(errorResponse(response.id, toJsonRpcError(error)));
        }
    }

    #pulse(wss: WebSocketServer): void {
        for (const ws of wss.clients) {
            if (this.#awaitingPong.has(ws)) {
                ws.terminate();
            } else {
                this.#awaitingPong.add(ws);
                ws.ping();
            }
        }
    }
}
