import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { InternalError } from "@nedalto/contract/common/errors.ts";
import { createEndpointId, createRoomId } from "@nedalto/contract/common/ids.ts";
import { JsonRpcErrorCode } from "@nedalto/contract/server/types.ts";

import { createLight, createNode, LIGHT_SHAPE, stateOf } from "./helpers/fixtures.ts";
import { startServer } from "./helpers/server.ts";

const KITCHEN = { id: createRoomId(), name: "Kitchen" };
const SUBSCRIBE = '{"jsonrpc":"2.0","method":"hub.subscribe","id":"sub"}';

describe("Subscriptions", () => {
    test("answers hub.subscribe with the snapshot: the nodes, the endpoints and the rooms", async (context) => {
        const { connect, nodeRepository, endpointRepository, roomRepository, nodeGateway, endpointGateway } =
            await startServer(context);
        const asleep = createNode();
        const online = createNode();
        const light = createLight(online.id, 1, KITCHEN.id);
        nodeRepository.save(asleep);
        nodeRepository.save(online);
        endpointRepository.save(light);
        roomRepository.save(KITCHEN);
        nodeGateway.reachable.add(online.id);
        endpointGateway.shapes.set(light.id, LIGHT_SHAPE);
        const client = await connect();

        const response = await client.call("hub.subscribe");

        assert.deepEqual(response, {
            jsonrpc: "2.0",
            id: 1,
            result: {
                nodes: [
                    { id: asleep.id, reachable: false },
                    { id: online.id, reachable: true },
                ],
                endpoints: [stateOf(light)],
                rooms: [KITCHEN],
            },
        });
    });

    test("leaves an endpoint that cannot be described out of the snapshot", async (context) => {
        const { connect, endpointRepository, endpointGateway } = await startServer(context);
        const node = createNode();
        const described = createLight(node.id, 1);
        endpointRepository.save(described);
        endpointRepository.save(createLight(node.id, 2));
        endpointGateway.shapes.set(described.id, LIGHT_SHAPE);
        const client = await connect();

        const response = await client.call("hub.subscribe");

        assert.deepEqual(response.result, { nodes: [], endpoints: [stateOf(described)], rooms: [] });
    });

    test("sends node:added, with the node and all its endpoints, before the response to node.commission", async (context) => {
        context.mock.timers.enable({ apis: ["Date"], now: 1_000 });
        const { connect, nodeGateway, endpointGateway } = await startServer(context);
        const node = createNode();
        const lights = [createLight(node.id, 1), createLight(node.id, 2)];
        nodeGateway.commissioned = { node, endpoints: lights };
        for (const light of lights) {
            endpointGateway.shapes.set(light.id, LIGHT_SHAPE);
        }
        const client = await connect();
        await client.call("hub.subscribe");

        client.ws.send(
            '{"jsonrpc":"2.0","method":"node.commission","params":{"setupCode":"34970112332"},"id":"commission"}',
        );
        const first = await client.inbox.next();
        const second = await client.inbox.next();

        assert.deepEqual(first, {
            jsonrpc: "2.0",
            method: "node:added",
            params: {
                node: { id: node.id, reachable: false },
                endpoints: lights.map((light) => stateOf(light)),
                timestamp: 1_000,
            },
        });
        assert.deepEqual(second, { jsonrpc: "2.0", id: "commission", result: node.id });
    });

    test("sends endpoint:renamed and endpoint:room-changed for the writes that rename an endpoint and move it to a room", async (context) => {
        context.mock.timers.enable({ apis: ["Date"], now: 1_000 });
        const { connect, endpointRepository, roomRepository } = await startServer(context);
        const light = createLight(createNode().id, 1);
        endpointRepository.save(light);
        roomRepository.save(KITCHEN);
        const client = await connect();
        await client.call("hub.subscribe");

        client.ws.send(
            `{"jsonrpc":"2.0","method":"endpoint.setName","params":{"id":"${light.id}","name":"Lamp"},"id":1}`,
        );
        const renamed = await client.inbox.next();
        await client.inbox.next();
        client.ws.send(
            `{"jsonrpc":"2.0","method":"endpoint.setRoom","params":{"id":"${light.id}","roomId":"${KITCHEN.id}"},"id":2}`,
        );
        const moved = await client.inbox.next();

        assert.deepEqual(renamed, {
            jsonrpc: "2.0",
            method: "endpoint:renamed",
            params: { endpointId: light.id, name: "Lamp", timestamp: 1_000 },
        });
        assert.deepEqual(moved, {
            jsonrpc: "2.0",
            method: "endpoint:room-changed",
            params: { endpointId: light.id, roomId: KITCHEN.id, timestamp: 1_000 },
        });
    });

    test("sends node:removed, and no event for the endpoints of the node, when the node is removed", async (context) => {
        const { connect, nodeRepository, bus } = await startServer(context);
        const node = createNode();
        nodeRepository.save(node);
        const client = await connect();
        await client.call("hub.subscribe");

        client.ws.send(`{"jsonrpc":"2.0","method":"node.decommission","params":{"id":"${node.id}"},"id":"remove"}`);
        const first = await client.inbox.next();
        const second = await client.inbox.next();

        assert.equal(first.method, "node:removed");
        assert.equal(second.id, "remove");
        assert.deepEqual(
            bus.emitted.map((event) => event.name),
            ["node:removed"],
        );
    });

    test("sends room:removed, and no endpoint:room-changed for the endpoints in the room, when the room is removed", async (context) => {
        const { connect, roomRepository, bus } = await startServer(context);
        roomRepository.save(KITCHEN);
        const client = await connect();
        await client.call("hub.subscribe");

        client.ws.send(`{"jsonrpc":"2.0","method":"room.remove","params":{"id":"${KITCHEN.id}"},"id":"remove"}`);
        const first = await client.inbox.next();
        const second = await client.inbox.next();

        assert.equal(first.method, "room:removed");
        assert.equal(second.id, "remove");
        assert.deepEqual(
            bus.emitted.map((event) => event.name),
            ["room:removed"],
        );
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
        assert.deepEqual((await client.call("hub.subscribe")).result, { nodes: [], endpoints: [], rooms: [] });
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
