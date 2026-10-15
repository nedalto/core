import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ValidationError } from "@nedalto/contract/common/errors.ts";
import { createRoomId } from "@nedalto/contract/common/ids.ts";

import { roomHandlers } from "../../src/handlers/room.ts";
import { RoomUseCase } from "../../src/use-cases/room.ts";
import { RoomView } from "../../src/views/room.ts";
import { RecordingBus } from "../helpers/bus.ts";
import { MemoryRoomRepository } from "../helpers/repository.ts";

const KITCHEN = { id: createRoomId(), name: "Kitchen" };

function setup() {
    const roomRepository = new MemoryRoomRepository();
    roomRepository.save(KITCHEN);
    const bus = new RecordingBus();
    const handlers = roomHandlers({
        roomView: new RoomView(roomRepository),
        roomUseCase: new RoomUseCase({ roomRepository, bus }),
    });
    return { roomRepository, bus, handlers };
}

describe("roomHandlers", () => {
    test("every handler throws a ValidationError, before reading or writing, when the params are invalid", () => {
        const { roomRepository, bus, handlers } = setup();
        // A failure armed on the repository would be thrown by the first call that reached it.
        const unreachable = new Error("The repository was reached");
        roomRepository.failure = unreachable;

        const invalid: [keyof typeof handlers, unknown][] = [
            ["room.list", { id: KITCHEN.id }],
            ["room.get", {}],
            ["room.add", { name: "" }],
            ["room.setName", { id: KITCHEN.id }],
            ["room.remove", { id: "not-an-id" }],
        ];
        for (const [method, params] of invalid) {
            assert.throws(() => handlers[method](params), ValidationError, method);
        }
        assert.equal(roomRepository.failure, unreachable);
        assert.deepEqual(bus.emitted, []);
    });
});
