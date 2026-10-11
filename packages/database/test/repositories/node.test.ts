import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createEndpointId, createNodeId } from "@nedalto/contract/common/ids.ts";
import { NodeNotFoundError } from "@nedalto/contract/node/errors.ts";

import { openDatabase } from "../helpers/database.ts";

describe("SqliteNodeRepository", () => {
    test("returns a saved node with its matter id intact across the uint64 range", async (context) => {
        const { node } = await openDatabase(context);
        // Both ends of the uint64 range, of the signed int64 it is stored in and of the safe integers.
        const matterIds = [0n, 1n, 2n ** 53n, 2n ** 53n + 1n, 2n ** 63n - 1n, 2n ** 63n, 2n ** 64n - 1n];
        const records = matterIds.map((matterId) => ({ id: createNodeId(), matterId }));

        for (const record of records) {
            node.save(record);
        }

        for (const record of records) {
            assert.deepEqual(node.findById(record.id), record);
        }
    });

    test("returns null for an unknown id", async (context) => {
        const { node } = await openDatabase(context);

        assert.equal(node.findById(createNodeId()), null);
    });

    test("lists the nodes ordered by id with their matter ids intact", async (context) => {
        const { node } = await openDatabase(context);
        const [first, second] = [createNodeId(), createNodeId()].toSorted();
        assert.ok(first !== undefined && second !== undefined);
        const records = [
            { id: second, matterId: 2n ** 64n - 1n },
            { id: first, matterId: 2n ** 53n + 1n },
        ];
        for (const record of records) {
            node.save(record);
        }

        assert.deepEqual(node.findAll(), records.toReversed());
    });

    test("refuses a second node with the same matter id", async (context) => {
        const { node } = await openDatabase(context);
        node.save({ id: createNodeId(), matterId: 100n });

        assert.throws(() => node.save({ id: createNodeId(), matterId: 100n }));
    });

    test("delete removes the node", async (context) => {
        const { node } = await openDatabase(context);
        const id = createNodeId();
        node.save({ id, matterId: 1n });

        node.delete(id);

        assert.equal(node.findById(id), null);
    });

    test("delete throws NodeNotFoundError for an unknown id", async (context) => {
        const { node } = await openDatabase(context);
        const id = createNodeId();

        assert.throws(
            () => node.delete(id),
            (error) =>
                error instanceof NodeNotFoundError && error.code === "NOT_FOUND_ERROR" && error.data?.nodeId === id,
        );
    });

    test("delete removes the endpoints of the node and keeps those of other nodes", async (context) => {
        const { node, endpoint } = await openDatabase(context);
        const removed = createNodeId();
        const kept = createNodeId();
        node.save({ id: removed, matterId: 1n });
        node.save({ id: kept, matterId: 2n });
        endpoint.save({ id: createEndpointId(), nodeId: removed, matterNumber: 1, name: "Light", roomId: null });
        const keptEndpoint = { id: createEndpointId(), nodeId: kept, matterNumber: 1, name: "Lamp", roomId: null };
        endpoint.save(keptEndpoint);

        node.delete(removed);

        assert.deepEqual(endpoint.findAll(), [keptEndpoint]);
    });
});
