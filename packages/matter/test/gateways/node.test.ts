import "../../src/sdk-config.ts";
import assert from "node:assert/strict";
import { describe, type TestContext, test } from "node:test";

import { ObserverGroup, Seconds, VendorId } from "@matter/main";
import {
    BridgedDeviceBasicInformationBehavior,
    BridgedDeviceBasicInformationServer,
} from "@matter/main/behaviors/bridged-device-basic-information";
import { LevelControlServer } from "@matter/main/behaviors/level-control";
import { OnOffLightDevice } from "@matter/main/devices/on-off-light";
import { OnOffPlugInUnitDevice } from "@matter/main/devices/on-off-plug-in-unit";
import { BridgedNodeEndpoint } from "@matter/main/endpoints/bridged-node";
import { Endpoint, EndpointLifecycle, NodeConnectionState, type ServerNode } from "@matter/main/node";
import { PeerTimingParameters } from "@matter/main/protocol";
import { CommissioningFlowType, NodeId as SdkNodeId, QrPairingCodeCodec } from "@matter/main/types";

import { ValidationError } from "@nedalto/contract/common/errors.ts";
import { parseNodeId, toEndpointId, toNodeId } from "@nedalto/contract/common/ids.ts";
import {
    DecommissioningRejectedError,
    NodeNotFoundError,
    NodeUnreachableError,
} from "@nedalto/contract/node/errors.ts";

import { MatterNodeGateway, toNodeConnection } from "../../src/gateways/node.ts";
import { RecordingBus } from "../helpers/bus.ts";
import { QuietLogger } from "../helpers/logger.ts";
import { type TestDevice, TestNetwork, untilConnected } from "../helpers/network.ts";

const UNKNOWN = toNodeId(0xdeadn);

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

// A gateway built over a controller that has already commissioned the device and connected to it, as over the peers
// restored from storage.
async function gatewayOverPeer<T extends TestDevice>(t: TestContext, start: (network: TestNetwork) => Promise<T>) {
    const network = new TestNetwork(t);
    const target = await start(network);
    const peer = await network.peer(target.manualCode);
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
    const bus = new RecordingBus();
    const gateway = new MatterNodeGateway(new QuietLogger(), bus, peer.owner);
    t.after(() => gateway.close());
    // Not `peer.peerAddress`, which the SDK keeps once read and would stand in for what the gateway keeps.
    const address = peer.state.commissioning.peerAddress;
    assert.ok(address !== undefined);
    // Observed after the gateway, so that when it resolves the gateway has already had its turn.
    const nextChange = (): Promise<void> =>
        new Promise((resolve) => {
            peer.lifecycle.connectionStateChanged.once(() => resolve());
        });
    return { target, peer, nodeId: toNodeId(address.nodeId), bus, gateway, nextChange };
}

// Has a bridge gain `endpoint` and resolves with the names that endpointsOf then gives, by endpoint number.
async function namesAfterAdding(t: TestContext, endpoint: Endpoint) {
    const network = new TestNetwork(t);
    const bridge = await network.startBridge();
    const { controller, bus } = await network.startController();
    const { nodeId, endpoints } = await controller.node.commission(bridge.manualCode);
    const gained = bus.next(
        "$node:endpoints-changed",
        () => (controller.node.endpointsOf(nodeId)?.length ?? 0) > endpoints.length + endpoint.parts.size,
    );
    await bridge.add(endpoint);
    await gained;
    return new Map(controller.node.endpointsOf(nodeId)?.map(({ number, name }) => [number, name]));
}

// @matter/main 0.18.0: the server behavior refuses the cluster below a bridged device, and the base behavior
// does not, which is how a device could have it at two levels of one chain.
const bridgedOutlet = (id: string, number: number, nodeLabel?: string): Endpoint =>
    new Endpoint(OnOffPlugInUnitDevice.with(BridgedDeviceBasicInformationBehavior), {
        id,
        number,
        bridgedDeviceBasicInformation: { nodeLabel, uniqueId: id, reachable: true },
    });

