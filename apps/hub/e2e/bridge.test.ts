import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { scratchDirectory } from "./helpers/cleanup.ts";
import { connect, isRecord } from "./helpers/client.ts";
import { startBridge } from "./helpers/device.ts";
import { startHub } from "./helpers/hub.ts";

// Matter ids: the Aggregator and On/Off Light device types, the OnOff cluster with its OnOff attribute, and the
// Bridged Device Basic Information cluster with its Unique ID attribute.
const AGGREGATOR = 0x000e;
const ON_OFF_LIGHT = 0x0100;
const ON_OFF_CLUSTER = 0x0006;
const ON_OFF_ATTRIBUTE = 0x0000;
const BRIDGED_INFORMATION_CLUSTER = 0x0039;
const UNIQUE_ID_ATTRIBUTE = 0x0012;

const records = (list: unknown): Record<string, unknown>[] => {
    assert.ok(Array.isArray(list));
    return list.filter(isRecord);
};

const hasId = (endpoints: unknown, id: unknown): boolean => records(endpoints).some((endpoint) => endpoint.id === id);

/** Whether the state of the endpoint is that of the bridged light with `uniqueId`. */
const isLight = (endpoint: unknown, uniqueId: string): boolean =>
    isRecord(endpoint) &&
    records(endpoint.clusters)
        .filter(({ id }) => id === BRIDGED_INFORMATION_CLUSTER)
        .flatMap(({ attributes }) => records(attributes))
        .some(({ id, value }) => id === UNIQUE_ID_ATTRIBUTE && value === uniqueId);

describe("bridge", () => {
    test("announces a light that the bridge gains while running, its changes, and its removal", async (t) => {
        const bridge = await startBridge(t);
        const hub = await startHub(t);
        const client = await connect(t, hub.url);
        await client.call("hub.subscribe");
        const nodeId = await client.call("node.commission", { setupCode: bridge.manualPairingCode });
        const { params: commissioned } = await client.notification("node:added");
        assert.ok(isRecord(commissioned));
        const aggregator = records(commissioned.endpoints).find(({ deviceType }) => deviceType === AGGREGATOR);
        assert.ok(aggregator !== undefined);

        const light = await bridge.addLight("desk");

        const { params: added } = await client.notification("endpoint:added");
        assert.partialDeepStrictEqual(added, {
            endpoint: { nodeId, deviceType: ON_OFF_LIGHT, roomId: null, parentId: aggregator.id },
        });
        assert.ok(isRecord(added) && isRecord(added.endpoint));
        const { id } = added.endpoint;
        assert.equal(hasId(await client.call("endpoint.list"), id), true);

        await light.setOn(true);

        await client.notification(
            "endpoint:changed",
            (params) =>
                isRecord(params) &&
                params.endpointId === id &&
                params.clusterId === ON_OFF_CLUSTER &&
                params.attributeId === ON_OFF_ATTRIBUTE &&
                params.value === true,
        );

        await light.remove();

        await client.notification("endpoint:removed", (params) => isRecord(params) && params.endpointId === id);
        assert.equal(hasId(await client.call("endpoint.list"), id), false);
    });

    test("catches up with the lights that the bridge lost and gained while the hub was stopped", async (t) => {
        const root = await scratchDirectory(t, "nedalto-e2e-hub-");
        const bridge = await startBridge(t);
        const lost = await bridge.addLight("porch");
        const first = await startHub(t, { root });
        const before = await connect(t, first.url);
        await before.call("node.commission", { setupCode: bridge.manualPairingCode });
        const lostId = records(await before.call("endpoint.list")).find((endpoint) =>
            isLight(endpoint, lost.uniqueId),
        )?.id;
        assert.ok(lostId !== undefined);
        await first.stop();

        await lost.remove();
        const gained = await bridge.addLight("desk");

        const second = await startHub(t, { root });
        const after = await connect(t, second.url);
        const snapshot = await after.call("hub.subscribe");
        assert.ok(isRecord(snapshot));

        // The device reports both when the node connects again, which can come before or after the subscription: see
        // `docs/decisions/0008-endpoints-that-change-on-the-device.md`. What the snapshot lacks arrives after it.
        if (hasId(snapshot.endpoints, lostId)) {
            await after.notification("endpoint:removed", (params) => isRecord(params) && params.endpointId === lostId);
        }
        if (!records(snapshot.endpoints).some((endpoint) => isLight(endpoint, gained.uniqueId))) {
            await after.notification(
                "endpoint:added",
                (params) => isRecord(params) && isLight(params.endpoint, gained.uniqueId),
            );
        }

        const endpoints = await after.call("endpoint.list");
        assert.equal(hasId(endpoints, lostId), false);
        assert.equal(records(endpoints).filter((endpoint) => isLight(endpoint, gained.uniqueId)).length, 1);
    });
});
