import "../src/sdk-config.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { InternalError } from "@nedalto/contract/common/errors.ts";
import { createEndpointId, createNodeId } from "@nedalto/contract/common/ids.ts";
import { EndpointNotFoundError } from "@nedalto/contract/endpoint/errors.ts";
import { NodeNotFoundError } from "@nedalto/contract/node/errors.ts";

import { TestNetwork } from "./helpers/network.ts";

const ON_OFF = 0x06;
const ON_OFF_ATTRIBUTE = 0x0000;
const ON_COMMAND = 0x01;

describe("SdkMatterController", () => {
    test("node and endpoint are available between start() and stop()", async (t) => {
        const network = new TestNetwork(t);
        const { controller } = network.controller();

        assert.throws(() => controller.node, InternalError);
        assert.throws(() => controller.endpoint, InternalError);
        await controller.start();
        assert.doesNotThrow(() => controller.node);
        assert.doesNotThrow(() => controller.endpoint);
        await controller.stop();
        assert.throws(() => controller.node, InternalError);
        assert.throws(() => controller.endpoint, InternalError);
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

    test("start() makes the endpoints of the repository available again on the same storage", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const { endpoints, restarted } = await network.commissionAndRestart(manualCode);
        const [light] = endpoints;
        assert.ok(light !== undefined);

        await restarted.controller.start();

        assert.equal(await restarted.controller.endpoint.read(light.id, ON_OFF, ON_OFF_ATTRIBUTE), false);
    });

    test("start() announces the changes of the endpoints of the repository", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const { endpoints, restarted } = await network.commissionAndRestart(manualCode);
        const [light] = endpoints;
        assert.ok(light !== undefined);
        await restarted.controller.start();
        const changed = restarted.bus.next("endpoint:changed", ({ attributeId }) => attributeId === ON_OFF_ATTRIBUTE);

        await restarted.controller.endpoint.invoke(light.id, ON_OFF, ON_COMMAND);

        assert.deepEqual((await changed).endpointId, light.id);
        // @matter/protocol 0.17.9: a restarted controller that has its subscription up when the device closes
        // leaves a timer of about 100 seconds, which keeps the process alive; stopped first, it leaves none.
        await restarted.controller.stop();
    });

    test("start() warns about an endpoint of the repository that the node lacks, and does not register it", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const { node, endpoints, restarted } = await network.commissionAndRestart(manualCode);
        const [light] = endpoints;
        assert.ok(light !== undefined);
        const ghost = { id: createEndpointId(), nodeId: node.id, matterNumber: 99, name: "Ghost", roomId: null };
        restarted.endpointRepository.save(ghost);

        await restarted.controller.start();

        assert.deepEqual(restarted.logger.warnings, [["persisted endpoint has no Matter endpoint", ghost.id]]);
        await assert.rejects(
            restarted.controller.endpoint.read(ghost.id, ON_OFF, ON_OFF_ATTRIBUTE),
            EndpointNotFoundError,
        );
        assert.equal(await restarted.controller.endpoint.read(light.id, ON_OFF, ON_OFF_ATTRIBUTE), false);
    });
});
