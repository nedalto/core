import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ValidationError } from "@nedalto/contract/common/errors.ts";
import { createEndpointId } from "@nedalto/contract/common/ids.ts";

import { endpointHandlers } from "../../src/handlers/endpoint.ts";
import { EndpointUseCase } from "../../src/use-cases/endpoint.ts";
import { EndpointView } from "../../src/views/endpoint.ts";
import { RecordingBus } from "../helpers/bus.ts";
import { FakeEndpointGateway } from "../helpers/gateway.ts";
import { RecordingLogger } from "../helpers/logger.ts";
import { MemoryEndpointRepository, MemoryRoomRepository } from "../helpers/repository.ts";

function setup() {
    const endpointRepository = new MemoryEndpointRepository();
    const endpointGateway = new FakeEndpointGateway();
    const bus = new RecordingBus();
    const handlers = endpointHandlers({
        endpointGateway,
        endpointView: new EndpointView({ endpointRepository, logger: new RecordingLogger(), endpointGateway }),
        endpointUseCase: new EndpointUseCase({ endpointRepository, roomRepository: new MemoryRoomRepository(), bus }),
    });
    return { endpointGateway, bus, handlers };
}

describe("endpointHandlers", () => {
    test("every handler throws a ValidationError, before touching the gateway or the repositories, when the params are invalid", async () => {
        const { endpointGateway, bus, handlers } = setup();
        const id = createEndpointId();

        const invalid: [keyof typeof handlers, unknown][] = [
            ["endpoint.list", { id }],
            ["endpoint.get", {}],
            ["endpoint.read", { id, clusterId: -1, attributeId: 0 }],
            ["endpoint.write", { id, clusterId: 6, attributeId: 0 }],
            ["endpoint.invoke", { id, clusterId: 6, commandId: 0, args: { $bytes: "00" } }],
            ["endpoint.setName", { id, name: "" }],
            ["endpoint.setRoom", { id }],
        ];
        await Promise.all(
            invalid.map(([method, params]) =>
                assert.rejects(async () => handlers[method](params), ValidationError, method),
            ),
        );
        assert.deepEqual(endpointGateway.reads, []);
        assert.deepEqual(endpointGateway.writes, []);
        assert.deepEqual(endpointGateway.invocations, []);
        assert.deepEqual(bus.emitted, []);
    });
});
