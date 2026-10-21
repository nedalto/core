import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { scratchDirectory } from "./helpers/cleanup.ts";
import { type Client, connect, isRecord } from "./helpers/client.ts";
import { startLight } from "./helpers/device.ts";
import { startHub } from "./helpers/hub.ts";

// Matter ids: the On/Off Light device type, the OnOff cluster with its OnOff attribute, and its On command.
const ON_OFF_LIGHT = 0x0100;
const ON_OFF_CLUSTER = 0x0006;
const ON_OFF_ATTRIBUTE = 0x0000;
const ON_COMMAND = 0x01;

/** The id of the one endpoint the light exposes. */
async function lightEndpointId(client: Client): Promise<unknown> {
    const endpoints = await client.call("endpoint.list");
    assert.ok(Array.isArray(endpoints));
    const [endpoint] = endpoints;
    assert.ok(isRecord(endpoint));
    return endpoint.id;
}

const ids = (list: unknown): unknown[] => {
    assert.ok(Array.isArray(list));
    return list.map((item) => (isRecord(item) ? item.id : undefined));
};

describe("commissioning", () => {
    test("commissions a device from its manual pairing code and announces the node with its endpoints", async (t) => {
        const light = await startLight(t);
        const hub = await startHub(t);
        const client = await connect(t, hub.url);
        await client.call("hub.subscribe");

        const nodeId = await client.call("node.commission", { setupCode: light.manualPairingCode });

        const added = await client.notification("node:added");
        assert.partialDeepStrictEqual(added.params, {
            node: { id: nodeId },
            endpoints: [{ nodeId, deviceType: ON_OFF_LIGHT }],
        });
    });

    test("commissions a device from its QR payload", async (t) => {
        const light = await startLight(t);
        const hub = await startHub(t);
        const client = await connect(t, hub.url);

        const nodeId = await client.call("node.commission", { setupCode: light.qrPairingCode });

        assert.partialDeepStrictEqual(await client.call("node.list"), [{ id: nodeId }]);
    });

    test("pushes endpoint:changed when the device changes its own state", async (t) => {
        const light = await startLight(t);
        const hub = await startHub(t);
        const client = await connect(t, hub.url);
        await client.call("hub.subscribe");
        await client.call("node.commission", { setupCode: light.manualPairingCode });

        await light.setOn(true);

        const changed = await client.notification(
            "endpoint:changed",
            (params) =>
                isRecord(params) &&
                params.clusterId === ON_OFF_CLUSTER &&
                params.attributeId === ON_OFF_ATTRIBUTE &&
                params.value === true,
        );
        assert.partialDeepStrictEqual(changed.params, { endpointId: await lightEndpointId(client) });
    });

    test("turns the light on when endpoint.invoke sends the On command, and the device confirms it", async (t) => {
        const light = await startLight(t);
        const hub = await startHub(t);
        const client = await connect(t, hub.url);
        await client.call("node.commission", { setupCode: light.manualPairingCode });
        const id = await lightEndpointId(client);
        assert.equal(light.isOn(), false);

        await client.call("endpoint.invoke", { id, clusterId: ON_OFF_CLUSTER, commandId: ON_COMMAND });

        assert.equal(light.isOn(), true);
    });

    test("keeps the node and its endpoints after the hub restarts", async (t) => {
        const root = await scratchDirectory(t, "nedalto-e2e-hub-");
        const light = await startLight(t);
        const first = await startHub(t, { root });
        const before = await connect(t, first.url);
        await before.call("node.commission", { setupCode: light.manualPairingCode });
        const nodes = await before.call("node.list");
        const endpoints = await before.call("endpoint.list");
        await first.stop();

        const second = await startHub(t, { root });
        const after = await connect(t, second.url);

        // Compared by id: whether the node is reachable again yet is up to the controller.
        assert.deepEqual(ids(await after.call("node.list")), ids(nodes));
        assert.deepEqual(ids(await after.call("endpoint.list")), ids(endpoints));
        assert.equal(ids(nodes).length, 1);
        assert.equal(ids(endpoints).length, 1);
    });
});
