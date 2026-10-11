import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createEndpointId, createNodeId, createRoomId } from "@nedalto/contract/common/ids.ts";
import { RoomNotFoundError } from "@nedalto/contract/room/errors.ts";

import { openDatabase } from "../helpers/database.ts";

describe("SqliteRoomRepository", () => {
    test("returns the saved record by id", async (context) => {
        const { room } = await openDatabase(context);
        const record = { id: createRoomId(), name: "Living room" };

        room.save(record);

        assert.deepEqual(room.findById(record.id), record);
    });

    test("returns null for an unknown id", async (context) => {
        const { room } = await openDatabase(context);

        assert.equal(room.findById(createRoomId()), null);
    });

    test("lists the rooms ordered by name", async (context) => {
        const { room } = await openDatabase(context);
        room.save({ id: createRoomId(), name: "Zebra" });
        room.save({ id: createRoomId(), name: "Alpha" });

        assert.deepEqual(
            room.findAll().map(({ name }) => name),
            ["Alpha", "Zebra"],
        );
    });

    test("setName replaces the name", async (context) => {
        const { room } = await openDatabase(context);
        const id = createRoomId();
        room.save({ id, name: "Old" });

        room.setName(id, "New");

        assert.deepEqual(room.findById(id), { id, name: "New" });
    });

    test("setName throws RoomNotFoundError for an unknown id", async (context) => {
        const { room } = await openDatabase(context);
        const id = createRoomId();

        assert.throws(
            () => room.setName(id, "x"),
            (error) =>
                error instanceof RoomNotFoundError && error.code === "NOT_FOUND_ERROR" && error.data?.roomId === id,
        );
    });

    test("delete removes the room", async (context) => {
        const { room } = await openDatabase(context);
        const id = createRoomId();
        room.save({ id, name: "Kitchen" });

        room.delete(id);

        assert.equal(room.findById(id), null);
    });

    test("delete throws RoomNotFoundError for an unknown id", async (context) => {
        const { room } = await openDatabase(context);
        const id = createRoomId();

        assert.throws(
            () => room.delete(id),
            (error) =>
                error instanceof RoomNotFoundError && error.code === "NOT_FOUND_ERROR" && error.data?.roomId === id,
        );
    });

    test("delete clears the room from its endpoints and keeps them", async (context) => {
        const { node, endpoint, room } = await openDatabase(context);
        const nodeId = createNodeId();
        const roomId = createRoomId();
        const endpointId = createEndpointId();
        node.save({ id: nodeId, matterId: 1n });
        room.save({ id: roomId, name: "Kitchen" });
        endpoint.save({ id: endpointId, nodeId, matterNumber: 1, name: "Light", roomId });

        room.delete(roomId);

        assert.deepEqual(endpoint.findById(endpointId), {
            id: endpointId,
            nodeId,
            matterNumber: 1,
            name: "Light",
            roomId: null,
        });
    });
});
