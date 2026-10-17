import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { IntegrationError } from "@nedalto/contract/common/errors.ts";
import { createEndpointId, createRoomId } from "@nedalto/contract/common/ids.ts";
import { EndpointNotFoundError } from "@nedalto/contract/endpoint/errors.ts";
import { RoomNotFoundError } from "@nedalto/contract/room/errors.ts";

import { EndpointUseCase } from "../../src/use-cases/endpoint.ts";
import { RecordingBus } from "../helpers/bus.ts";
import { createLight, createNode } from "../helpers/fixtures.ts";
import { MemoryEndpointRepository, MemoryRoomRepository } from "../helpers/repository.ts";

const KITCHEN = { id: createRoomId(), name: "Kitchen" };
const LIGHT = createLight(createNode().id, 1);

function setup() {
    const endpointRepository = new MemoryEndpointRepository();
    endpointRepository.save(LIGHT);
    const roomRepository = new MemoryRoomRepository();
    roomRepository.save(KITCHEN);
    const bus = new RecordingBus();
    return {
        endpointRepository,
        roomRepository,
        bus,
        useCase: new EndpointUseCase({ endpointRepository, roomRepository, bus }),
    };
}

describe("EndpointUseCase", () => {
    test("rename stores the name and emits endpoint:renamed", (context) => {
        context.mock.timers.enable({ apis: ["Date"], now: 1_000 });
        const { endpointRepository, bus, useCase } = setup();

        useCase.rename(LIGHT.id, "Lamp");

        assert.equal(endpointRepository.records.get(LIGHT.id)?.name, "Lamp");
        assert.deepEqual(bus.emitted, [
            { name: "endpoint:renamed", payload: { endpointId: LIGHT.id, name: "Lamp", timestamp: 1_000 } },
        ]);
    });

    test("assignRoom stores the room and emits endpoint:room-changed", (context) => {
        context.mock.timers.enable({ apis: ["Date"], now: 1_000 });
        const { endpointRepository, bus, useCase } = setup();

        useCase.assignRoom(LIGHT.id, KITCHEN.id);

        assert.equal(endpointRepository.records.get(LIGHT.id)?.roomId, KITCHEN.id);
        assert.deepEqual(bus.emitted, [
            { name: "endpoint:room-changed", payload: { endpointId: LIGHT.id, roomId: KITCHEN.id, timestamp: 1_000 } },
        ]);
    });

    test("assignRoom clears the room with null, and emits it, without looking for a room", (context) => {
        context.mock.timers.enable({ apis: ["Date"], now: 1_000 });
        const { endpointRepository, roomRepository, bus, useCase } = setup();
        useCase.assignRoom(LIGHT.id, KITCHEN.id);
        roomRepository.failure = new Error("a room was looked for");

        useCase.assignRoom(LIGHT.id, null);

        assert.equal(endpointRepository.records.get(LIGHT.id)?.roomId, null);
        assert.deepEqual(bus.emitted[1], {
            name: "endpoint:room-changed",
            payload: { endpointId: LIGHT.id, roomId: null, timestamp: 1_000 },
        });
    });

    test("assignRoom throws RoomNotFoundError, before writing, and emits nothing when the room does not exist", () => {
        const { endpointRepository, bus, useCase } = setup();
        const missing = createRoomId();
        // The foreign key of the database would fail the write; the fake would accept it.

        assert.throws(() => useCase.assignRoom(LIGHT.id, missing), RoomNotFoundError);

        assert.equal(endpointRepository.records.get(LIGHT.id)?.roomId, null);
        assert.deepEqual(bus.emitted, []);
    });

    test("rename and assignRoom throw EndpointNotFoundError and emit nothing when the endpoint does not exist", () => {
        const { bus, useCase } = setup();
        const missing = createEndpointId();

        assert.throws(() => useCase.rename(missing, "Lamp"), EndpointNotFoundError);
        assert.throws(() => useCase.assignRoom(missing, KITCHEN.id), EndpointNotFoundError);
        assert.deepEqual(bus.emitted, []);
    });

    test("rename propagates a failed write and emits nothing", () => {
        const { endpointRepository, bus, useCase } = setup();
        const failure = new IntegrationError("disk full");
        endpointRepository.failures.arm("setName", failure);

        assert.throws(() => useCase.rename(LIGHT.id, "Lamp"), failure);
        assert.deepEqual(bus.emitted, []);
    });

    test("assignRoom propagates a failed write and emits nothing", () => {
        const { endpointRepository, bus, useCase } = setup();
        const failure = new IntegrationError("disk full");
        endpointRepository.failures.arm("setRoom", failure);

        assert.throws(() => useCase.assignRoom(LIGHT.id, KITCHEN.id), failure);
        assert.deepEqual(bus.emitted, []);
    });
});
