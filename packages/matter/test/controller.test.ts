import "../src/sdk-config.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { InternalError } from "@nedalto/contract/common/errors.ts";

import { TestNetwork, untilConnected } from "./helpers/network.ts";

describe("MatterController", () => {
    test("node is available between start() and stop()", async (t) => {
        const network = new TestNetwork(t);
        const { controller } = network.controller();

        assert.throws(() => controller.node, InternalError);
        await controller.start();
        assert.doesNotThrow(() => controller.node);
        await controller.stop();
        assert.throws(() => controller.node, InternalError);
    });

    test("stop() does nothing before start()", async (t) => {
        const network = new TestNetwork(t);
        const { controller } = network.controller();

        await assert.doesNotReject(controller.stop());
    });

    test("stop() reports nothing of the nodes it takes offline", async (t) => {
        const network = new TestNetwork(t);
        const bridge = await network.startBridge();
        const started = await network.startController();
        const { controller, bus } = started;
        const { nodeId } = await controller.node.commission(bridge.manualCode);
        await untilConnected(started, nodeId);
        const before = bus.emitted.length;

        await controller.stop();

        assert.deepEqual(bus.emitted.slice(before), []);
    });
});
