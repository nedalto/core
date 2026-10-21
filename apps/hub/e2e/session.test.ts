import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { connect } from "./helpers/client.ts";
import { startHub } from "./helpers/hub.ts";

describe("client session", () => {
    test("answers hub.subscribe with an empty snapshot on a new hub", async (t) => {
        const hub = await startHub(t);
        const client = await connect(t, hub.url);

        const snapshot = await client.call("hub.subscribe");

        assert.deepEqual(snapshot, { nodes: [], endpoints: [], rooms: [] });
    });

    test("lists a room after adding it", async (t) => {
        const hub = await startHub(t);
        const client = await connect(t, hub.url);

        const id = await client.call("room.add", { name: "Kitchen" });
        const rooms = await client.call("room.list");

        assert.deepEqual(rooms, [{ id, name: "Kitchen" }]);
    });
});
