import "../src/sdk-config.ts";
import assert from "node:assert/strict";
import { describe, type TestContext, test } from "node:test";

import { createEndpointId, createNodeId } from "@nedalto/contract/common/ids.ts";
import type { EndpointRecord } from "@nedalto/contract/endpoint/types.ts";

import { Identity } from "../src/identity.ts";
import { RecordingLogger } from "./helpers/logger.ts";
import { TestNetwork } from "./helpers/network.ts";
import { MemoryEndpointRepository, MemoryNodeRepository } from "./helpers/repository.ts";

/** An `Identity`, the SDK node of a light and a record for it. */
async function setup(t: TestContext) {
    const network = new TestNetwork(t);
    const { manualCode } = await network.startDevice();
    const node = await network.peer(manualCode);
    const endpoint = [...node.endpoints].find(({ number }) => number !== 0);
    assert.ok(endpoint !== undefined);
    const record: EndpointRecord = {
        id: createEndpointId(),
        nodeId: createNodeId(),
        matterNumber: endpoint.number,
        name: "Light",
        roomId: null,
    };
    return { identity: new Identity(new RecordingLogger()), node, record };
}

describe("Identity", () => {
    test("resolves the node and the endpoints that were added", async (t) => {
        const { identity, node, record } = await setup(t);

        identity.add(record.nodeId, node, [record]);

        assert.equal(identity.node(record.nodeId), node);
        assert.deepEqual(identity.endpoint(record.id), { nodeId: record.nodeId, node, number: record.matterNumber });
    });

    test("forgets the node and its endpoints when it is removed", async (t) => {
        const { identity, node, record } = await setup(t);
        identity.add(record.nodeId, node, [record]);

        identity.remove(record.nodeId);

        assert.equal(identity.node(record.nodeId), undefined);
        assert.equal(identity.endpoint(record.id), undefined);
    });

    test("resolves an endpoint added to a registered node, and an endpoint id from its node and number", async (t) => {
        const { identity, node, record } = await setup(t);
        identity.add(record.nodeId, node, []);

        identity.update(record.nodeId, [record], []);

        assert.deepEqual(identity.endpoint(record.id), { nodeId: record.nodeId, node, number: record.matterNumber });
        assert.equal(identity.endpointIdOf(record.nodeId, record.matterNumber), record.id);
        assert.deepEqual([...(identity.tracked(record.nodeId)?.endpoints ?? [])], [[record.id, record.matterNumber]]);
    });

    test("forgets an endpoint removed from a registered node, and keeps the node", async (t) => {
        const { identity, node, record } = await setup(t);
        identity.add(record.nodeId, node, [record]);

        identity.update(record.nodeId, [], [record.id]);

        assert.equal(identity.endpoint(record.id), undefined);
        assert.equal(identity.endpointIdOf(record.nodeId, record.matterNumber), undefined);
        assert.equal(identity.node(record.nodeId), node);
    });

    test("finds the id of a node from its SDK node", async (t) => {
        const { identity, node, record } = await setup(t);
        assert.equal(identity.nodeIdOf(node), undefined);

        identity.add(record.nodeId, node, [record]);

        assert.equal(identity.nodeIdOf(node), record.nodeId);
    });

    test("hydrate registers every endpoint of the repository, also one the peer lacks, and warns about nothing", async (t) => {
        const { node, record } = await setup(t);
        const logger = new RecordingLogger();
        const identity = new Identity(logger);
        const nodeRepository = new MemoryNodeRepository();
        const endpointRepository = new MemoryEndpointRepository();
        const address = node.state.commissioning.peerAddress;
        assert.ok(address !== undefined);
        nodeRepository.save({ id: record.nodeId, matterId: address.nodeId });
        endpointRepository.save(record);
        const ghost = { ...record, id: createEndpointId(), matterNumber: 99 };
        endpointRepository.save(ghost);
        identity.hydrate([node], nodeRepository, endpointRepository);

        assert.deepEqual(identity.endpoint(ghost.id), { nodeId: record.nodeId, node, number: 99 });
        assert.deepEqual(logger.warnings, []);
    });

    test("hydrate warns about a node of the repository without a peer, and does not register it", async (t) => {
        const { node, record } = await setup(t);
        const logger = new RecordingLogger();
        const identity = new Identity(logger);
        const nodeRepository = new MemoryNodeRepository();
        const address = node.state.commissioning.peerAddress;
        assert.ok(address !== undefined);
        nodeRepository.save({ id: record.nodeId, matterId: address.nodeId + 1n });

        identity.hydrate([node], nodeRepository, new MemoryEndpointRepository());

        assert.deepEqual(logger.warnings, [["persisted node has no Matter peer", record.nodeId]]);
        assert.equal(identity.node(record.nodeId), undefined);
    });
});
