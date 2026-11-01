import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { IntegrationError } from "@nedalto/contract/common/errors.ts";

import { createDeviceSync } from "../src/device-sync.ts";
import { RecordingBus } from "./helpers/bus.ts";
import { createLight, createNode, LIGHT_SHAPE, stateOf } from "./helpers/fixtures.ts";
import { FakeEndpointGateway, FakeNodeGateway } from "./helpers/gateway.ts";
import { RecordingLogger } from "./helpers/logger.ts";
import { MemoryEndpointRepository, MemoryNodeRepository } from "./helpers/repository.ts";
import { RecordingTransactor } from "./helpers/transactor.ts";

const NODE = createNode();
const OTHER_NODE = createNode();
const KEPT = createLight(NODE.id, 1);
const GONE = createLight(NODE.id, 2);
const NEW = createLight(NODE.id, 3);
const NEW_SHAPE = { ...LIGHT_SHAPE, parentId: KEPT.id };

function setup() {
    const logger = new RecordingLogger();
    const bus = new RecordingBus();
    const nodeRepository = new MemoryNodeRepository();
    nodeRepository.save(NODE);
    const endpointRepository = new MemoryEndpointRepository();
    endpointRepository.save(KEPT);
    endpointRepository.save(GONE);
    const transactor = new RecordingTransactor();
    const nodeGateway = new FakeNodeGateway();
    const endpointGateway = new FakeEndpointGateway();
    endpointGateway.shapes.set(NEW.id, NEW_SHAPE);
    const sync = createDeviceSync({
        logger,
        bus,
        nodeRepository,
        endpointRepository,
        transactor,
        nodeGateway,
        endpointGateway,
    });
    return { logger, bus, nodeRepository, endpointRepository, transactor, nodeGateway, endpointGateway, sync };
}

