import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createNodeId } from "@nedalto/contract/common/ids.ts";
import { NodeNotFoundError } from "@nedalto/contract/node/errors.ts";

import { NodeView } from "../../src/views/node.ts";
import { FakeNodeGateway } from "../helpers/gateway.ts";
import { MemoryNodeRepository } from "../helpers/repository.ts";

const ONLINE = { id: createNodeId(), matterId: 1n };
const OFFLINE = { id: createNodeId(), matterId: 2n };

function setup() {
    const nodeRepository = new MemoryNodeRepository();
    nodeRepository.save(ONLINE);
    nodeRepository.save(OFFLINE);
    const nodeGateway = new FakeNodeGateway();
    nodeGateway.reachable.add(ONLINE.id);
    return { nodeRepository, nodeGateway, view: new NodeView({ nodeRepository, nodeGateway }) };
}

describe("NodeView", () => {
    test("lists the stored nodes, each reachable as the gateway says", () => {
        assert.deepEqual(setup().view.list(), [
            { id: ONLINE.id, reachable: true },
            { id: OFFLINE.id, reachable: false },
        ]);
    });

    test("returns the node with the id, reachable as the gateway says", () => {
        const { view } = setup();

        assert.deepEqual(view.get(ONLINE.id), { id: ONLINE.id, reachable: true });
        assert.deepEqual(view.get(OFFLINE.id), { id: OFFLINE.id, reachable: false });
    });

    test("throws NodeNotFoundError, naming the node, when the node is not stored", () => {
        const missing = createNodeId();

        assert.throws(
            () => setup().view.get(missing),
            (error) => {
                assert.ok(error instanceof NodeNotFoundError);
                assert.equal(error.code, "NOT_FOUND_ERROR");
                assert.deepEqual(error.data, { nodeId: missing });
                return true;
            },
        );
    });
});
