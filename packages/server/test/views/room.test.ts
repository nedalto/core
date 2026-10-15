import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createRoomId } from "@nedalto/contract/common/ids.ts";
import { RoomNotFoundError } from "@nedalto/contract/room/errors.ts";

import { RoomView } from "../../src/views/room.ts";
import { MemoryRoomRepository } from "../helpers/repository.ts";

const KITCHEN = { id: createRoomId(), name: "Kitchen" };
const BEDROOM = { id: createRoomId(), name: "Bedroom" };

function setup() {
    const repository = new MemoryRoomRepository();
    repository.save(KITCHEN);
    repository.save(BEDROOM);
    return { repository, view: new RoomView(repository) };
}

describe("RoomView", () => {
    test("lists the rooms of the repository", () => {
        assert.deepEqual(setup().view.list(), [KITCHEN, BEDROOM]);
    });

    test("returns the room with the id", () => {
        assert.deepEqual(setup().view.get(BEDROOM.id), BEDROOM);
    });

    test("throws RoomNotFoundError, naming the room, when the room does not exist", () => {
        const missing = createRoomId();

        assert.throws(
            () => setup().view.get(missing),
            (error) => {
                assert.ok(error instanceof RoomNotFoundError);
                assert.equal(error.code, "NOT_FOUND_ERROR");
                assert.deepEqual(error.data, { roomId: missing });
                return true;
            },
        );
    });
});
