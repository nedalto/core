import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { connect as connectSocket, type Socket } from "node:net";
import { describe, test } from "node:test";

import { InternalError } from "@nedalto/contract/common/errors.ts";
import { createRoomId, isUuidV7, type RoomId } from "@nedalto/contract/common/ids.ts";
import { JsonRpcErrorCode, HandshakeCloseCode } from "@nedalto/contract/server/types.ts";

import { createHttpServer } from "../src/server.ts";
import { RecordingBus } from "./helpers/bus.ts";
import { RecordingLogger } from "./helpers/logger.ts";
import { MemoryRoomRepository } from "./helpers/repository.ts";
import { startServer, TOKEN } from "./helpers/server.ts";

const KITCHEN = { id: createRoomId(), name: "Kitchen" };

/** Opens a connection with a handshake written by hand, which answers no ping. */
async function connectMute(port: number): Promise<{ socket: Socket; received: () => Buffer }> {
    const socket = connectSocket({ host: "127.0.0.1", port });
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.write(
        [
            "GET /?v=1 HTTP/1.1",
            `Host: 127.0.0.1:${port}`,
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
            "Sec-WebSocket-Version: 13",
            `Sec-WebSocket-Protocol: ${TOKEN}`,
            "",
            "",
        ].join("\r\n"),
    );
    const received = () => Buffer.concat(chunks);
    await untilReceived(socket, received, (data) => data.includes("\r\n\r\n"));
    return { socket, received };
}

/** Resolves when what the socket has received satisfies `condition`. */
function untilReceived(socket: Socket, received: () => Buffer, condition: (data: Buffer) => boolean): Promise<void> {
    return new Promise((resolve) => {
        function check(): void {
            if (condition(received())) {
                socket.off("data", check);
                resolve();
            }
        }
        socket.on("data", check);
        check();
    });
}

