import "../src/sdk-config.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { InternalError } from "@nedalto/contract/common/errors.ts";
import { createNodeId } from "@nedalto/contract/common/ids.ts";
import { NodeNotFoundError } from "@nedalto/contract/node/errors.ts";

import { TestNetwork } from "./helpers/network.ts";

describe("SdkMatterController", () => {
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

    test("stop() does not announce the nodes going offline", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const { controller, bus } = await network.startController();
        await controller.node.commission(manualCode);

        await controller.stop();

        assert.deepEqual(bus.emitted, []);
    });

    test("start() makes a node of the repository available again on the same storage", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice({ nodeLabel: "Kitchen light" });
        const { node, restarted } = await network.commissionAndRestart(manualCode);

        await restarted.controller.start();

        const info = restarted.controller.node.getInfo(node.id);
        assert.equal(info.matterId, node.matterId);
        assert.equal(info.label, "Kitchen light");
    });

    test("start() warns about a node of the repository that the SDK has no peer for, and starts", async (t) => {
        const network = new TestNetwork(t);
        const { controller, nodeRepository, logger } = network.controller();
        const orphan = { id: createNodeId(), matterId: 1n };
        nodeRepository.save(orphan);

        await controller.start();

        assert.deepEqual(logger.warnings, [["persisted node has no Matter peer", orphan.id]]);
        assert.throws(() => controller.node.getInfo(orphan.id), NodeNotFoundError);
    });
});
