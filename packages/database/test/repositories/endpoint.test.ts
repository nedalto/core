import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createEndpointId, createNodeId, createRoomId, type NodeId } from "@nedalto/contract/common/ids.ts";
import { EndpointNotFoundError } from "@nedalto/contract/endpoint/errors.ts";
import type { EndpointRecord } from "@nedalto/contract/endpoint/types.ts";

import { openDatabase } from "../helpers/database.ts";

const endpointOf = (nodeId: NodeId, matterNumber: number, name = "Light"): EndpointRecord => ({
    id: createEndpointId(),
    nodeId,
    matterNumber,
    name,
    roomId: null,
});

describe("SqliteEndpointRepository", () => {
    test("returns the saved record by id, with a room and without one", async (context) => {
        const { node, room, endpoint } = await openDatabase(context);
        const nodeId = createNodeId();
        const roomId = createRoomId();
        node.save({ id: nodeId, matterId: 1n });
        room.save({ id: roomId, name: "Kitchen" });
        const unassigned = endpointOf(nodeId, 1);
        const assigned = { ...endpointOf(nodeId, 2), roomId };

        endpoint.save(unassigned);
        endpoint.save(assigned);

        assert.deepEqual(endpoint.findById(unassigned.id), unassigned);
        assert.deepEqual(endpoint.findById(assigned.id), assigned);
    });

    test("returns null for an unknown id", async (context) => {
        const { endpoint } = await openDatabase(context);

        assert.equal(endpoint.findById(createEndpointId()), null);
    });

    test("findByNode returns the endpoints of that node ordered by matter number", async (context) => {
        const { node, endpoint } = await openDatabase(context);
        const nodeId = createNodeId();
        const otherId = createNodeId();
        node.save({ id: nodeId, matterId: 1n });
        node.save({ id: otherId, matterId: 2n });
        const second = endpointOf(nodeId, 2);
        const first = endpointOf(nodeId, 1);
        endpoint.save(second);
        endpoint.save(first);
        endpoint.save(endpointOf(otherId, 1));

        assert.deepEqual(endpoint.findByNode(nodeId), [first, second]);
    });

    test("findAll returns the endpoints ordered by node and then by matter number", async (context) => {
        const { node, endpoint } = await openDatabase(context);
        const [firstNode, secondNode] = [createNodeId(), createNodeId()].toSorted();
        assert.ok(firstNode !== undefined && secondNode !== undefined);
        node.save({ id: secondNode, matterId: 2n });
        node.save({ id: firstNode, matterId: 1n });
        // Saved against the expected order, so insertion order cannot pass for the query's.
        const expected = [endpointOf(firstNode, 1), endpointOf(firstNode, 2), endpointOf(secondNode, 1)];
        for (const record of expected.toReversed()) {
            endpoint.save(record);
        }

        assert.deepEqual(endpoint.findAll(), expected);
    });

    test("refuses an endpoint whose node does not exist", async (context) => {
        const { endpoint } = await openDatabase(context);

        assert.throws(() => endpoint.save(endpointOf(createNodeId(), 1)));
    });

    test("refuses a second endpoint with the same matter number on a node", async (context) => {
        const { node, endpoint } = await openDatabase(context);
        const nodeId = createNodeId();
        node.save({ id: nodeId, matterId: 1n });
        endpoint.save(endpointOf(nodeId, 1));

        assert.throws(() => endpoint.save(endpointOf(nodeId, 1)));
    });

    test("accepts the same matter number on different nodes", async (context) => {
        const { node, endpoint } = await openDatabase(context);
        const firstId = createNodeId();
        const secondId = createNodeId();
        node.save({ id: firstId, matterId: 1n });
        node.save({ id: secondId, matterId: 2n });

        endpoint.save(endpointOf(firstId, 1));
        endpoint.save(endpointOf(secondId, 1));

        assert.equal(endpoint.findAll().length, 2);
    });

    test("setName replaces the name and leaves the rest alone", async (context) => {
        const { node, room, endpoint } = await openDatabase(context);
        const nodeId = createNodeId();
        const roomId = createRoomId();
        node.save({ id: nodeId, matterId: 1n });
        room.save({ id: roomId, name: "Kitchen" });
        const record = { ...endpointOf(nodeId, 1, "Old"), roomId };
        endpoint.save(record);

        endpoint.setName(record.id, "New");

        assert.deepEqual(endpoint.findById(record.id), { ...record, name: "New" });
    });

    test("setRoom assigns the room and clears it with null", async (context) => {
        const { node, room, endpoint } = await openDatabase(context);
        const nodeId = createNodeId();
        const roomId = createRoomId();
        node.save({ id: nodeId, matterId: 1n });
        room.save({ id: roomId, name: "Kitchen" });
        const record = endpointOf(nodeId, 1);
        endpoint.save(record);

        endpoint.setRoom(record.id, roomId);
        assert.equal(endpoint.findById(record.id)?.roomId, roomId);

        endpoint.setRoom(record.id, null);
        assert.equal(endpoint.findById(record.id)?.roomId, null);
    });

    test("setName throws EndpointNotFoundError for an unknown id", async (context) => {
        const { endpoint } = await openDatabase(context);
        const id = createEndpointId();

        assert.throws(
            () => endpoint.setName(id, "x"),
            (error) =>
                error instanceof EndpointNotFoundError &&
                error.code === "NOT_FOUND_ERROR" &&
                error.data?.endpointId === id,
        );
    });

    test("setRoom throws EndpointNotFoundError for an unknown id", async (context) => {
        const { endpoint } = await openDatabase(context);
        const id = createEndpointId();

        assert.throws(
            () => endpoint.setRoom(id, null),
            (error) =>
                error instanceof EndpointNotFoundError &&
                error.code === "NOT_FOUND_ERROR" &&
                error.data?.endpointId === id,
        );
    });
});
