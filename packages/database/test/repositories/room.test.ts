import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { type RoomId, toNodeId, toRoomId } from "@nedalto/contract/common/ids.ts";
import { RoomNotFoundError } from "@nedalto/contract/room/errors.ts";

import { openDatabase } from "../helpers/database.ts";

const isRoomNotFound =
    (id: RoomId) =>
    (error: unknown): boolean =>
        error instanceof RoomNotFoundError && error.code === "NOT_FOUND_ERROR" && error.data?.roomId === id;

describe("SqliteRoomRepository", () => {
    test("returns the created room by id", async (context) => {
        const { room } = await openDatabase(context);

        const created = room.create("Living room");

        assert.equal(created.name, "Living room");
        assert.deepEqual(room.findById(created.id), created);
    });

    test("returns null for an unknown id", async (context) => {
        const { room } = await openDatabase(context);

        assert.equal(room.findById(toRoomId(1n)), null);
    });

    test("does not give a new room the id of a deleted one", async (context) => {
        const { room } = await openDatabase(context);
        room.create("Kitchen");
        const deleted = room.create("Hall");
        room.delete(deleted.id);

        assert.notEqual(room.create("Bedroom").id, deleted.id);
    });

    test("lists the rooms in the order they were created", async (context) => {
        const { room } = await openDatabase(context);
        // Against alphabetical order, so ordering by name cannot pass for ordering by id.
        const created = [room.create("Zebra"), room.create("Alpha")];

        assert.deepEqual(room.findAll(), created);
    });

    test("setName replaces the name", async (context) => {
        const { room } = await openDatabase(context);
        const { id } = room.create("Old");

        room.setName(id, "New");

        assert.deepEqual(room.findById(id), { id, name: "New" });
    });

    test("setName throws RoomNotFoundError for an unknown id", async (context) => {
        const { room } = await openDatabase(context);
        const id = toRoomId(1n);

        assert.throws(() => room.setName(id, "x"), isRoomNotFound(id));
    });

    test("delete removes the room", async (context) => {
        const { room } = await openDatabase(context);
        const { id } = room.create("Kitchen");

        room.delete(id);

        assert.equal(room.findById(id), null);
    });

    test("delete throws RoomNotFoundError for an unknown id", async (context) => {
        const { room } = await openDatabase(context);
        const id = toRoomId(1n);

        assert.throws(() => room.delete(id), isRoomNotFound(id));
    });

    test("delete clears the room from its endpoints and keeps them", async (context) => {
        const { node, endpoint, room } = await openDatabase(context);
        const { id: nodeId } = node.create(toNodeId(1n));
        const kitchen = room.create("Kitchen");
        const created = endpoint.create({ nodeId, number: 1, name: "Light" });
        endpoint.setRoom(created.id, kitchen.id);

        room.delete(kitchen.id);

        assert.deepEqual(endpoint.findById(created.id), created);
    });
});
