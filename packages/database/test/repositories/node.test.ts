import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { toNodeId } from "@nedalto/contract/common/ids.ts";
import { NodeNotFoundError } from "@nedalto/contract/node/errors.ts";

import { openDatabase } from "../helpers/database.ts";

describe("SqliteNodeRepository", () => {
    test("returns a created node with its id intact across the uint64 range", async (context) => {
        const { node } = await openDatabase(context);
        // Both ends of the uint64 range, of the signed int64 it is stored in and of the safe integers.
        const ids = [0n, 1n, 2n ** 53n, 2n ** 53n + 1n, 2n ** 63n - 1n, 2n ** 63n, 2n ** 64n - 1n].map(toNodeId);

        const created = ids.map((id) => node.create(id));

        assert.deepEqual(
            created,
            ids.map((id) => ({ id })),
        );
        for (const record of created) {
            assert.deepEqual(node.findById(record.id), record);
        }
    });

    test("keeps writing after creating a node id beyond the safe integers", async (context) => {
        const { node } = await openDatabase(context);
        const { id } = node.create(toNodeId(2n ** 53n + 1n));

        // The node id is the rowid of the last insert, which every later write reports.
        node.delete(id);

        assert.equal(node.findById(id), null);
    });

    test("returns null for an unknown id", async (context) => {
        const { node } = await openDatabase(context);

        assert.equal(node.findById(toNodeId(1n)), null);
    });

    test("lists the nodes ordered by id across the uint64 range", async (context) => {
        const { node } = await openDatabase(context);
        // Stored as int64, the last two come first unless the query puts them last.
        const ids = [1n, 2n ** 63n, 2n ** 64n - 1n].map(toNodeId);
        const created = ids
            .toReversed()
            .map((id) => node.create(id))
            .toReversed();

        assert.deepEqual(node.findAll(), created);
    });

    test("refuses a second node with the same id", async (context) => {
        const { node } = await openDatabase(context);
        node.create(toNodeId(1n));

        assert.throws(() => node.create(toNodeId(1n)));
    });

    test("delete removes the node", async (context) => {
        const { node } = await openDatabase(context);
        const { id } = node.create(toNodeId(1n));

        node.delete(id);

        assert.equal(node.findById(id), null);
    });

    test("delete throws NodeNotFoundError for an unknown id", async (context) => {
        const { node } = await openDatabase(context);
        const id = toNodeId(1n);

        assert.throws(
            () => node.delete(id),
            (error) =>
                error instanceof NodeNotFoundError && error.code === "NOT_FOUND_ERROR" && error.data.nodeId === id,
        );
    });

    test("delete removes the endpoints of the node and keeps those of other nodes", async (context) => {
        const { node, endpoint } = await openDatabase(context);
        const removed = node.create(toNodeId(1n));
        const kept = node.create(toNodeId(2n));
        endpoint.create({ nodeId: removed.id, number: 1, name: "Light" });
        const keptEndpoint = endpoint.create({ nodeId: kept.id, number: 1, name: "Lamp" });

        node.delete(removed.id);

        assert.deepEqual(endpoint.findAll(), [keptEndpoint]);
    });
});
