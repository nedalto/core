import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { type EndpointId, type NodeId, toEndpointId, toNodeId } from "@nedalto/contract/common/ids.ts";
import { EndpointNotFoundError } from "@nedalto/contract/endpoint/errors.ts";
import type { DeviceEndpoint } from "@nedalto/contract/endpoint/types.ts";

import { openDatabase } from "../helpers/database.ts";

const deviceEndpoint = (nodeId: NodeId, number: number, name = "Light"): DeviceEndpoint => ({ nodeId, number, name });

const isEndpointNotFound =
    (id: EndpointId) =>
    (error: unknown): boolean =>
        error instanceof EndpointNotFoundError && error.code === "NOT_FOUND_ERROR" && error.data?.endpointId === id;

describe("SqliteEndpointRepository", () => {
    test("creates the endpoint without a room and returns it as stored", async (context) => {
        const { node, endpoint } = await openDatabase(context);
        const { id: nodeId } = node.create(toNodeId(1n));

        const created = endpoint.create(deviceEndpoint(nodeId, 2));

        assert.deepEqual(created, { id: toEndpointId(nodeId, 2), nodeId, number: 2, name: "Light", roomId: null });
        assert.deepEqual(endpoint.findById(created.id), created);
    });

    test("keeps the endpoints of a node whose id is stored as a negative int64 intact", async (context) => {
        const { node, room, endpoint } = await openDatabase(context);
        const { id: nodeId } = node.create(toNodeId(2n ** 64n - 1n));
        const kitchen = room.create("Kitchen");

        const created = endpoint.create(deviceEndpoint(nodeId, 1, "Old"));
        endpoint.setName(created.id, "New");
        endpoint.setRoom(created.id, kitchen.id);

        const expected = { ...created, name: "New", roomId: kitchen.id };
        assert.deepEqual(endpoint.findById(created.id), expected);
        assert.deepEqual(endpoint.findByNode(nodeId), [expected]);
        assert.deepEqual(endpoint.findAll(), [expected]);

        endpoint.delete(created.id);

        assert.deepEqual(endpoint.findByNode(nodeId), []);
    });

    test("returns null for an unknown id", async (context) => {
        const { endpoint } = await openDatabase(context);

        assert.equal(endpoint.findById(toEndpointId(toNodeId(1n), 1)), null);
    });

    test("findByNode returns the endpoints of that node ordered by number", async (context) => {
        const { node, endpoint } = await openDatabase(context);
        const { id: nodeId } = node.create(toNodeId(1n));
        const { id: otherId } = node.create(toNodeId(2n));
        const second = endpoint.create(deviceEndpoint(nodeId, 2, "A"));
        const first = endpoint.create(deviceEndpoint(nodeId, 1, "B"));
        endpoint.create(deviceEndpoint(otherId, 1));

        assert.deepEqual(endpoint.findByNode(nodeId), [first, second]);
    });

    test("findAll returns the endpoints ordered by node and then by number", async (context) => {
        const { node, endpoint } = await openDatabase(context);
        // Stored as a negative int64, so it comes first unless the query puts it last.
        const { id: secondNode } = node.create(toNodeId(2n ** 64n - 1n));
        const { id: firstNode } = node.create(toNodeId(1n));
        // Created and named against the expected order, so neither can pass for the query's.
        const expected = [
            deviceEndpoint(firstNode, 1, "C"),
            deviceEndpoint(firstNode, 2, "B"),
            deviceEndpoint(secondNode, 1, "A"),
        ]
            .toReversed()
            .map((created) => endpoint.create(created))
            .toReversed();

        assert.deepEqual(endpoint.findAll(), expected);
    });

    test("refuses an endpoint whose node does not exist", async (context) => {
        const { endpoint } = await openDatabase(context);

        assert.throws(() => endpoint.create(deviceEndpoint(toNodeId(1n), 1)));
    });

    test("refuses a second endpoint with the same number on a node", async (context) => {
        const { node, endpoint } = await openDatabase(context);
        const { id: nodeId } = node.create(toNodeId(1n));
        endpoint.create(deviceEndpoint(nodeId, 1));

        assert.throws(() => endpoint.create(deviceEndpoint(nodeId, 1)));
    });

    test("accepts the same number on different nodes", async (context) => {
        const { node, endpoint } = await openDatabase(context);
        const { id: firstId } = node.create(toNodeId(1n));
        const { id: secondId } = node.create(toNodeId(2n));

        endpoint.create(deviceEndpoint(firstId, 1));
        endpoint.create(deviceEndpoint(secondId, 1));

        assert.equal(endpoint.findAll().length, 2);
    });

    test("setName replaces the name and leaves the rest alone", async (context) => {
        const { node, room, endpoint } = await openDatabase(context);
        const { id: nodeId } = node.create(toNodeId(1n));
        const kitchen = room.create("Kitchen");
        const created = endpoint.create(deviceEndpoint(nodeId, 1, "Old"));
        endpoint.setRoom(created.id, kitchen.id);

        endpoint.setName(created.id, "New");

        assert.deepEqual(endpoint.findById(created.id), { ...created, name: "New", roomId: kitchen.id });
    });

    test("setRoom assigns the room and clears it with null", async (context) => {
        const { node, room, endpoint } = await openDatabase(context);
        const { id: nodeId } = node.create(toNodeId(1n));
        const kitchen = room.create("Kitchen");
        const created = endpoint.create(deviceEndpoint(nodeId, 1));

        endpoint.setRoom(created.id, kitchen.id);
        assert.equal(endpoint.findById(created.id)?.roomId, kitchen.id);

        endpoint.setRoom(created.id, null);
        assert.equal(endpoint.findById(created.id)?.roomId, null);
    });

    test("delete removes the endpoint and leaves its node and the other endpoints alone", async (context) => {
        const { node, endpoint } = await openDatabase(context);
        const created = node.create(toNodeId(1n));
        const removed = endpoint.create(deviceEndpoint(created.id, 1));
        const kept = endpoint.create(deviceEndpoint(created.id, 2));

        endpoint.delete(removed.id);

        assert.deepEqual(endpoint.findByNode(created.id), [kept]);
        assert.deepEqual(node.findById(created.id), created);
    });

    test("setName throws EndpointNotFoundError for an unknown id", async (context) => {
        const { endpoint } = await openDatabase(context);
        const id = toEndpointId(toNodeId(1n), 1);

        assert.throws(() => endpoint.setName(id, "x"), isEndpointNotFound(id));
    });

    test("setRoom throws EndpointNotFoundError for an unknown id", async (context) => {
        const { endpoint } = await openDatabase(context);
        const id = toEndpointId(toNodeId(1n), 1);

        assert.throws(() => endpoint.setRoom(id, null), isEndpointNotFound(id));
    });

    test("delete throws EndpointNotFoundError for an unknown id", async (context) => {
        const { endpoint } = await openDatabase(context);
        const id = toEndpointId(toNodeId(1n), 1);

        assert.throws(() => endpoint.delete(id), isEndpointNotFound(id));
    });
});
