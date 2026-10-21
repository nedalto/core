import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { connect, isRecord } from "./helpers/client.ts";
import { startLight } from "./helpers/device.ts";
import { startHub } from "./helpers/hub.ts";

describe("decommissioning", () => {
    // @matter/main 0.17.9: a simulated device that loses its fabric leaves an mDNS resource open and the test
    // process does not end by itself, which is why the e2e script passes --test-force-exit. Fixed in 0.18,
    // which is not published yet: remove the flag when updating.
    test("removes the node and its endpoints, and the device can be commissioned again", async (t) => {
        const light = await startLight(t);
        const hub = await startHub(t);
        const client = await connect(t, hub.url);
        await client.call("hub.subscribe");
        const id = await client.call("node.commission", { setupCode: light.manualPairingCode });

        await client.call("node.decommission", { id });

        await client.notification("node:removed", (params) => isRecord(params) && params.nodeId === id);
        assert.deepEqual(await client.call("node.list"), []);
        assert.deepEqual(await client.call("endpoint.list"), []);
        // A device that kept the fabric would refuse, and the call would throw with the hub's error.
        await client.call("node.commission", { setupCode: light.manualPairingCode });
    });
});
