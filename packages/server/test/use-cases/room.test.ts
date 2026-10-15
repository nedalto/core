import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { IntegrationError } from "@nedalto/contract/common/errors.ts";
import { createRoomId } from "@nedalto/contract/common/ids.ts";
import { RoomNotFoundError } from "@nedalto/contract/room/errors.ts";

import { RoomUseCase } from "../../src/use-cases/room.ts";
import { RecordingBus } from "../helpers/bus.ts";
import { MemoryRoomRepository } from "../helpers/repository.ts";

const KITCHEN = { id: createRoomId(), name: "Kitchen" };

function setup() {
    const roomRepository = new MemoryRoomRepository();
    roomRepository.save(KITCHEN);
    const bus = new RecordingBus();
    return { roomRepository, bus, useCase: new RoomUseCase({ roomRepository, bus }) };
}

describe("RoomUseCase", () => {
    test("create stores a room with a new id, returns the id and emits room:added", () => {
        const { roomRepository, bus, useCase } = setup();

        const id = useCase.create("Bedroom");

        assert.deepEqual(roomRepository.records.get(id), { id, name: "Bedroom" });
        assert.equal(bus.emitted.length, 1);
        assert.equal(bus.emitted[0]?.name, "room:added");
        assert.partialDeepStrictEqual(bus.emitted[0]?.payload, { room: { id, name: "Bedroom" } });
    });

    test("rename stores the name and emits room:renamed", () => {
        const { roomRepository, bus, useCase } = setup();

        useCase.rename(KITCHEN.id, "Dining room");

        assert.equal(roomRepository.records.get(KITCHEN.id)?.name, "Dining room");
        assert.equal(bus.emitted[0]?.name, "room:renamed");
        assert.partialDeepStrictEqual(bus.emitted[0]?.payload, { roomId: KITCHEN.id, name: "Dining room" });
    });

    test("remove deletes the room and emits room:removed", () => {
        const { roomRepository, bus, useCase } = setup();

        useCase.remove(KITCHEN.id);

        assert.equal(roomRepository.records.has(KITCHEN.id), false);
        assert.equal(bus.emitted[0]?.name, "room:removed");
        assert.partialDeepStrictEqual(bus.emitted[0]?.payload, { roomId: KITCHEN.id });
    });

    test("rename and remove throw RoomNotFoundError and emit nothing when the room does not exist", () => {
        const { bus, useCase } = setup();
        const missing = createRoomId();

        assert.throws(() => useCase.rename(missing, "Hall"), RoomNotFoundError);
        assert.throws(() => useCase.remove(missing), RoomNotFoundError);
        assert.deepEqual(bus.emitted, []);
    });

    test("create propagates a failed write and emits nothing", () => {
        const { roomRepository, bus, useCase } = setup();
        const failure = new IntegrationError("disk full");
        roomRepository.failure = failure;

        assert.throws(() => useCase.create("Bedroom"), failure);
        assert.deepEqual(bus.emitted, []);
    });

    test("rename propagates a failed write and emits nothing", () => {
        const { roomRepository, bus, useCase } = setup();
        const failure = new IntegrationError("disk full");
        roomRepository.failure = failure;

        assert.throws(() => useCase.rename(KITCHEN.id, "Hall"), failure);
        assert.deepEqual(bus.emitted, []);
    });

    test("remove propagates a failed write and emits nothing", () => {
        const { roomRepository, bus, useCase } = setup();
        const failure = new IntegrationError("disk full");
        roomRepository.failure = failure;

        assert.throws(() => useCase.remove(KITCHEN.id), failure);
        assert.deepEqual(bus.emitted, []);
    });
});
