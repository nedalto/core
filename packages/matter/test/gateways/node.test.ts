import "../../src/sdk-config.ts";
import assert from "node:assert/strict";
import { describe, type TestContext, test } from "node:test";

import { ObserverGroup, VendorId } from "@matter/main";
import { EndpointLifecycle, NodeConnectionState } from "@matter/main/node";
import { CommissioningFlowType, QrPairingCodeCodec } from "@matter/main/types";

import { ValidationError } from "@nedalto/contract/common/errors.ts";
import { createEndpointId, createNodeId } from "@nedalto/contract/common/ids.ts";
import { EndpointNotFoundError } from "@nedalto/contract/endpoint/errors.ts";
import { DecommissioningRejectedError, NodeNotFoundError } from "@nedalto/contract/node/errors.ts";

import { MatterNodeGateway, toNodeConnection } from "../../src/gateways/node.ts";
import { Identity } from "../../src/identity.ts";
import { RecordingBus } from "../helpers/bus.ts";
import { RecordingLogger } from "../helpers/logger.ts";
import { nextChanges, TestNetwork, untilConnected } from "../helpers/network.ts";

const ON_OFF = 0x06;
const ON_OFF_ATTRIBUTE = 0x0000;

/** The name of each event with the node it names, once each. */
const eventsOf = (emitted: readonly { name: string; payload: unknown }[]): Set<string> =>
    new Set(
        emitted.map(({ name, payload }) => {
            assert.ok(typeof payload === "object" && payload !== null && "nodeId" in payload);
            return `${name} ${String(payload.nodeId)}`;
        }),
    );

const isInvalidSetupCode =
    (message: RegExp) =>
    (error: unknown): boolean => {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.code, "VALIDATION_ERROR");
        const { issues } = error.data;
        assert.equal(issues.length, 1);
        const [issue] = issues;
        assert.ok(issue !== undefined);
        assert.equal(issue.path, "setupCode");
        assert.match(issue.message, message);
        return true;
    };

// A gateway over a commissioned peer that is not registered yet.
async function gatewayOverPeer(t: TestContext) {
    const network = new TestNetwork(t);
    const { manualCode, device } = await network.startDevice();
    const peer = await network.peer(manualCode);
    const logger = new RecordingLogger();
    const bus = new RecordingBus();
    const identity = new Identity(logger);
    const gateway = new MatterNodeGateway(logger, bus, identity, peer.owner);
    t.after(() => gateway.close());
    // A device closed before the subscription is live leaves the peer retrying, which holds up the end of the test.
    if (peer.lifecycle.connectionState !== NodeConnectionState.Connected) {
        await new Promise<void>((resolve) => {
            const connected = (state: NodeConnectionState): void => {
                if (state === NodeConnectionState.Connected) {
                    peer.lifecycle.connectionStateChanged.off(connected);
                    resolve();
                }
            };
            peer.lifecycle.connectionStateChanged.on(connected);
        });
    }
    // Observed after the gateway, so that when it resolves the gateway has already had its turn.
    const nextChange = (): Promise<void> =>
        new Promise((resolve) => {
            peer.lifecycle.connectionStateChanged.once(() => resolve());
        });
    return { device, peer, bus, identity, gateway, nextChange };
}

describe("toNodeConnection", () => {
    const cases = [
        { state: NodeConnectionState.Connected, connection: "connected" },
        { state: NodeConnectionState.Reconnecting, connection: "reconnecting" },
        { state: NodeConnectionState.WaitingForDeviceDiscovery, connection: "waiting-for-discovery" },
        { state: NodeConnectionState.Disconnected, connection: "disconnected" },
    ];
    for (const { state, connection } of cases) {
        test(`translates ${NodeConnectionState[state]} to ${connection}`, () => {
            assert.equal(toNodeConnection(state), connection);
        });
    }
});