describe("HttpServer", () => {
    test("serves a connection that offers the token and declares the schema version", async (context) => {
        const { connect } = await startServer(context);
        const client = await connect();

        const response = await client.call("room.list");

        assert.deepEqual(response, { jsonrpc: "2.0", id: 1, result: [] });
    });

    test("closes with Unauthorized, giving the reason, when the token is wrong", async (context) => {
        const { connect } = await startServer(context);

        await Promise.all(
            ["wrong", `${TOKEN}-`, TOKEN.toUpperCase()].map(async (wrong) => {
                const { code, reason } = await (await connect({ protocols: [wrong] })).closed;

                assert.equal(code, HandshakeCloseCode.Unauthorized, wrong);
                assert.notEqual(reason, "", wrong);
            }),
        );
    });

    test("closes with Unauthorized when no subprotocol is offered", async (context) => {
        const { connect } = await startServer(context);
        const client = await connect({ protocols: [] });

        assert.equal((await client.closed).code, HandshakeCloseCode.Unauthorized);
    });

    test("selects one of the subprotocols offered, so that a browser completes the handshake, when the token is wrong", async (context) => {
        const { connect } = await startServer(context);
        const client = await connect({ protocols: ["wrong", "other"] });

        assert.ok(["wrong", "other"].includes(client.ws.protocol));
        assert.equal((await client.closed).code, HandshakeCloseCode.Unauthorized);
    });

    test("selects the token, and serves, when it is among several subprotocols", async (context) => {
        const { connect } = await startServer(context);
        const client = await connect({ protocols: ["other", TOKEN, "another"] });

        assert.equal(client.ws.protocol, TOKEN);
        assert.equal((await client.call("room.list")).id, 1);
    });

    test("closes with SchemaVersionMismatch, giving the reason, when the version is not the hub's", async (context) => {
        const { connect } = await startServer(context);

        await Promise.all(
            ["999", "0", "abc", "1.5", "1.0", "1abc", ""].map(async (version) => {
                const { code, reason } = await (await connect({ version })).closed;

                assert.equal(code, HandshakeCloseCode.SchemaVersionMismatch, version);
                assert.notEqual(reason, "", version);
            }),
        );
    });

    test("closes with SchemaVersionMismatch when the client declares no version", async (context) => {
        const { connect } = await startServer(context);
        const client = await connect({ version: null });

        assert.equal((await client.closed).code, HandshakeCloseCode.SchemaVersionMismatch);
    });

    test("closes with Unauthorized when both the token and the version are wrong", async (context) => {
        const { connect } = await startServer(context);
        const client = await connect({ protocols: ["wrong"], version: "999" });

        assert.equal((await client.closed).code, HandshakeCloseCode.Unauthorized);
    });

    test("processes no message of a connection it refuses", async (context) => {
        const { connect, roomRepository, bus } = await startServer(context);
        const client = await connect({ protocols: ["wrong"] });

        // The message is on its way before the client reads the close frame, so the server
        // reads it before it reads the client's answer to that frame.
        client.ws.send(JSON.stringify({ jsonrpc: "2.0", method: "room.add", params: { name: "Hall" }, id: 1 }));
        await client.closed;

        assert.equal(roomRepository.records.size, 0);
        assert.deepEqual(bus.emitted, []);
    });

    test("answers 426, with no body, to an HTTP request that does not ask for an upgrade", async (context) => {
        const { server } = await startServer(context);

        const response = await fetch(`http://127.0.0.1:${server.port}/`);

        assert.equal(response.status, 426);
        assert.equal(await response.text(), "");
    });

    test("answers a parse error and goes on serving when the message is not JSON", async (context) => {
        const { connect } = await startServer(context);
        const client = await connect();

        client.ws.send("{ not json");
        const error = await client.inbox.next();

        assert.equal(error.id, null);
        assert.partialDeepStrictEqual(error.error, { code: JsonRpcErrorCode.ParseError });
        assert.equal((await client.call("room.list")).id, 1);
    });

    test("answers an invalid request and goes on serving when the message is a batch", async (context) => {
        const { connect } = await startServer(context);
        const client = await connect();

        client.ws.send('[{"jsonrpc":"2.0","method":"room.list","id":1}]');
        const error = await client.inbox.next();

        assert.partialDeepStrictEqual(error.error, { code: JsonRpcErrorCode.InvalidRequest });
        assert.equal((await client.call("room.list")).id, 1);
    });

    test("answers invalid params under the id of the request, and goes on serving, when the params are by position", async (context) => {
        const { connect } = await startServer(context);
        const client = await connect();

        const error = await client.call("room.get", [KITCHEN.id], "get");

        assert.equal(error.id, "get");
        assert.partialDeepStrictEqual(error.error, {
            code: JsonRpcErrorCode.InvalidParams,
            data: { code: "VALIDATION_ERROR" },
        });
        assert.equal((await client.call("room.list")).id, 1);
    });

    test("answers method not found and goes on serving when the method does not exist", async (context) => {
        const { connect } = await startServer(context);
        const client = await connect();

        const error = await client.call("room.explode");

        assert.partialDeepStrictEqual(error.error, {
            code: JsonRpcErrorCode.MethodNotFound,
            data: { method: "room.explode" },
        });
        assert.equal((await client.call("room.list")).id, 2);
    });

    test("answers an internal error, without its details, and goes on serving when a handler throws an InternalError", async (context) => {
        const { connect, roomRepository, logger } = await startServer(context);
        const client = await connect();
        roomRepository.failure = new InternalError("secret detail");

        client.ws.send('{"jsonrpc":"2.0","method":"room.list","id":"boom"}');
        const frame = await client.inbox.nextFrame();

        assert.ok(!frame.includes("secret detail"));
        assert.partialDeepStrictEqual(JSON.parse(frame), {
            id: "boom",
            error: {
                code: JsonRpcErrorCode.ApplicationError,
                message: "Internal error",
                data: { code: "INTERNAL_ERROR" },
            },
        });
        assert.equal(logger.at("error").length, 1);
        assert.equal((await client.call("room.list")).id, 1);
    });

    test("answers nothing to a notification of the client", async (context) => {
        const { connect } = await startServer(context);
        const client = await connect();

        client.ws.send('{"jsonrpc":"2.0","method":"room.add","params":{"name":"Hall"}}');
        const response = await client.call("room.list");

        assert.equal(response.id, 1);
        assert.deepEqual(response.result, []);
    });

    test("keeps a connection that answers the pings", async (context) => {
        context.mock.timers.enable({ apis: ["setInterval"] });
        const { connect } = await startServer(context);
        const client = await connect();

        // The answers prove that the client has seen the ping, and so that its pong has gone.
        async function beat(): Promise<void> {
            context.mock.timers.tick(30_000);
            await client.call("room.list");
            await client.call("room.list");
        }
        await beat();
        await beat();
        await beat();

        const outcome = await Promise.race([
            client.call("room.list").then(() => "open"),
            client.closed.then(() => "closed"),
        ]);
        assert.equal(outcome, "open");
    });

    test(
        "terminates a connection that does not answer a ping before the next one",
        { timeout: 10_000 },
        async (context) => {
            context.mock.timers.enable({ apis: ["setInterval"] });
            const { server } = await startServer(context);
            const { socket, received } = await connectMute(server.port);
            const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
            const PING = Buffer.from([0x89, 0x00]);

            context.mock.timers.tick(30_000);
            await untilReceived(socket, received, (data) => data.includes(PING));
            context.mock.timers.tick(30_000);

            await closed;
        },
    );

    test("logs a warning and goes on serving when a client breaks the WebSocket protocol", async (context) => {
        const { server, connect, logger } = await startServer(context);
        const { socket } = await connectMute(server.port);
        const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));

        // A masked frame with the reserved opcode 3.
        socket.write(Buffer.from([0x83, 0x80, 0, 0, 0, 0]));
        await closed;

        assert.equal(logger.at("warn").length, 1);
        assert.equal((await (await connect()).call("room.list")).id, 1);
    });

    test("answers INTERNAL_ERROR and goes on serving when a response cannot be encoded", async (context) => {
        const { connect, roomRepository, logger } = await startServer(context);
        const client = await connect();
        const cyclic: { id: RoomId; name: string; self?: unknown } = { ...KITCHEN };
        cyclic.self = cyclic;
        roomRepository.records.set(KITCHEN.id, cyclic);

        const response = await client.call("room.list", undefined, "cyclic");
        const next = await client.call("room.add", { name: "Hall" });

        assert.deepEqual(response, {
            jsonrpc: "2.0",
            id: "cyclic",
            error: { code: -32000, message: "Internal error", data: { code: "INTERNAL_ERROR" } },
        });
        assert.equal(next.id, 1);
        assert.equal(logger.at("error").length, 1);
    });

    test("closes with 1009 a connection that sends a message larger than 1 MiB", async (context) => {
        const { connect } = await startServer(context);
        const client = await connect();

        client.ws.send(
            JSON.stringify({ jsonrpc: "2.0", method: "room.add", params: { name: "x".repeat(1024 * 1024) }, id: 1 }),
        );

        assert.equal((await client.closed).code, 1009);
    });

    test("room.list returns the rooms", async (context) => {
        const { connect, roomRepository } = await startServer(context);
        roomRepository.save(KITCHEN);
        const client = await connect();

        assert.deepEqual((await client.call("room.list")).result, [KITCHEN]);
    });

    test("room.get returns the room", async (context) => {
        const { connect, roomRepository } = await startServer(context);
        roomRepository.save(KITCHEN);
        const client = await connect();

        assert.deepEqual((await client.call("room.get", { id: KITCHEN.id })).result, KITCHEN);
    });

    test("room.get answers NOT_FOUND_ERROR, naming the room, when the room does not exist", async (context) => {
        const { connect } = await startServer(context);
        const client = await connect();
        const roomId = createRoomId();

        const response = await client.call("room.get", { id: roomId });

        assert.partialDeepStrictEqual(response.error, {
            code: JsonRpcErrorCode.ApplicationError,
            data: { code: "NOT_FOUND_ERROR", roomId },
        });
    });

    test("room.add stores the room and returns its id", async (context) => {
        const { connect, roomRepository } = await startServer(context);
        const client = await connect();

        const { result } = await client.call("room.add", { name: "Kitchen" });

        assert.ok(typeof result === "string" && isUuidV7(result));
        assert.deepEqual([...roomRepository.records.values()], [{ id: result, name: "Kitchen" }]);
    });

    test("room.setName renames the room and returns null", async (context) => {
        const { connect, roomRepository } = await startServer(context);
        roomRepository.save(KITCHEN);
        const client = await connect();

        const response = await client.call("room.setName", { id: KITCHEN.id, name: "Dining room" });

        assert.equal(response.result, null);
        assert.equal(roomRepository.records.get(KITCHEN.id)?.name, "Dining room");
    });

    test("room.remove removes the room and returns null", async (context) => {
        const { connect, roomRepository } = await startServer(context);
        roomRepository.save(KITCHEN);
        const client = await connect();

        const response = await client.call("room.remove", { id: KITCHEN.id });

        assert.equal(response.result, null);
        assert.equal(roomRepository.records.size, 0);
    });

    test("room.setName and room.remove answer NOT_FOUND_ERROR when the room does not exist", async (context) => {
        const { connect } = await startServer(context);
        const client = await connect();
        const id = createRoomId();

        const renamed = await client.call("room.setName", { id, name: "Hall" });
        const removed = await client.call("room.remove", { id });

        for (const response of [renamed, removed]) {
            assert.partialDeepStrictEqual(response.error, { data: { code: "NOT_FOUND_ERROR", roomId: id } });
        }
    });

    test("answers invalid params, listing the issues, when the name is not valid", async (context) => {
        const { connect, roomRepository } = await startServer(context);
        const client = await connect();

        const response = await client.call("room.add", { name: "x".repeat(33) });

        assert.partialDeepStrictEqual(response.error, {
            code: JsonRpcErrorCode.InvalidParams,
            data: { code: "VALIDATION_ERROR", issues: [{ path: "name" }] },
        });
        assert.equal(roomRepository.records.size, 0);
    });

    test("answers invalid params when the params carry a key that starts with $", async (context) => {
        const { connect, roomRepository } = await startServer(context);
        const client = await connect();

        const response = await client.call("room.add", { name: "Kitchen", $bytes: "00" });

        assert.partialDeepStrictEqual(response.error, { code: JsonRpcErrorCode.InvalidParams });
        assert.equal(roomRepository.records.size, 0);
    });

    test("answers an error and keeps nothing when a write fails", async (context) => {
        const { connect, roomRepository, bus } = await startServer(context);
        roomRepository.save(KITCHEN);
        const client = await connect();
        roomRepository.failure = new InternalError("disk");

        const response = await client.call("room.remove", { id: KITCHEN.id });

        assert.partialDeepStrictEqual(response.error, { data: { code: "INTERNAL_ERROR" } });
        assert.deepEqual(bus.emitted, []);
        assert.equal(roomRepository.records.size, 1);
    });

    test("rejects when the port is in use, instead of never settling", async (context) => {
        const occupied: Server = createServer();
        await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
        context.after(() => new Promise<void>((resolve) => occupied.close(() => resolve())));
        const address = occupied.address();
        assert.ok(typeof address === "object" && address !== null);
        const server = createHttpServer(
            { logger: new RecordingLogger(), bus: new RecordingBus(), roomRepository: new MemoryRoomRepository() },
            { host: "127.0.0.1", port: address.port, authToken: TOKEN },
        );

        await assert.rejects(server.start(), { code: "EADDRINUSE" });
    });

    test("closes the open connections with 1001 and resolves", async (context) => {
        const { server, connect } = await startServer(context);
        const client = await connect();

        await server.stop();

        assert.equal((await client.closed).code, 1001);
    });

    test("does nothing when the server was never started", async () => {
        const server = createHttpServer(
            { logger: new RecordingLogger(), bus: new RecordingBus(), roomRepository: new MemoryRoomRepository() },
            { host: "127.0.0.1", port: 0, authToken: TOKEN },
        );

        await server.stop();
    });
});
