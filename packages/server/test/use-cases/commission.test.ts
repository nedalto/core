import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { IntegrationError } from "@nedalto/contract/common/errors.ts";
import { CommissioningFailedError } from "@nedalto/contract/node/errors.ts";

import { CommissionUseCase } from "../../src/use-cases/commission.ts";
import { RecordingBus } from "../helpers/bus.ts";
import { createLight, createNode, LIGHT_SHAPE, stateOf } from "../helpers/fixtures.ts";
import { FakeEndpointGateway, FakeNodeGateway } from "../helpers/gateway.ts";
import { RecordingLogger } from "../helpers/logger.ts";
import { MemoryEndpointRepository, MemoryNodeRepository } from "../helpers/repository.ts";
import { RecordingTransactor } from "../helpers/transactor.ts";

const NODE = createNode();
const FIRST = createLight(NODE.id, 1);
const SECOND = createLight(NODE.id, 2);

function setup() {
    const logger = new RecordingLogger();
    const bus = new RecordingBus();
    const nodeRepository = new MemoryNodeRepository();
    const endpointRepository = new MemoryEndpointRepository();
    const transactor = new RecordingTransactor();
    const nodeGateway = new FakeNodeGateway();
    nodeGateway.commissioned = { node: NODE, endpoints: [FIRST, SECOND] };
    const endpointGateway = new FakeEndpointGateway();
    endpointGateway.shapes.set(FIRST.id, LIGHT_SHAPE);
    endpointGateway.shapes.set(SECOND.id, LIGHT_SHAPE);
    const useCase = new CommissionUseCase({
        logger,
        bus,
        nodeRepository,
        endpointRepository,
        transactor,
        nodeGateway,
        endpointGateway,
    });
    return { logger, bus, nodeRepository, endpointRepository, transactor, nodeGateway, endpointGateway, useCase };
}

describe("CommissionUseCase", () => {
    test("commissions the setup code and returns the id of the node", async () => {
        const { nodeGateway, useCase } = setup();

        assert.equal(await useCase.execute("34970112332"), NODE.id);
        assert.deepEqual(nodeGateway.commissionCalls, ["34970112332"]);
    });

    test("stores the node and then its endpoints in one transaction", async () => {
        const { nodeRepository, endpointRepository, transactor, useCase } = setup();
        const saves: { saved: string; inTransaction: boolean }[] = [];
        nodeRepository.onSave = () => saves.push({ saved: "node", inTransaction: transactor.active });
        endpointRepository.onSave = () => saves.push({ saved: "endpoint", inTransaction: transactor.active });

        await useCase.execute("34970112332");

        assert.deepEqual(saves, [
            { saved: "node", inTransaction: true },
            { saved: "endpoint", inTransaction: true },
            { saved: "endpoint", inTransaction: true },
        ]);
        assert.equal(transactor.runs, 1);
        assert.deepEqual([...nodeRepository.records.values()], [NODE]);
        assert.deepEqual([...endpointRepository.records.values()], [FIRST, SECOND]);
    });

    test("emits node:added with the node and the state of every endpoint it stored", async (context) => {
        context.mock.timers.enable({ apis: ["Date"], now: 1_000 });
        const { bus, nodeGateway, useCase } = setup();
        nodeGateway.reachable.add(NODE.id);

        await useCase.execute("34970112332");

        assert.deepEqual(bus.emitted, [
            {
                name: "node:added",
                payload: {
                    node: { id: NODE.id, reachable: true },
                    endpoints: [stateOf(FIRST), stateOf(SECOND)],
                    timestamp: 1_000,
                },
            },
        ]);
    });

    test("emits node:added before any other task can run after the write", async () => {
        const { bus, nodeRepository, useCase } = setup();
        const order: string[] = [];
        nodeRepository.onSave = () => queueMicrotask(() => order.push("other task"));
        bus.on("node:added", () => order.push("node:added"));

        await useCase.execute("34970112332");

        assert.deepEqual(order, ["node:added", "other task"]);
    });

    test("composes node:added from the records it stored, without reading them back", async () => {
        const { nodeRepository, endpointRepository, useCase } = setup();
        // Any read would throw.
        for (const method of ["findById", "findAll"] as const) {
            nodeRepository.failures.arm(method, new Error("read back"));
            endpointRepository.failures.arm(method, new Error("read back"));
        }

        await assert.doesNotReject(useCase.execute("34970112332"));
    });

    test("leaves an endpoint the gateway cannot describe out of node:added, and warns", async (context) => {
        context.mock.timers.enable({ apis: ["Date"], now: 1_000 });
        const { bus, endpointGateway, logger, useCase } = setup();
        endpointGateway.shapes.delete(SECOND.id);

        await useCase.execute("34970112332");

        assert.deepEqual(bus.emitted, [
            {
                name: "node:added",
                payload: { node: { id: NODE.id, reachable: false }, endpoints: [stateOf(FIRST)], timestamp: 1_000 },
            },
        ]);
        assert.equal(logger.at("warn").length, 1);
    });

    test("throws what the gateway throws, and stores and emits nothing, when commissioning fails", async () => {
        const { bus, nodeGateway, nodeRepository, transactor, useCase } = setup();
        const failure = new CommissioningFailedError("not-found", new Error("no device"));
        nodeGateway.commissionFailure = failure;

        await assert.rejects(useCase.execute("34970112332"), failure);

        assert.equal(transactor.runs, 0);
        assert.equal(nodeRepository.records.size, 0);
        assert.deepEqual(bus.emitted, []);
    });

    test("tries to decommission the node, throws the error of the transaction and emits nothing when a write fails", async () => {
        const { bus, nodeGateway, endpointRepository, useCase } = setup();
        const failure = new IntegrationError("disk full");
        endpointRepository.failures.arm("save", failure);

        await assert.rejects(useCase.execute("34970112332"), failure);

        assert.deepEqual(nodeGateway.decommissionCalls, [{ nodeId: NODE.id, force: undefined }]);
        assert.deepEqual(bus.emitted, []);
    });

    test("throws the error of the transaction, and logs that the device stays in the fabric, when decommissioning also fails", async () => {
        const { bus, nodeGateway, nodeRepository, logger, useCase } = setup();
        const failure = new IntegrationError("disk full");
        nodeRepository.failures.arm("save", failure);
        nodeGateway.decommissionFailure = new IntegrationError("device does not answer");

        await assert.rejects(useCase.execute("34970112332"), failure);

        assert.equal(logger.at("error").length, 1);
        assert.ok(logger.at("error")[0]?.includes(NODE.id));
        assert.deepEqual(bus.emitted, []);
    });
});