describe("MatterNodeGateway", () => {
    test("commission joins the device of a manual pairing code and returns its node and endpoint", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const { controller } = await network.startController();

        const result = await controller.node.commission(manualCode);

        assert.equal(typeof result.node.matterId, "bigint");
        assert.equal(result.endpoints.length, 1);
        const [endpoint] = result.endpoints;
        assert.equal(endpoint?.nodeId, result.node.id);
        assert.equal(endpoint?.name, "Test Light");
        assert.equal(endpoint?.roomId, null);
        // Endpoint 0 holds the administration of the node, so the light is never it.
        assert.notEqual(endpoint?.matterNumber, 0);
    });

    test("commission joins the device of a QR payload", async (t) => {
        const network = new TestNetwork(t);
        const { qrCode } = await network.startDevice();
        const { controller } = await network.startController();

        const result = await controller.node.commission(qrCode);

        assert.equal(result.endpoints.length, 1);
    });

    const nameCases = [
        { title: "the label", device: { nodeLabel: "Kitchen light" }, expected: "Kitchen light" },
        { title: "the product name when the label is blank", device: { nodeLabel: "   " }, expected: "Test Light" },
        {
            title: "a fallback when the product name is blank too",
            device: { nodeLabel: "", productName: "   " },
            expected: "Matter Device",
        },
    ];
    for (const { title, device, expected } of nameCases) {
        test(`commission names the endpoints after ${title}`, async (t) => {
            const network = new TestNetwork(t);
            const { manualCode } = await network.startDevice(device);
            const { controller } = await network.startController();

            const result = await controller.node.commission(manualCode);

            assert.deepEqual(
                result.endpoints.map(({ name }) => name),
                [expected],
            );
        });
    }

    test("commission throws ValidationError for a manual pairing code with a wrong check digit", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const { controller } = await network.startController();
        const lastDigit = Number(manualCode.at(-1));
        const mistyped = `${manualCode.slice(0, -1)}${(lastDigit + 1) % 10}`;

        await assert.rejects(controller.node.commission(mistyped), isInvalidSetupCode(/manual pairing code/));
    });

    test("commission throws ValidationError for a QR payload that names several devices", async (t) => {
        const network = new TestNetwork(t);
        const { controller } = await network.startController();
        const device = {
            version: 0,
            vendorId: VendorId(0xfff1),
            flowType: CommissioningFlowType.Standard,
            discoveryCapabilities: 4,
        };
        const qrCode = QrPairingCodeCodec.encode([
            { ...device, productId: 0x8000, discriminator: 3841, passcode: 20202022 },
            { ...device, productId: 0x8001, discriminator: 3842, passcode: 20202023 },
        ]);

        await assert.rejects(controller.node.commission(qrCode), isInvalidSetupCode(/names 2 devices/));
    });

    test("commission throws ValidationError for a QR payload that cannot be read", async (t) => {
        const network = new TestNetwork(t);
        const { controller } = await network.startController();

        await assert.rejects(controller.node.commission("MT:NOTAVALIDPAYLOAD"), isInvalidSetupCode(/QR payload/));
    });

    test("decommission forgets the node and removes the fabric from the device", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode, device } = await network.startDevice();
        const { controller } = await network.startController();
        const { node } = await controller.node.commission(manualCode);

        await controller.node.decommission(node.id);

        assert.throws(() => controller.node.getInfo(node.id), NodeNotFoundError);
        assert.equal(device.lifecycle.isCommissioned, false);
    });

    test("decommission forgets the node and leaves the fabric on the device when forced", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode, device } = await network.startDevice();
        const { controller } = await network.startController();
        const { node } = await controller.node.commission(manualCode);

        await controller.node.decommission(node.id, true);

        assert.throws(() => controller.node.getInfo(node.id), NodeNotFoundError);
        assert.equal(device.lifecycle.isCommissioned, true);
    });

    test("decommission throws NodeNotFoundError for an unknown node", async (t) => {
        const network = new TestNetwork(t);
        const { controller } = await network.startController();

        await assert.rejects(controller.node.decommission(createNodeId()), NodeNotFoundError);
    });

    test("decommission rejects a second call for a node that is being decommissioned, and announces only the changes of connection of the node", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode, device } = await network.startDevice();
        const started = await network.startController();
        const { controller, bus } = started;
        const { node } = await controller.node.commission(manualCode);
        await untilConnected(started, node.id);
        const before = bus.emitted.length;

        const [first, second] = await Promise.allSettled([
            controller.node.decommission(node.id),
            controller.node.decommission(node.id),
        ]);

        assert.equal(first.status, "fulfilled");
        assert.equal(second.status, "rejected");
        const error = second.reason;
        assert.ok(error instanceof DecommissioningRejectedError);
        assert.equal(error.code, "CONFLICT_ERROR");
        assert.deepEqual(error.data, { nodeId: node.id, reason: "in-progress" });
        assert.equal(device.lifecycle.isCommissioned, false);
        assert.deepEqual(eventsOf(bus.emitted.slice(before)), new Set([`node:connection-changed ${node.id}`]));
    });

    test("decommission throws NodeNotFoundError and forgets the node when the SDK has already deleted it", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const peer = await network.peer(manualCode);
        const logger = new RecordingLogger();
        const identity = new Identity(logger);
        const gateway = new MatterNodeGateway(logger, new RecordingBus(), identity, peer.owner);
        const nodeId = createNodeId();
        identity.add(nodeId, peer, []);
        await peer.delete();

        await assert.rejects(gateway.decommission(nodeId), NodeNotFoundError);

        assert.equal(identity.node(nodeId), undefined);
        gateway.close();
    });

    for (const force of [false, true]) {
        test(`decommission announces the changes of connection of the node ${force ? "when forced" : "from the fabric"}`, async (t) => {
            const network = new TestNetwork(t);
            const { manualCode } = await network.startDevice();
            const started = await network.startController();
            const { controller, bus } = started;
            const { node } = await controller.node.commission(manualCode);
            await untilConnected(started, node.id);
            const before = bus.emitted.length;

            await controller.node.decommission(node.id, force);

            assert.deepEqual(eventsOf(bus.emitted.slice(before)), new Set([`node:connection-changed ${node.id}`]));
        });
    }

    test("getInfo returns what the device reports about itself", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice({ nodeLabel: "Kitchen light" });
        const { controller } = await network.startController();
        const before = Date.now();
        const { node } = await controller.node.commission(manualCode);
        const after = Date.now();

        const { commissionedAt, ...info } = controller.node.getInfo(node.id);

        assert.deepEqual(info, {
            id: node.id,
            matterId: node.matterId,
            label: "Kitchen light",
            vendorName: "Nedalto Test",
            productName: "Test Light",
            vendorId: 0xfff1,
            productId: 0x8000,
            hardwareVersion: 2,
            softwareVersion: 3,
            softwareVersionString: "3.0.0",
        });
        assert.ok(commissionedAt !== null && commissionedAt >= before && commissionedAt <= after);
    });

    test("getInfo throws NodeNotFoundError for an unknown node", async (t) => {
        const network = new TestNetwork(t);
        const { controller } = await network.startController();

        assert.throws(() => controller.node.getInfo(createNodeId()), NodeNotFoundError);
    });

    test("connectionOf is disconnected for an unknown node", async (t) => {
        const network = new TestNetwork(t);
        const { controller } = await network.startController();

        assert.equal(controller.node.connectionOf(createNodeId()), "disconnected");
    });

    test("announces the connection of a node of the storage up to connected when the controller restarts", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const { node, restarted } = await network.commissionAndRestart(manualCode);
        const changes: unknown[] = [];
        restarted.bus.on("node:connection-changed", ({ nodeId, connection }) => changes.push([nodeId, connection]));
        const connected = restarted.bus.next("node:connection-changed", ({ connection }) => connection === "connected");

        await restarted.controller.start();
        await connected;

        assert.deepEqual(changes, [
            [node.id, "reconnecting"],
            [node.id, "connected"],
        ]);
        assert.equal(restarted.controller.node.connectionOf(node.id), "connected");
    });

    test("announces the connection of a node commissioned after the gateway was built", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const { controller, bus } = await network.startController();
        const connected = bus.next("node:connection-changed", ({ connection }) => connection === "connected");

        const { node } = await controller.node.commission(manualCode);

        // @matter/node 0.18.0: `commission()` returns after the initial read, before the subscription is live.
        assert.equal(controller.node.connectionOf(node.id), "reconnecting");
        assert.equal((await connected).nodeId, node.id);
    });

    test("announces a value other than connected, the same that connectionOf gives, when the device stops", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode, device } = await network.startDevice();
        const started = await network.startController();
        const { controller, bus } = started;
        const { node } = await controller.node.commission(manualCode);
        await untilConnected(started, node.id);
        const stopped = bus.next("node:connection-changed", ({ connection }) => connection !== "connected");

        await device.close();

        const { nodeId, connection } = await stopped;
        assert.equal(nodeId, node.id);
        assert.equal(controller.node.connectionOf(node.id), connection);
    });

    test("announces nothing of a peer that is not registered", async (t) => {
        const { device, bus, nextChange } = await gatewayOverPeer(t);
        const changed = nextChange();

        await device.close();
        await changed;

        assert.deepEqual(bus.emitted, []);
    });

    test("announces nothing after close()", async (t) => {
        const { device, peer, bus, identity, gateway, nextChange } = await gatewayOverPeer(t);
        identity.add(createNodeId(), peer, []);
        const changed = nextChange();

        gateway.close();
        await device.close();
        await changed;

        assert.deepEqual(bus.emitted, []);
    });

    test("stops observing a peer that the SDK deletes", async (t) => {
        const { peer, identity } = await gatewayOverPeer(t);
        identity.add(createNodeId(), peer, []);
        assert.equal(peer.lifecycle.connectionStateChanged.isObserved, true);

        await peer.delete();

        assert.equal(peer.lifecycle.connectionStateChanged.isObserved, false);
    });

    test("stops observing a peer that decommission deletes", async (t) => {
        const { peer, identity, gateway } = await gatewayOverPeer(t);
        const nodeId = createNodeId();
        identity.add(nodeId, peer, []);

        await gateway.decommission(nodeId, true);

        assert.equal(peer.lifecycle.connectionStateChanged.isObserved, false);
    });

    test("announces the node and reconcileEndpoints returns a light the bridge gains, registered and with its state", async (t) => {
        const network = new TestNetwork(t);
        const bridge = await network.startBridge();
        const { controller } = await network.startController();
        const { node, endpoints } = await controller.node.commission(bridge.manualCode);
        const notified: unknown[] = [];
        controller.node.onStructureChanged((nodeId) => notified.push(nodeId));
        const changed = nextChanges(controller.node, (changes) => ({
            changes,
            // Within the notice: a light that is on, so that the value cannot be the default of the SDK.
            shape: changes.added.map(({ id }) => controller.endpoint.describe(id)),
        }));

        const light = await bridge.addLight("light-3");
        const { changes, shape } = await changed;

        assert.deepEqual(changes.removed, []);
        const [record] = changes.added;
        assert.ok(record !== undefined);
        assert.deepEqual(
            { ...record, id: null },
            { id: null, nodeId: node.id, matterNumber: light.number, name: endpoints[0]?.name, roomId: null },
        );
        const onOff = shape[0]?.clusters.find(({ id }) => id === ON_OFF);
        assert.deepEqual(onOff?.attributes.find(({ id }) => id === ON_OFF_ATTRIBUTE)?.value, true);
        assert.ok(new Set(notified).has(node.id));
        assert.equal(await controller.endpoint.read(record.id, ON_OFF, ON_OFF_ATTRIBUTE), true);
        // Settled: asking again finds nothing new.
        assert.deepEqual(controller.node.reconcileEndpoints(node.id), { added: [], removed: [] });
    });

    test("reconcileEndpoints returns a light the bridge loses, which is then not found", async (t) => {
        const network = new TestNetwork(t);
        const bridge = await network.startBridge();
        const { controller } = await network.startController();
        const { node } = await controller.node.commission(bridge.manualCode);
        const added = nextChanges(controller.node, ({ added: [record] }) => record);
        const light = await bridge.addLight("light-3");
        const record = await added;
        assert.ok(record !== undefined);
        const removed = nextChanges(controller.node, (changes) => changes);

        await light.delete();

        assert.deepEqual(await removed, { added: [], removed: [record.id] });
        await assert.rejects(controller.endpoint.read(record.id, ON_OFF, ON_OFF_ATTRIBUTE), EndpointNotFoundError);
        assert.throws(() => controller.endpoint.describe(record.id), EndpointNotFoundError);
        assert.deepEqual(controller.node.reconcileEndpoints(node.id), { added: [], removed: [] });
    });

    test("reconcileEndpoints names the strip as the parent of outlets with lower numbers, in each notice", async (t) => {
        const network = new TestNetwork(t);
        const bridge = await network.startBridge();
        const { controller } = await network.startController();
        await controller.node.commission(bridge.manualCode);
        const seen = new Map<number, { id: unknown; parentId: unknown }>();
        const complete = new Promise<void>((resolve) => {
            controller.node.onStructureChanged((nodeId) => {
                for (const { id, matterNumber } of controller.node.reconcileEndpoints(nodeId).added) {
                    seen.set(matterNumber, { id, parentId: controller.endpoint.describe(id).parentId });
                }
                if (seen.size === 3) {
                    resolve();
                }
            });
        });

        await bridge.addStrip("strip", [60, 50, 51]);
        await complete;

        assert.equal(seen.get(50)?.parentId, seen.get(60)?.id);
        assert.equal(seen.get(51)?.parentId, seen.get(60)?.id);
    });

    test("reconcileEndpoints leaves out an endpoint that is installed and not ready yet", async (t) => {
        const network = new TestNetwork(t);
        const bridge = await network.startBridge();
        const peer = await network.peer(bridge.manualCode);
        const logger = new RecordingLogger();
        const identity = new Identity(logger);
        const gateway = new MatterNodeGateway(logger, new RecordingBus(), identity, peer.owner);
        const nodeId = createNodeId();
        identity.add(
            nodeId,
            peer,
            [...peer.endpoints]
                .filter(({ number }) => number !== 0)
                .map(({ number }) => ({
                    id: createEndpointId(),
                    nodeId,
                    matterNumber: number,
                    name: "",
                    roomId: null,
                })),
        );
        const whileInstalling: unknown[] = [];
        const observers = new ObserverGroup();
        observers.on(peer.lifecycle.changed, (change, endpoint) => {
            if (change === EndpointLifecycle.Change.Installed) {
                assert.equal(peer.endpoints.has(endpoint.number), true);
                whileInstalling.push(gateway.reconcileEndpoints(nodeId));
            }
        });
        const gained = nextChanges(gateway, ({ added }) => added.length);

        await bridge.addLight("light-3");

        assert.equal(await gained, 1);
        assert.deepEqual(whileInstalling, [{ added: [], removed: [] }]);
        observers.close();
        gateway.close();
    });

    test("announces no change of structure while the controller stops", async (t) => {
        const network = new TestNetwork(t);
        const bridge = await network.startBridge();
        const { controller } = await network.startController();
        await controller.node.commission(bridge.manualCode);
        const notified: unknown[] = [];
        controller.node.onStructureChanged((nodeId) => notified.push(nodeId));
        controller.node.onNodeDeleted((nodeId) => notified.push(nodeId));

        await controller.stop();

        assert.deepEqual(notified, []);
    });

    for (const force of [false, true]) {
        test(`decommission announces no change of structure and no deletion ${force ? "when forced" : "from the fabric"}`, async (t) => {
            const network = new TestNetwork(t);
            const bridge = await network.startBridge();
            const { controller } = await network.startController();
            const { node } = await controller.node.commission(bridge.manualCode);
            const notified: unknown[] = [];
            controller.node.onStructureChanged((nodeId) => notified.push(nodeId));
            controller.node.onNodeDeleted((nodeId) => notified.push(nodeId));

            await controller.node.decommission(node.id, force);

            assert.deepEqual(notified, []);
        });
    }

    test("announces a node that the SDK deletes and forgets it, with no change of structure", async (t) => {
        const network = new TestNetwork(t);
        const bridge = await network.startBridge();
        const peer = await network.peer(bridge.manualCode);
        const logger = new RecordingLogger();
        const identity = new Identity(logger);
        const gateway = new MatterNodeGateway(logger, new RecordingBus(), identity, peer.owner);
        const nodeId = createNodeId();
        const records = [...peer.endpoints]
            .filter(({ number }) => number !== 0)
            .map(({ number }) => ({ id: createEndpointId(), nodeId, matterNumber: number, name: "", roomId: null }));
        identity.add(nodeId, peer, records);
        const structure: unknown[] = [];
        const deleted: unknown[] = [];
        gateway.onStructureChanged((id) => structure.push(id));
        gateway.onNodeDeleted((id) => deleted.push(id));

        await peer.delete();

        assert.deepEqual(deleted, [nodeId]);
        assert.deepEqual(structure, []);
        assert.equal(identity.node(nodeId), undefined);
        assert.equal(identity.endpoint(records[0]?.id ?? createEndpointId()), undefined);
        gateway.close();
    });

    test("reconcileEndpoints throws NodeNotFoundError for an unknown node", async (t) => {
        const network = new TestNetwork(t);
        const { controller } = await network.startController();

        assert.throws(() => controller.node.reconcileEndpoints(createNodeId()), NodeNotFoundError);
    });

    test("reconcileEndpoints after a restart returns what is stored and gone, and what is there and not stored", async (t) => {
        const network = new TestNetwork(t);
        const bridge = await network.startBridge();
        const { node, endpoints, restarted } = await network.commissionAndRestart(bridge.manualCode);
        const unstored = endpoints.at(-1);
        assert.ok(unstored !== undefined);
        restarted.endpointRepository.records.splice(restarted.endpointRepository.records.indexOf(unstored), 1);
        const ghost = { id: createEndpointId(), nodeId: node.id, matterNumber: 99, name: "Ghost", roomId: null };
        restarted.endpointRepository.save(ghost);

        await restarted.controller.start();
        const { added, removed } = restarted.controller.node.reconcileEndpoints(node.id);

        assert.deepEqual(removed, [ghost.id]);
        assert.deepEqual(
            added.map(({ matterNumber }) => matterNumber),
            [unstored.matterNumber],
        );
        assert.notEqual(added[0]?.id, unstored.id);
        assert.throws(() => restarted.controller.endpoint.describe(ghost.id), EndpointNotFoundError);
    });

    test("reconcileEndpoints leaves a node alone until it is seeded, and the notice of seeded settles it", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const peer = await network.peer(manualCode, { autoStateInitialize: false, autoSubscribe: false });
        assert.equal(peer.lifecycle.isSeeded, false);
        const logger = new RecordingLogger();
        const identity = new Identity(logger);
        const gateway = new MatterNodeGateway(logger, new RecordingBus(), identity, peer.owner);
        const nodeId = createNodeId();
        const ghost = { id: createEndpointId(), nodeId, matterNumber: 99, name: "Ghost", roomId: null };
        identity.add(nodeId, peer, [ghost]);

        assert.deepEqual(gateway.reconcileEndpoints(nodeId), { added: [], removed: [] });
        assert.deepEqual(identity.endpoint(ghost.id), { nodeId, node: peer, number: 99 });

        const settled = nextChanges(gateway, (changes) => changes);
        await peer.set({ network: { autoSubscribe: true } });
        const { added, removed } = await settled;

        assert.deepEqual(removed, [ghost.id]);
        assert.equal(added.length, 1);
        gateway.close();
    });
});
