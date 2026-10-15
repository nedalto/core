import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { InternalError } from "@nedalto/contract/common/errors.ts";
import { createEndpointId, createRoomId } from "@nedalto/contract/common/ids.ts";
import { JsonRpcErrorCode } from "@nedalto/contract/server/types.ts";

import { startServer } from "./helpers/server.ts";

const KITCHEN = { id: createRoomId(), name: "Kitchen" };
const SUBSCRIBE = '{"jsonrpc":"2.0","method":"hub.subscribe","id":"sub"}';

describe("Subscriptions", () => {
    test("answers hub.subscribe with the snapshot", async (context) => {
        const { connect, roomRepository } = await startServer(context);
        roomRepository.save(KITCHEN);
        const client = await connect();

        const response = await client.call("hub.subscribe");

        assert.deepEqual(response, { jsonrpc: "2.0", id: 1, result: { rooms: [KITCHEN] } });
    });

    test("sends the snapshot before an event that is emitted right after it is composed", async (context) => {
        const { connect, roomRepository, bus } = await startServer(context);
        const client = await connect();
        const added = { room: KITCHEN, timestamp: 1 };
        roomRepository.onFindAll = () => queueMicrotask(() => bus.emit("room:added", added));

        client.ws.send(SUBSCRIBE);
        const first = await client.inbox.next();
        const second = await client.inbox.next();

        assert.equal(first.id, "sub");
        assert.deepEqual(second, { jsonrpc: "2.0", method: "room:added", params: added });
    });

    test("forwards the events of the bus, each under its own name, to a connection that subscribed", async (context) => {
        const { connect, bus } = await startServer(context);
        const client = await connect();
        await client.call("hub.subscribe");

        bus.emit("room:added", { room: KITCHEN, timestamp: 1 });
        bus.emit("room:renamed", { roomId: KITCHEN.id, name: "Hall", timestamp: 2 });
        bus.emit("room:removed", { roomId: KITCHEN.id, timestamp: 3 });

        assert.deepEqual(
            [await client.inbox.next(), await client.inbox.next(), await client.inbox.next()],
            [
                { jsonrpc: "2.0", method: "room:added", params: { room: KITCHEN, timestamp: 1 } },
                { jsonrpc: "2.0", method: "room:renamed", params: { roomId: KITCHEN.id, name: "Hall", timestamp: 2 } },
                { jsonrpc: "2.0", method: "room:removed", params: { roomId: KITCHEN.id, timestamp: 3 } },
            ],
        );
    });

    test("sends the event of a write to the connections that subscribed, and the response to the one that asked", async (context) => {
        const { connect } = await startServer(context);
        const watcher = await connect();
        const writer = await connect();
        await watcher.call("hub.subscribe");

        const response = await writer.call("room.add", { name: "Kitchen" });
        const event = await watcher.inbox.next();

        assert.equal(event.method, "room:added");
        assert.partialDeepStrictEqual(event.params, { room: { id: response.result, name: "Kitchen" } });
        assert.ok(typeof event.params === "object" && event.params !== null && "timestamp" in event.params);
        assert.equal(typeof event.params.timestamp, "number");
    });

    test("sends a connection the event of its own write before the response", async (context) => {
        const { connect } = await startServer(context);
        const client = await connect();
        await client.call("hub.subscribe");

        client.ws.send('{"jsonrpc":"2.0","method":"room.add","params":{"name":"Kitchen"},"id":"add"}');
        const first = await client.inbox.next();
        const second = await client.inbox.next();

        assert.equal(first.method, "room:added");
        assert.equal(second.id, "add");
    });

    test("does not send the events that came before the subscription", async (context) => {
        const { connect, bus } = await startServer(context);
        const client = await connect();
        bus.emit("room:added", { room: KITCHEN, timestamp: 1 });

        const first = await client.call("hub.subscribe");

        assert.equal(first.id, 1);
    });

    test("sends the event once to a connection that subscribes twice, after a fresh snapshot", async (context) => {
        const { connect, bus } = await startServer(context);
        const client = await connect();
        await client.call("hub.subscribe");
        client.ws.send(SUBSCRIBE);
        const snapshot = await client.inbox.next();

        bus.emit("room:removed", { roomId: KITCHEN.id, timestamp: 1 });
        bus.emit("room:added", { room: KITCHEN, timestamp: 2 });
        const events = [await client.inbox.next(), await client.inbox.next()];

        assert.equal(snapshot.id, "sub");
        assert.deepEqual(
            events.map((event) => event.method),
            ["room:removed", "room:added"],
        );
    });

    test("writes an integer outside the safe range into a notification as it is, without rounding it", async (context) => {
        const { connect, bus } = await startServer(context);
        const client = await connect();
        await client.call("hub.subscribe");
        const change = { endpointId: createEndpointId(), clusterId: 6, attributeId: 0, timestamp: 1 };

        bus.emit("endpoint:changed", { ...change, value: 12345678901234567890n });
        const frame = await client.inbox.nextFrame();

        assert.ok(frame.includes('"value":12345678901234567890}'), frame);
    });

    test("writes a small bigint into a notification as a number", async (context) => {
        const { connect, bus } = await startServer(context);
        const client = await connect();
        await client.call("hub.subscribe");
        const change = { endpointId: createEndpointId(), clusterId: 6, attributeId: 0, timestamp: 1 };

        bus.emit("endpoint:changed", { ...change, value: 5n });
        const frame = await client.inbox.nextFrame();

        assert.ok(frame.includes('"value":5}'), frame);
    });

    test("answers an error, without its details, and goes on serving when the snapshot cannot be composed", async (context) => {
        const { connect, roomRepository, logger } = await startServer(context);
        const client = await connect();
        roomRepository.failure = new InternalError("secret detail");

        client.ws.send(SUBSCRIBE);
        const frame = await client.inbox.nextFrame();

        assert.ok(!frame.includes("secret detail"));
        assert.partialDeepStrictEqual(JSON.parse(frame), {
            id: "sub",
            error: { code: JsonRpcErrorCode.ApplicationError, data: { code: "INTERNAL_ERROR" } },
        });
        assert.equal(logger.at("error").length, 1);
        assert.deepEqual((await client.call("hub.subscribe")).result, { rooms: [] });
    });

    test("answers invalid params, and does not subscribe, when the params are not empty", async (context) => {
        const { connect, bus } = await startServer(context);
        const client = await connect();

        const error = await client.call("hub.subscribe", { $bytes: "00" });
        bus.emit("room:added", { room: KITCHEN, timestamp: 1 });
        const next = await client.call("room.list");

        assert.partialDeepStrictEqual(error.error, { code: JsonRpcErrorCode.InvalidParams });
        assert.equal(next.id, 2);
    });
});
