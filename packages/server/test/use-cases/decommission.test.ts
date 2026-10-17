import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { IntegrationError } from "@nedalto/contract/common/errors.ts";
import { createNodeId } from "@nedalto/contract/common/ids.ts";
import { NodeNotFoundError, NodeUnreachableError } from "@nedalto/contract/node/errors.ts";

import { DecommissionUseCase } from "../../src/use-cases/decommission.ts";
import { RecordingBus } from "../helpers/bus.ts";
import { createNode } from "../helpers/fixtures.ts";
import { FakeNodeGateway } from "../helpers/gateway.ts";
import { RecordingLogger } from "../helpers/logger.ts";
import { MemoryNodeRepository } from "../helpers/repository.ts";

const NODE = createNode();

function setup() {
    const logger = new RecordingLogger();
    const bus = new RecordingBus();
    const nodeRepository = new MemoryNodeRepository();
    nodeRepository.save(NODE);
    const nodeGateway = new FakeNodeGateway();
    return {
        logger,
        bus,
        nodeRepository,
        nodeGateway,
        useCase: new DecommissionUseCase({ logger, bus, nodeRepository, nodeGateway }),
    };
}

describe("DecommissionUseCase", () => {
    test("decommissions the node, deletes it and emits node:removed", async (context) => {
        context.mock.timers.enable({ apis: ["Date"], now: 1_000 });
        const { bus, nodeRepository, nodeGateway, useCase } = setup();

        await useCase.execute(NODE.id);

        assert.deepEqual(nodeGateway.decommissionCalls, [{ nodeId: NODE.id, force: undefined }]);
        assert.equal(nodeRepository.records.size, 0);
        assert.deepEqual(bus.emitted, [{ name: "node:removed", payload: { nodeId: NODE.id, timestamp: 1_000 } }]);
    });

    test("passes force on to the gateway", async () => {
        const { nodeGateway, useCase } = setup();

        await useCase.execute(NODE.id, true);

        assert.deepEqual(nodeGateway.decommissionCalls, [{ nodeId: NODE.id, force: true }]);
    });

    test("throws NodeNotFoundError, without contacting the gateway or emitting, when the node is not stored", async () => {
        const { bus, nodeGateway, useCase } = setup();
        const missing = createNodeId();

        await assert.rejects(useCase.execute(missing), NodeNotFoundError);

        assert.deepEqual(nodeGateway.decommissionCalls, []);
        assert.deepEqual(bus.emitted, []);
    });

    test("deletes the node from the database only, and notices it, when the gateway does not know the node", async () => {
        const { bus, logger, nodeRepository, nodeGateway, useCase } = setup();
        nodeGateway.decommissionFailure = new NodeNotFoundError(NODE.id);

        await useCase.execute(NODE.id);

        assert.equal(nodeRepository.records.size, 0);
        assert.equal(logger.at("notice").length, 1);
        assert.equal(bus.emitted[0]?.name, "node:removed");
    });

    test("throws any other error of the gateway, and keeps the node and emits nothing", async () => {
        const { bus, nodeRepository, nodeGateway, useCase } = setup();
        const failure = new NodeUnreachableError(NODE.id, "offline", new Error("no answer"));
        nodeGateway.decommissionFailure = failure;

        await assert.rejects(useCase.execute(NODE.id), failure);

        assert.equal(nodeRepository.records.size, 1);
        assert.deepEqual(bus.emitted, []);
    });

    test("logs an error, throws it and emits nothing when the delete fails after the node left the fabric", async () => {
        const { bus, logger, nodeRepository, nodeGateway, useCase } = setup();
        const failure = new IntegrationError("disk full");
        nodeRepository.failures.arm("delete", failure);

        await assert.rejects(useCase.execute(NODE.id), failure);

        assert.equal(nodeGateway.decommissionCalls.length, 1);
        assert.equal(logger.at("error").length, 1);
        assert.deepEqual(bus.emitted, []);
    });

    test("throws NodeNotFoundError without logging an error when the node was deleted alongside", async () => {
        const { bus, logger, nodeRepository, useCase } = setup();
        nodeRepository.failures.arm("delete", new NodeNotFoundError(NODE.id));

        await assert.rejects(useCase.execute(NODE.id), NodeNotFoundError);

        assert.deepEqual(logger.at("error"), []);
        assert.deepEqual(bus.emitted, []);
    });
});