// The peers of `server` with no address, which are devices it discovered and never commissioned.
const discovered = (server: ServerNode) => [...server.peers].filter((peer) => peer.peerAddress === undefined);
// The node of each event on `bus`, once each.
const nodeIdsOf = (bus: RecordingBus) =>
    new Set(
        bus.emitted.map(({ payload }) =>
            typeof payload === "object" && payload !== null && "nodeId" in payload ? payload.nodeId : payload,
        ),
    );

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

        const { nodeId, endpoints } = await controller.node.commission(manualCode);

        // Endpoint 0 holds the administration of the node, so the light is never it.
        assert.deepEqual(endpoints, [{ nodeId, number: 1, name: "Test Light" }]);
        assert.equal(controller.node.getInfo(nodeId)?.id, nodeId);
    });

    test("commission joins the device of a QR payload", async (t) => {
        const network = new TestNetwork(t);
        const { qrCode } = await network.startDevice();
        const { controller } = await network.startController();

        const result = await controller.node.commission(qrCode);

        assert.equal(result.endpoints.length, 1);
    });

    const nameCases = [
        { title: "the label of the node", device: { nodeLabel: "Kitchen light" }, expected: "Kitchen light" },
        {
            title: "the product name of the node when its label is blank",
            device: { nodeLabel: "   " },
            expected: "Test Light",
        },
        {
            title: "a fallback when the product name is blank too",
            device: { nodeLabel: "", productName: "   " },
            expected: "Matter Device",
        },
    ];
    for (const { title, device, expected } of nameCases) {
        test(`commission names an endpoint with no bridged information after ${title}`, async (t) => {
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

    test("commission names each bridged device after its own label, and the aggregator after the node", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startBridge();
        const { controller } = await network.startController();

        const result = await controller.node.commission(manualCode);

        assert.deepEqual(
            result.endpoints.map(({ number, name }) => [number, name]),
            [
                [1, "Test Bridge"],
                [2, "light-1"],
                [3, "light-2"],
            ],
        );
    });

    test("endpointsOf names a bridged device whose information has no name after the node", async (t) => {
        const names = await namesAfterAdding(
            t,
            new Endpoint(OnOffLightDevice.with(BridgedDeviceBasicInformationServer), {
                id: "unnamed",
                number: 10,
                bridgedDeviceBasicInformation: { uniqueId: "unnamed", reachable: true },
            }),
        );

        assert.equal(names.get(10), "Test Bridge");
    });

    test("endpointsOf names the parts of a bridged device whose information has no name after the node", async (t) => {
        const names = await namesAfterAdding(
            t,
            new Endpoint(BridgedNodeEndpoint.with(BridgedDeviceBasicInformationServer), {
                id: "unnamed",
                number: 10,
                bridgedDeviceBasicInformation: { uniqueId: "unnamed", reachable: true },
                parts: [new Endpoint(OnOffPlugInUnitDevice, { id: "unnamed-outlet", number: 11 })],
            }),
        );

        assert.equal(names.get(11), "Test Bridge");
    });

    test("endpointsOf names a part with bridged information after its own name, or after its parent's without one", async (t) => {
        const names = await namesAfterAdding(
            t,
            new Endpoint(BridgedNodeEndpoint.with(BridgedDeviceBasicInformationServer), {
                id: "strip",
                number: 10,
                bridgedDeviceBasicInformation: { nodeLabel: "strip", uniqueId: "strip", reachable: true },
                parts: [bridgedOutlet("named", 11, "named outlet"), bridgedOutlet("unnamed", 12)],
            }),
        );

        assert.deepEqual([names.get(11), names.get(12)], ["named outlet", "strip"]);
    });

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

    const decommissionCases = [
        {
            force: false,
            title: "removes the fabric from the device",
            // @matter/node 0.18.0: removing the fabric drops the connection before the peer starts going.
            emitted: (nodeId: unknown) => [
                { name: "$node:connection-changed", payload: { nodeId, connection: "reconnecting" } },
                { name: "$node:deleted", payload: { nodeId } },
            ],
        },
        {
            force: true,
            title: "when forced leaves the fabric on the device",
            emitted: (nodeId: unknown) => [{ name: "$node:deleted", payload: { nodeId } }],
        },
    ];
    for (const { force, title, emitted } of decommissionCases) {
        test(`decommission ${title}, and reports the node deleted before it returns and no change of its endpoints`, async (t) => {
            const network = new TestNetwork(t);
            const bridge = await network.startBridge();
            const started = await network.startController();
            const { controller, bus } = started;
            const { nodeId } = await controller.node.commission(bridge.manualCode);
            await untilConnected(started, nodeId);
            const before = bus.emitted.length;

            await controller.node.decommission(nodeId, force);

            assert.deepEqual(bus.emitted.slice(before), emitted(nodeId));
            assert.throws(() => controller.node.getInfo(nodeId), NodeNotFoundError);
            assert.equal(bridge.device.lifecycle.isCommissioned, force);
        });
    }

    test("decommission throws NodeNotFoundError for an unknown node", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const { controller } = await network.startController();
        await controller.node.commission(manualCode);

        await assert.rejects(controller.node.decommission(UNKNOWN), NodeNotFoundError);
    });

    test("decommission rejects a second call for a node that is being decommissioned", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode, device } = await network.startDevice();
        const started = await network.startController();
        const { controller } = started;
        const { nodeId } = await controller.node.commission(manualCode);
        await untilConnected(started, nodeId);

        const [first, second] = await Promise.allSettled([
            controller.node.decommission(nodeId),
            controller.node.decommission(nodeId),
        ]);

        assert.equal(first.status, "fulfilled");
        assert.equal(second.status, "rejected");
        const error = second.reason;
        assert.ok(error instanceof DecommissioningRejectedError);
        assert.equal(error.code, "CONFLICT_ERROR");
        assert.deepEqual(error.data, { nodeId, reason: "in-progress" });
        assert.equal(device.lifecycle.isCommissioned, false);
    });

    test("decommission throws NodeUnreachableError and keeps the node when the device does not answer", async (t) => {
        // @matter/protocol 0.18.0: the controller copies this when it is created, and gives up on a device that does
        // not answer after it, 90 seconds by default; the error is the same with a shorter wait.
        const timeout = PeerTimingParameters.defaults.defaultConnectionTimeout;
        PeerTimingParameters.defaults.defaultConnectionTimeout = Seconds(3);
        t.after(() => {
            PeerTimingParameters.defaults.defaultConnectionTimeout = timeout;
        });
        const network = new TestNetwork(t);
        const { manualCode, device } = await network.startDevice();
        const started = await network.startController();
        const { controller, bus } = started;
        const { nodeId } = await controller.node.commission(manualCode);
        await untilConnected(started, nodeId);
        await device.close();

        await assert.rejects(controller.node.decommission(nodeId), (error: unknown) => {
            assert.ok(error instanceof NodeUnreachableError);
            assert.equal(error.code, "UNREACHABLE_ERROR");
            assert.deepEqual(error.data, { nodeId, reason: "no-response" });
            return true;
        });
        assert.equal(controller.node.getInfo(nodeId)?.id, nodeId);
        assert.deepEqual(
            bus.emitted.filter(({ name }) => name === "$node:deleted"),
            [],
        );
    });

    test("getInfo returns what the device reports about itself", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice({ nodeLabel: "Kitchen light" });
        const { controller } = await network.startController();
        const before = Date.now();
        const { nodeId } = await controller.node.commission(manualCode);
        const after = Date.now();

        const reported = controller.node.getInfo(nodeId);

        assert.ok(reported !== null);
        const { commissionedAt, matterId, ...info } = reported;

        assert.deepEqual(info, {
            id: nodeId,
            label: "Kitchen light",
            vendorName: "Nedalto Test",
            productName: "Test Light",
            vendorId: 0xfff1,
            productId: 0x8000,
            hardwareVersion: 2,
            softwareVersion: 3,
            softwareVersionString: "3.0.0",
        });
        assert.equal(matterId, Number(parseNodeId(nodeId)));
        assert.ok(commissionedAt !== null && commissionedAt >= before && commissionedAt <= after);
    });

    test("getInfo tags a Matter node id beyond the safe range", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const peer = await network.peer(manualCode, { nodeId: SdkNodeId(2n ** 60n + 1n) });
        assert.ok(peer.owner !== undefined);
        const gateway = new MatterNodeGateway(new QuietLogger(), new RecordingBus(), peer.owner);
        t.after(() => gateway.close());

        assert.deepEqual(gateway.getInfo(toNodeId(2n ** 60n + 1n))?.matterId, { $integer: "1152921504606846977" });
    });

    test("getInfo throws NodeNotFoundError on a controller that has commissioned nothing", async (t) => {
        const network = new TestNetwork(t);
        const { controller } = await network.startController();

        assert.throws(() => controller.node.getInfo(UNKNOWN), NodeNotFoundError);
    });

    test("getInfo throws NodeNotFoundError for a node the controller does not have", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const { controller } = await network.startController();
        await controller.node.commission(manualCode);

        assert.throws(() => controller.node.getInfo(UNKNOWN), NodeNotFoundError);
    });

    test("connectionOf is disconnected for an unknown node", async (t) => {
        const network = new TestNetwork(t);
        const { controller } = await network.startController();

        assert.equal(controller.node.connectionOf(UNKNOWN), "disconnected");
    });

    test("reports the connection of a node of the storage up to connected when the controller restarts", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const { nodeId, restarted } = await network.commissionAndRestart(manualCode);
        const changes: unknown[] = [];
        restarted.bus.on("$node:connection-changed", ({ nodeId: id, connection }) => changes.push([id, connection]));
        const connected = restarted.bus.next(
            "$node:connection-changed",
            ({ connection }) => connection === "connected",
        );

        await restarted.controller.start();
        await connected;

        assert.deepEqual(changes, [
            [nodeId, "reconnecting"],
            [nodeId, "connected"],
        ]);
        assert.equal(restarted.controller.node.connectionOf(nodeId), "connected");
    });

    test("reports the connection of a node commissioned after the gateway was built", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const { controller, bus } = await network.startController();
        const connected = bus.next("$node:connection-changed", ({ connection }) => connection === "connected");

        const { nodeId } = await controller.node.commission(manualCode);

        // @matter/node 0.18.0: `commission()` returns after the initial read, before the subscription is live.
        assert.equal(controller.node.connectionOf(nodeId), "reconnecting");
        assert.equal((await connected).nodeId, nodeId);
    });

    test("reports a value other than connected, the same that connectionOf gives, when the device stops", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode, device } = await network.startDevice();
        const started = await network.startController();
        const { controller, bus } = started;
        const { nodeId } = await controller.node.commission(manualCode);
        await untilConnected(started, nodeId);
        const stopped = bus.next("$node:connection-changed", ({ connection }) => connection !== "connected");

        await device.close();

        const { nodeId: id, connection } = await stopped;
        assert.equal(id, nodeId);
        assert.equal(controller.node.connectionOf(nodeId), connection);
    });

    test("reports nothing after close()", async (t) => {
        const { target, bus, gateway, nextChange } = await gatewayOverPeer(t, (network) => network.startDevice());
        const changed = nextChange();

        gateway.close();
        await target.device.close();
        await changed;

        assert.deepEqual(bus.emitted, []);
    });

    test("reports a node of the storage that the SDK deletes, and no change of its endpoints", async (t) => {
        const { peer, nodeId, bus } = await gatewayOverPeer(t, (network) => network.startBridge());

        await peer.delete();

        assert.deepEqual(bus.emitted, [{ name: "$node:deleted", payload: { nodeId } }]);
    });

    test("stops observing a peer that the SDK deletes", async (t) => {
        const { peer } = await gatewayOverPeer(t, (network) => network.startDevice());
        assert.equal(peer.lifecycle.connectionStateChanged.isObserved, true);

        await peer.delete();

        assert.equal(peer.lifecycle.connectionStateChanged.isObserved, false);
    });

    test("reports nothing of a device that the controller discovered and did not commission, also after a restart", async (t) => {
        const network = new TestNetwork(t);
        // Commissionable while the other one is commissioned, so the controller discovers it and keeps it as a peer.
        await network.startDevice();
        const { manualCode } = await network.startDevice();
        const environment = network.environment();
        const first = await network.controllerNode(environment);
        const firstBus = new RecordingBus();
        const firstGateway = new MatterNodeGateway(new QuietLogger(), firstBus, first);
        await first.start();
        const { nodeId, endpoints } = await firstGateway.commission(manualCode);
        const discoveredBefore = discovered(first).length;
        firstGateway.close();
        await first.close();
        const second = await network.controllerNode(environment);
        const secondBus = new RecordingBus();
        const secondGateway = new MatterNodeGateway(new QuietLogger(), secondBus, second);
        t.after(() => secondGateway.close());
        const connected = secondBus.next("$node:connection-changed", ({ connection }) => connection === "connected");
        await second.start();
        await connected;

        assert.equal(discoveredBefore, 1);
        assert.equal(discovered(second).length, 1);
        assert.deepEqual(new Set(endpoints.map((endpoint) => endpoint.nodeId)), new Set([nodeId]));
        assert.deepEqual(nodeIdsOf(firstBus), new Set([nodeId]));
        assert.deepEqual(nodeIdsOf(secondBus), new Set([nodeId]));
        assert.throws(() => secondGateway.getInfo(UNKNOWN), NodeNotFoundError);
        assert.equal(secondGateway.connectionOf(UNKNOWN), "disconnected");
    });

    test("reports a change of the endpoints when the bridge gains a light, which endpointsOf then has", async (t) => {
        const network = new TestNetwork(t);
        const bridge = await network.startBridge();
        const { controller, bus } = await network.startController();
        const { nodeId, endpoints } = await controller.node.commission(bridge.manualCode);
        // Within the notice, before anything else could run.
        const listed = new Promise((resolve) => {
            const unsubscribe = bus.on("$node:endpoints-changed", ({ nodeId: id }) => {
                const now = controller.node.endpointsOf(id);
                if (now !== null && now.length > endpoints.length) {
                    unsubscribe();
                    resolve(now);
                }
            });
        });

        const light = await bridge.addLight("light-3");

        assert.deepEqual(await listed, [...endpoints, { nodeId, number: light.number, name: "light-3" }]);
    });

    test("reports a change of the endpoints when the bridge loses a light, which endpointsOf then leaves out", async (t) => {
        const network = new TestNetwork(t);
        const bridge = await network.startBridge();
        const { controller, bus } = await network.startController();
        const { nodeId, endpoints } = await controller.node.commission(bridge.manualCode);
        const light = await bridge.addLight("light-3");
        await bus.next("$node:endpoints-changed", () => controller.node.endpointsOf(nodeId)?.length === 4);
        const listed = new Promise((resolve) => {
            const unsubscribe = bus.on("$node:endpoints-changed", ({ nodeId: id }) => {
                const now = controller.node.endpointsOf(id);
                if (now !== null && now.length === endpoints.length) {
                    unsubscribe();
                    resolve(now);
                }
            });
        });

        await light.delete();

        assert.deepEqual(await listed, endpoints);
    });

    test("endpointsOf names the outlets of a bridged strip after the strip", async (t) => {
        const network = new TestNetwork(t);
        const bridge = await network.startBridge();
        const { controller, bus } = await network.startController();
        const { nodeId } = await controller.node.commission(bridge.manualCode);
        const complete = bus.next(
            "$node:endpoints-changed",
            () => controller.node.endpointsOf(nodeId)?.some(({ number }) => number === 51) === true,
        );

        await bridge.addStrip("strip", [60, 50, 51]);
        await complete;

        const names = new Map(controller.node.endpointsOf(nodeId)?.map(({ number, name }) => [number, name]));
        assert.deepEqual([names.get(60), names.get(50), names.get(51)], ["strip", "strip", "strip"]);
    });

    test("endpointsOf leaves out an endpoint that is installed and not ready yet", async (t) => {
        const { target, peer, nodeId, gateway, bus } = await gatewayOverPeer(t, (network) => network.startBridge());
        const whileInstalling: unknown[] = [];
        const observers = new ObserverGroup();
        t.after(() => observers.close());
        observers.on(peer.lifecycle.changed, (change, endpoint) => {
            if (change === EndpointLifecycle.Change.Installed) {
                assert.equal(peer.endpoints.has(endpoint.number), true);
                whileInstalling.push(gateway.endpointsOf(nodeId)?.length);
            }
        });
        const gained = bus.next("$node:endpoints-changed", () => gateway.endpointsOf(nodeId)?.length === 4);

        await target.addLight("light-3");
        await gained;

        assert.deepEqual(whileInstalling, [3]);
    });

    test("endpointsOf and getInfo are null until the node is seeded, and the notice of seeded reports a change", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const peer = await network.peer(manualCode, { autoStateInitialize: false, autoSubscribe: false });
        assert.equal(peer.lifecycle.isSeeded, false);
        const bus = new RecordingBus();
        const gateway = new MatterNodeGateway(new QuietLogger(), bus, peer.owner);
        t.after(() => gateway.close());
        const address = peer.peerAddress;
        assert.ok(address !== undefined);
        const nodeId = toNodeId(address.nodeId);

        assert.equal(gateway.endpointsOf(nodeId), null);
        assert.equal(gateway.getInfo(nodeId), null);

        const seeded = bus.next("$node:endpoints-changed", ({ nodeId: id }) => gateway.endpointsOf(id) !== null);
        await peer.set({ network: { autoSubscribe: true } });

        assert.deepEqual(await seeded, { nodeId });
        assert.equal(gateway.endpointsOf(nodeId)?.length, 1);
        assert.equal(gateway.getInfo(nodeId)?.id, nodeId);
    });

    test("endpointsOf throws NodeNotFoundError for an unknown node", async (t) => {
        const network = new TestNetwork(t);
        const { controller } = await network.startController();

        assert.throws(() => controller.node.endpointsOf(UNKNOWN), NodeNotFoundError);
    });

    test("reports nothing of endpoint 0 while the device is commissioned", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const { controller, bus } = await network.startController();

        // @matter/node 0.18.0: the SDK reports the clusters of endpoint 0 changed several times meanwhile.
        const { nodeId } = await controller.node.commission(manualCode);

        assert.deepEqual(
            bus.emitted.filter(
                ({ name, payload }) =>
                    name === "$endpoint:clusters-changed" &&
                    typeof payload === "object" &&
                    payload !== null &&
                    "endpointId" in payload &&
                    payload.endpointId === toEndpointId(nodeId, 0),
            ),
            [],
        );
    });

    test("reports the clusters of a bridged light changed when it gains one", async (t) => {
        const network = new TestNetwork(t);
        const bridge = await network.startBridge();
        const { controller, bus } = await network.startController();
        const { nodeId } = await controller.node.commission(bridge.manualCode);
        const light = await bridge.addLight("light-3");
        await bus.next("$node:endpoints-changed", () => controller.node.endpointsOf(nodeId)?.length === 4);
        const changed = bus.next("$endpoint:clusters-changed");

        light.behaviors.require(LevelControlServer);

        assert.deepEqual(await changed, { endpointId: toEndpointId(nodeId, light.number) });
    });
});