describe("createDeviceSync", () => {
    test("start() reconciles every stored node before it resolves", async () => {
        const { nodeRepository, nodeGateway, sync } = setup();
        nodeRepository.save(OTHER_NODE);

        await sync.start();

        assert.deepEqual(nodeGateway.reconcileCalls, [NODE.id, OTHER_NODE.id]);
    });

    test("start() subscribes before it reconciles, so a change during the pass is not lost", async () => {
        const { nodeGateway, sync } = setup();
        nodeGateway.onReconcile = () => {
            nodeGateway.onReconcile = undefined;
            nodeGateway.announceStructureChange(NODE.id);
        };

        await sync.start();

        assert.deepEqual(nodeGateway.reconcileCalls, [NODE.id, NODE.id]);
    });

    test("start() stores and announces what changed while the hub was down", async (context) => {
        context.mock.timers.enable({ apis: ["Date"], now: 1_000 });
        const { bus, endpointRepository, nodeGateway, sync } = setup();
        nodeGateway.changes.set(NODE.id, { added: [NEW], removed: [GONE.id] });

        await sync.start();

        assert.deepEqual([...endpointRepository.records.keys()].toSorted(), [KEPT.id, NEW.id].toSorted());
        assert.deepEqual(bus.emitted, [
            { name: "endpoint:removed", payload: { endpointId: GONE.id, timestamp: 1_000 } },
            { name: "endpoint:added", payload: { endpoint: stateOf(NEW, NEW_SHAPE), timestamp: 1_000 } },
        ]);
    });

    test("start() skips a stored node that the gateway does not know", async () => {
        const { nodeRepository, nodeGateway, sync } = setup();
        nodeRepository.save(OTHER_NODE);
        nodeGateway.unknown.add(NODE.id);

        await sync.start();

        assert.deepEqual(nodeGateway.reconcileCalls, [NODE.id, OTHER_NODE.id]);
    });

    test("start() rejects and emits nothing when the changes cannot be stored", async () => {
        const { bus, endpointRepository, nodeGateway, sync } = setup();
        const failure = new IntegrationError("disk full");
        endpointRepository.failures.arm("save", failure);
        nodeGateway.changes.set(NODE.id, { added: [NEW], removed: [] });

        await assert.rejects(sync.start(), failure);

        assert.deepEqual(bus.emitted, []);
    });

    test("stores the changes of a notice in one transaction and announces them after the commit, removals first", async () => {
        const { bus, endpointRepository, transactor, nodeGateway, sync } = setup();
        await sync.start();
        const activeWhenEmitted: boolean[] = [];
        const record = () => activeWhenEmitted.push(transactor.active);
        bus.on("endpoint:added", record);
        bus.on("endpoint:removed", record);
        const activeWhenSaved: boolean[] = [];
        endpointRepository.onSave = () => activeWhenSaved.push(transactor.active);
        const runsBefore = transactor.runs;
        nodeGateway.changes.set(NODE.id, { added: [NEW], removed: [GONE.id] });

        nodeGateway.announceStructureChange(NODE.id);

        assert.equal(transactor.runs, runsBefore + 1);
        assert.deepEqual(activeWhenSaved, [true]);
        assert.deepEqual(activeWhenEmitted, [false, false]);
        assert.equal(endpointRepository.records.has(GONE.id), false);
        assert.deepEqual(endpointRepository.records.get(NEW.id), NEW);
        assert.deepEqual(
            bus.emitted.map(({ name }) => name),
            ["endpoint:removed", "endpoint:added"],
        );
    });

    test("endpoint:added carries the state the view composes, with the parent the gateway describes", async (context) => {
        context.mock.timers.enable({ apis: ["Date"], now: 1_000 });
        const { bus, nodeGateway, sync } = setup();
        await sync.start();
        nodeGateway.changes.set(NODE.id, { added: [NEW], removed: [] });

        nodeGateway.announceStructureChange(NODE.id);

        const [event] = bus.emitted;
        assert.equal(event?.name, "endpoint:added");
        assert.deepEqual(event?.payload, { endpoint: stateOf(NEW, NEW_SHAPE), timestamp: 1_000 });
    });

    test("writes nothing and emits nothing for a notice without changes", async () => {
        const { bus, transactor, nodeGateway, sync } = setup();
        await sync.start();
        const runsBefore = transactor.runs;

        nodeGateway.announceStructureChange(NODE.id);

        assert.equal(transactor.runs, runsBefore);
        assert.deepEqual(bus.emitted, []);
    });

    test("logs an error and emits nothing when the changes of a notice cannot be stored", async () => {
        const { bus, logger, endpointRepository, nodeGateway, sync } = setup();
        await sync.start();
        endpointRepository.failures.arm("delete", new IntegrationError("disk full"));
        nodeGateway.changes.set(NODE.id, { added: [NEW], removed: [GONE.id] });

        nodeGateway.announceStructureChange(NODE.id);

        assert.equal(logger.at("error").length, 1);
        assert.ok(logger.at("error")[0]?.includes(NODE.id));
        assert.deepEqual(bus.emitted, []);
    });

    test("deletes a node that the SDK deleted and emits node:removed", async (context) => {
        context.mock.timers.enable({ apis: ["Date"], now: 1_000 });
        const { bus, nodeRepository, nodeGateway, sync } = setup();
        await sync.start();

        nodeGateway.announceDeletion(NODE.id);

        assert.equal(nodeRepository.records.has(NODE.id), false);
        assert.deepEqual(bus.emitted, [{ name: "node:removed", payload: { nodeId: NODE.id, timestamp: 1_000 } }]);
    });

    test("logs an error and emits nothing when a node that the SDK deleted cannot be deleted", async () => {
        const { bus, logger, nodeRepository, nodeGateway, sync } = setup();
        await sync.start();
        nodeRepository.failures.arm("delete", new IntegrationError("disk full"));

        nodeGateway.announceDeletion(NODE.id);

        assert.equal(logger.at("error").length, 1);
        assert.ok(nodeRepository.records.has(NODE.id));
        assert.deepEqual(bus.emitted, []);
    });

    test("stop() removes the subscriptions", async () => {
        const { bus, nodeRepository, nodeGateway, sync } = setup();
        await sync.start();
        const callsBefore = nodeGateway.reconcileCalls.length;

        await sync.stop();
        nodeGateway.announceStructureChange(NODE.id);
        nodeGateway.announceDeletion(NODE.id);

        assert.equal(nodeGateway.reconcileCalls.length, callsBefore);
        assert.ok(nodeRepository.records.has(NODE.id));
        assert.deepEqual(bus.emitted, []);
    });

    test("stop() before start() does nothing", async () => {
        const { sync } = setup();

        await assert.doesNotReject(sync.stop());
    });
});
