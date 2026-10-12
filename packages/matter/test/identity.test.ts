import "../src/sdk-config.ts";
import assert from "node:assert/strict";
import { describe, type TestContext, test } from "node:test";

import { createEndpointId, createNodeId } from "@nedalto/contract/common/ids.ts";
import type { EndpointRecord } from "@nedalto/contract/endpoint/types.ts";

import { Identity } from "../src/identity.ts";
import { RecordingLogger } from "./helpers/logger.ts";
import { TestNetwork } from "./helpers/network.ts";

/** An `Identity`, the SDK node of a light, a record for it and an observable of the light that nothing else observes. */
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
    const changed = endpoint.eventsOf("onOff")["onOff$Changed"];
    assert.ok(changed !== undefined);
    return { identity: new Identity(new RecordingLogger()), node, record, changed };
}

describe("Identity", () => {
    test("resolves the node and the endpoints that were added", async (t) => {
        const { identity, node, record } = await setup(t);

        identity.add(record.nodeId, node, [record]);

        assert.equal(identity.node(record.nodeId), node);
        assert.deepEqual(identity.endpoint(record.id), { node, number: record.matterNumber });
    });

    test("forgets the node and its endpoints when it is removed", async (t) => {
        const { identity, node, record } = await setup(t);
        identity.add(record.nodeId, node, [record]);

        identity.remove(record.nodeId);

        assert.equal(identity.node(record.nodeId), undefined);
        assert.equal(identity.endpoint(record.id), undefined);
    });

    test("lets a subscription observe the nodes that are added after it", async (t) => {
        const { identity, node, record, changed } = await setup(t);
        identity.observe((observers) => {
            observers.on(changed, () => {});
        });
        assert.equal(changed.isObserved, false);

        identity.add(record.nodeId, node, [record]);

        assert.equal(changed.isObserved, true);
    });

    test("gives a subscription the endpoints that were added with the node", async (t) => {
        const { identity, node, record } = await setup(t);
        const seen: unknown[] = [];
        identity.observe((_observers, tracked) => {
            seen.push(tracked.nodeId, tracked.node, [...tracked.endpoints]);
        });

        identity.add(record.nodeId, node, [record]);

        assert.deepEqual(seen, [record.nodeId, node, [[record.id, record.matterNumber]]]);
    });

    test("closes the observers of a node when it is removed", async (t) => {
        const { identity, node, record, changed } = await setup(t);
        identity.observe((observers) => {
            observers.on(changed, () => {});
        });
        identity.add(record.nodeId, node, [record]);

        identity.remove(record.nodeId);

        assert.equal(changed.isObserved, false);
    });

    test("closes the observers of every node and stops observing when the subscription is closed", async (t) => {
        const { identity, node, record, changed } = await setup(t);
        let attached = 0;
        const unobserve = identity.observe((observers) => {
            attached++;
            observers.on(changed, () => {});
        });
        identity.add(record.nodeId, node, [record]);

        unobserve();
        identity.add(createNodeId(), node, []);

        assert.equal(changed.isObserved, false);
        assert.equal(attached, 1);
    });

    test("closes the observers of one subscription without touching those of another", async (t) => {
        const { identity, node, record, changed } = await setup(t);
        const first = identity.observe((observers) => {
            observers.on(changed, () => {});
        });
        identity.observe((observers) => {
            observers.on(changed, () => {});
        });
        identity.add(record.nodeId, node, [record]);

        first();

        assert.equal(changed.isObserved, true);
    });
});
