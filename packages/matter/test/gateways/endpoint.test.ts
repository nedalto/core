import "../../src/sdk-config.ts";
import assert from "node:assert/strict";
import { describe, type TestContext, test } from "node:test";

import { MockNetwork, Network, Seconds, Timestamp } from "@matter/main";
import { BindingServer } from "@matter/main/behaviors/binding";
import { CarbonDioxideConcentrationMeasurementServer } from "@matter/main/behaviors/carbon-dioxide-concentration-measurement";
import { MessagesServer } from "@matter/main/behaviors/messages";
import { OnOffServer } from "@matter/main/behaviors/on-off";
import { ConcentrationMeasurement } from "@matter/main/clusters/concentration-measurement";
import type { Messages } from "@matter/main/clusters/messages";
import { OnOffLightDevice } from "@matter/main/devices/on-off-light";
import { EventModel } from "@matter/main/model";
import { ChangeNotificationService, type ClientNode, Endpoint, type ServerNode } from "@matter/main/node";
import { EventNumber, Priority, Status, StatusResponseError } from "@matter/main/types";

import { ValidationError } from "@nedalto/contract/common/errors.ts";
import { type EndpointId, toEndpointId } from "@nedalto/contract/common/ids.ts";
import {
    AttributeNotFoundError,
    CommandNotFoundError,
    EndpointNotFoundError,
    EndpointUnreachableError,
    InteractionRejectedError,
} from "@nedalto/contract/endpoint/errors.ts";
import type { EndpointGateway } from "@nedalto/contract/endpoint/ports.ts";

import { nodeIdOf } from "../../src/addressing.ts";
import { MatterEndpointGateway } from "../../src/gateways/endpoint.ts";
import { RecordingBus } from "../helpers/bus.ts";
import { putToSleep, TestNetwork, untilConnected } from "../helpers/network.ts";

const ON_OFF = 0x06;
const ON_OFF_ATTRIBUTE = 0x0000;
const ON_TIME_ATTRIBUTE = 0x4001;
const OFF_COMMAND = 0x00;
const ON_COMMAND = 0x01;
const TOGGLE_COMMAND = 0x02;
const GROUPS = 0x04;
const GET_GROUP_MEMBERSHIP_COMMAND = 0x02;
const OPERATIONAL_CREDENTIALS = 0x3e;
const REMOVE_FABRIC_COMMAND = 0x0a;
// The Thermostat is in the specification, but a light does not have it.
const THERMOSTAT = 0x0201;
const OCCUPIED_HEATING_SETPOINT = 0x12;
const SETPOINT_RAISE_LOWER_COMMAND = 0x00;
// A cluster of a manufacturer, which the light does not have.
const VENDOR_CLUSTER = 0xfff1fc01;
// Ids that Matter cannot address: a cluster with a vendor prefix and a suffix that is not for a manufacturer,
// an attribute above the range of a cluster, a command above 255.
const UNADDRESSABLE_CLUSTER = 0x99999999;
const UNADDRESSABLE_ATTRIBUTE = 0x9999;
const UNADDRESSABLE_COMMAND = 0x100;
const MESSAGES = 0x97;
const MESSAGES_ATTRIBUTE = 0x0000;
const PRESENT_MESSAGES_REQUEST = 0x00;
const BINDING = 0x1e;
const BINDING_ATTRIBUTE = 0x0000;
const TARGET = { node: 1, endpoint: 1, cluster: ON_OFF };
// A message without its duration: a field of 16 bytes, and one of a uint64 that each test sets.
const MESSAGE = {
    messageId: { $bytes: "000102030405060708090a0b0c0d0e0f" },
    priority: 0,
    messageControl: {},
    startTime: null,
    messageText: "Dinner is ready",
};
const CO2_MEASUREMENT = 0x040d;
const MEASURED_VALUE = 0x0000;
const DESCRIPTOR_PARTS_LIST = 0x0003;
const DESCRIPTOR_ATTRIBUTES_WITH_VALUE = [0x0000, 0x0001, 0x0002, DESCRIPTOR_PARTS_LIST];
const GLOBAL_ATTRIBUTES = new Set([0xfff8, 0xfff9, 0xfffa, 0xfffb, 0xfffc, 0xfffd]);
const CLUSTER_STATUS = 0x02;

// Short, so that a request to a sleeping device fails as asleep after a second.
const LIMIT = Seconds(1);
// A request still unanswered 5 s after the limit fails as no-response.
const NO_RESPONSE_AFTER = LIMIT + Seconds(5);

// A started controller that has commissioned a light, which is its only endpoint.
async function commissionLight(t: TestContext) {
    const network = new TestNetwork(t);
    const { manualCode, device } = await network.startDevice();
    const started = await network.startController();
    const { nodeId, endpoints } = await started.controller.node.commission(manualCode);
    const [light] = endpoints;
    assert.ok(light !== undefined);
    return { ...started, network, device, nodeId, endpointId: toEndpointId(nodeId, light.number) };
}

// A Messages server that keeps each message it is asked to present, as a real one would show it.
class RecordingMessagesServer extends MessagesServer {
    override presentMessagesRequest(request: Messages.PresentMessagesRequest): void {
        const fabricIndex = this.context.fabric;
        assert.ok(fabricIndex !== undefined);
        const { messageId, priority, messageControl, startTime, duration, messageText, responses } = request;
        this.state.messages = [
            ...this.state.messages,
            { messageId, priority, messageControl, startTime, duration, messageText, responses, fabricIndex },
        ];
    }
}

// A started controller that has commissioned a bridge with a light that shows messages.
async function commissionMessages(t: TestContext) {
    const network = new TestNetwork(t);
    const bridge = await network.startBridge();
    const { number } = await bridge.add(
        new Endpoint(OnOffLightDevice.with(RecordingMessagesServer), { id: "messages" }),
    );
    const started = await network.startController();
    const { nodeId } = await started.controller.node.commission(bridge.manualCode);
    return { ...started, endpointId: toEndpointId(nodeId, number) };
}

// A light that refuses Toggle with a status code of its cluster, as a lock refuses a duplicate code.
class RefusingOnOffServer extends OnOffServer {
    override toggle(): void {
        throw new StatusResponseError("Refused", Status.Failure, CLUSTER_STATUS);
    }
}

// A started controller that has commissioned a bridge with a light that keeps bindings. Shared, another controller has
// commissioned it first: the device gives the fabric of the hub its second index, and the hub gives its own the first.
async function commissionBindings(t: TestContext, { shared = false } = {}) {
    const network = new TestNetwork(t);
    const bridge = await network.startBridge();
    const { number } = await bridge.add(new Endpoint(OnOffLightDevice.with(BindingServer), { id: "bindings" }));
    const started = await network.startController();
    const code = shared ? await network.share(bridge) : bridge.manualCode;
    const { nodeId } = await started.controller.node.commission(code);
    return { ...started, endpointId: toEndpointId(nodeId, number) };
}

// A gateway with a short limit over the controller of `peer`, closed when the test ends.
function gatewayOver(t: TestContext, peer: ClientNode, bus = new RecordingBus()): MatterEndpointGateway {
    assert.ok(peer.owner !== undefined);
    const gateway = new MatterEndpointGateway(bus, peer.owner, LIMIT);
    t.after(() => gateway.close());
    return gateway;
}

function idOf(peer: ClientNode, number: number): EndpointId {
    const nodeId = nodeIdOf(peer);
    assert.ok(nodeId !== undefined);
    return toEndpointId(nodeId, number);
}

// A gateway over a peer with a carbon dioxide sensor that starts measuring `measuredValue`.
async function startSensor(t: TestContext, measuredValue: number) {
    const network = new TestNetwork(t);
    const bridge = await network.startBridge();
    const sensor = new Endpoint(
        OnOffLightDevice.with(CarbonDioxideConcentrationMeasurementServer.with("NumericMeasurement")),
        {
            id: "sensor",
            carbonDioxideConcentrationMeasurement: {
                measuredValue,
                measurementUnit: ConcentrationMeasurement.MeasurementUnit.Ppm,
                measurementMedium: ConcentrationMeasurement.MeasurementMedium.Air,
            },
        },
    );
    await bridge.add(sensor);
    const peer = await network.peer(bridge.manualCode);
    const bus = new RecordingBus();
    const gateway = gatewayOver(t, peer, bus);
    return { sensor, bus, gateway, endpointId: idOf(peer, sensor.number) };
}

// Takes the addresses of `device` off the network, as unplugging it would, without closing its sessions.
function unplug(device: ServerNode): void {
    const network = device.env.get(Network);
    assert.ok(network instanceof MockNetwork);
    for (const { name } of network.getNetInterfaces()) {
        const { ipV4, ipV6 } = network.getIpMac(name);
        network.deleteAddr(...ipV4, ...ipV6);
    }
}

function serviceOf(endpoint: Endpoint): ChangeNotificationService {
    let root: Endpoint = endpoint;
    while (root.owner !== undefined) {
        root = root.owner;
    }
    return root.env.get(ChangeNotificationService);
}

// Reports a change of `endpoint` as the SDK would.
function reportChange(endpoint: Endpoint, behaviorId: string, properties?: string[]): void {
    const behavior = endpoint.behaviors.supported[behaviorId];
    assert.ok(behavior !== undefined);
    serviceOf(endpoint).change.emit({ kind: "update", endpoint, behavior, version: 1, properties });
}

const attributeIdsOf = (bus: RecordingBus): unknown[] =>
    bus.emitted.flatMap(({ payload }) => {
        assert.ok(typeof payload === "object" && payload !== null && "attributeId" in payload);
        return [payload.attributeId];
    });

function issuePaths(error: unknown): unknown[] {
    assert.ok(error instanceof ValidationError);
    assert.equal(error.code, "VALIDATION_ERROR");
    return error.data.issues.map((issue) => issue.path);
}

const expectNotFound = (endpointId: EndpointId) => (error: unknown) => {
    assert.ok(error instanceof EndpointNotFoundError);
    assert.equal(error.code, "NOT_FOUND_ERROR");
    assert.deepEqual(error.data, { endpointId });
    return true;
};

const expectUnreachable = (endpointId: EndpointId, reason: string) => (error: unknown) => {
    assert.ok(error instanceof EndpointUnreachableError);
    assert.equal(error.code, "UNREACHABLE_ERROR");
    assert.deepEqual(error.data, { endpointId, reason });
    return true;
};

const interactions: { name: string; call: (gateway: EndpointGateway, id: EndpointId) => Promise<unknown> }[] = [
    { name: "read", call: (gateway, id) => gateway.read(id, ON_OFF, ON_OFF_ATTRIBUTE) },
    { name: "write", call: (gateway, id) => gateway.write(id, ON_OFF, ON_TIME_ATTRIBUTE, 30) },
    { name: "invoke", call: (gateway, id) => gateway.invoke(id, ON_OFF, TOGGLE_COMMAND) },
];

const operations: { name: string; call: (gateway: EndpointGateway, id: EndpointId) => unknown }[] = [
    ...interactions,
    { name: "describe", call: (gateway, id) => gateway.describe(id) },
];

const missingCluster = [
    {
        name: "read",
        type: AttributeNotFoundError,
        target: { attributeId: OCCUPIED_HEATING_SETPOINT },
        call: (gateway: EndpointGateway, id: EndpointId) => gateway.read(id, THERMOSTAT, OCCUPIED_HEATING_SETPOINT),
    },
    {
        name: "write",
        type: AttributeNotFoundError,
        target: { attributeId: OCCUPIED_HEATING_SETPOINT },
        call: (gateway: EndpointGateway, id: EndpointId) =>
            gateway.write(id, THERMOSTAT, OCCUPIED_HEATING_SETPOINT, 2000),
    },
    {
        name: "invoke",
        type: CommandNotFoundError,
        target: { commandId: SETPOINT_RAISE_LOWER_COMMAND },
        call: (gateway: EndpointGateway, id: EndpointId) =>
            gateway.invoke(id, THERMOSTAT, SETPOINT_RAISE_LOWER_COMMAND, { mode: 0, amount: 1 }),
    },
];

describe("MatterEndpointGateway", () => {
    for (const { name, call } of operations) {
        test(`${name} throws EndpointNotFoundError for an endpoint the node does not have`, async (t) => {
            const { controller, nodeId } = await commissionLight(t);
            const endpointId = toEndpointId(nodeId, 9);

            await assert.rejects(async () => call(controller.endpoint, endpointId), expectNotFound(endpointId));
        });

        test(`${name} throws EndpointNotFoundError for a node whose structure is not seeded`, async (t) => {
            const network = new TestNetwork(t);
            const { manualCode } = await network.startDevice();
            const peer = await network.peer(manualCode, { autoStateInitialize: false, autoSubscribe: false });
            const gateway = gatewayOver(t, peer);
            const endpointId = idOf(peer, 1);

            await assert.rejects(async () => call(gateway, endpointId), expectNotFound(endpointId));
        });
    }

    test("invoke throws EndpointNotFoundError for the root of the node", async (t) => {
        const { controller, nodeId } = await commissionLight(t);
        const root = toEndpointId(nodeId, 0);

        await assert.rejects(
            controller.endpoint.invoke(root, OPERATIONAL_CREDENTIALS, REMOVE_FABRIC_COMMAND, { fabricIndex: 1 }),
            expectNotFound(root),
        );
    });

    for (const { name, call } of interactions) {
        test(`${name} throws EndpointUnreachableError as asleep for a device that sleeps past the wait`, async (t) => {
            const network = new TestNetwork(t);
            const { manualCode } = await network.startDevice();
            const peer = await network.peer(manualCode);
            const gateway = gatewayOver(t, peer);
            await putToSleep(peer);
            const endpointId = idOf(peer, 1);

            await assert.rejects(call(gateway, endpointId), expectUnreachable(endpointId, "asleep"));
        });

        test(`${name} throws EndpointUnreachableError as no-response 5 s after the limit for an unplugged device`, async (t) => {
            const network = new TestNetwork(t);
            const { manualCode, device } = await network.startDevice();
            const peer = await network.peer(manualCode);
            const gateway = gatewayOver(t, peer);
            const endpointId = idOf(peer, 1);
            // The session is open, and stays so: the device does not close it.
            await gateway.read(endpointId, ON_OFF, ON_OFF_ATTRIBUTE);
            unplug(device);
            const started = performance.now();

            await assert.rejects(call(gateway, endpointId), expectUnreachable(endpointId, "no-response"));
            assert.ok(performance.now() - started < NO_RESPONSE_AFTER + 1000);
        });

        test(`${name} throws EndpointUnreachableError as no-response 5 s after the limit for a restored node whose device is off`, async (t) => {
            const network = new TestNetwork(t);
            const { manualCode, device } = await network.startDevice();
            const environment = network.environment();
            const first = await network.controllerNode(environment);
            await first.start();
            await first.peers.commission({ pairingCode: manualCode });
            await first.close();
            await device.close();
            const restored = await network.controllerNode(environment);
            await restored.start();
            const [peer] = restored.peers;
            assert.ok(peer !== undefined);
            const gateway = gatewayOver(t, peer);
            const endpointId = idOf(peer, 1);
            const started = performance.now();

            await assert.rejects(call(gateway, endpointId), expectUnreachable(endpointId, "no-response"));
            assert.ok(performance.now() - started < NO_RESPONSE_AFTER + 1000);
        });
    }

    for (const { name, type, target, call } of missingCluster) {
        test(`${name} throws ${type.name} for a cluster the endpoint lacks without contacting the device`, async (t) => {
            const { controller, device, endpointId } = await commissionLight(t);
            await device.close();

            await assert.rejects(call(controller.endpoint, endpointId), (error: unknown) => {
                assert.ok(error instanceof type);
                assert.equal(error.code, "NOT_FOUND_ERROR");
                assert.deepEqual(error.data, { endpointId, clusterId: THERMOSTAT, ...target });
                return true;
            });
        });
    }

    test("read returns the value of an attribute that has not changed since the subscription cached it", async (t) => {
        const started = await commissionLight(t);
        const { controller, nodeId, endpointId } = started;
        await untilConnected(started, nodeId);

        assert.equal(await controller.endpoint.read(endpointId, ON_OFF, ON_OFF_ATTRIBUTE), false);
    });

    test("read throws AttributeNotFoundError for an attribute that the cluster of the endpoint lacks", async (t) => {
        const { controller, endpointId } = await commissionLight(t);

        await assert.rejects(controller.endpoint.read(endpointId, ON_OFF, 0x0005), (error: unknown) => {
            assert.ok(error instanceof AttributeNotFoundError);
            assert.equal(error.code, "NOT_FOUND_ERROR");
            assert.deepEqual(error.data, { endpointId, clusterId: ON_OFF, attributeId: 0x0005 });
            return true;
        });
    });

    test("read throws ValidationError for ids that Matter cannot address", async (t) => {
        const { controller, endpointId } = await commissionLight(t);

        await assert.rejects(
            controller.endpoint.read(endpointId, UNADDRESSABLE_CLUSTER, UNADDRESSABLE_ATTRIBUTE),
            (error: unknown) => {
                assert.deepEqual(issuePaths(error), ["clusterId", "attributeId"]);
                return true;
            },
        );
    });

    test("write throws ValidationError for ids that Matter cannot address", async (t) => {
        const { controller, endpointId } = await commissionLight(t);

        await assert.rejects(
            controller.endpoint.write(endpointId, ON_OFF, UNADDRESSABLE_ATTRIBUTE, 1),
            (error: unknown) => {
                assert.deepEqual(issuePaths(error), ["attributeId"]);
                return true;
            },
        );
    });

    test("invoke throws ValidationError for ids that Matter cannot address", async (t) => {
        const { controller, endpointId } = await commissionLight(t);

        await assert.rejects(
            controller.endpoint.invoke(endpointId, UNADDRESSABLE_CLUSTER, UNADDRESSABLE_COMMAND),
            (error: unknown) => {
                assert.deepEqual(issuePaths(error), ["clusterId", "commandId"]);
                return true;
            },
        );
    });

    test("write sets an attribute that can be written", async (t) => {
        const { controller, endpointId } = await commissionLight(t);

        await controller.endpoint.write(endpointId, ON_OFF, ON_TIME_ATTRIBUTE, 30);

        assert.equal(await controller.endpoint.read(endpointId, ON_OFF, ON_TIME_ATTRIBUTE), 30);
    });

    test("write sets an attribute from a tagged integer within the safe range", async (t) => {
        const { controller, endpointId } = await commissionLight(t);

        await controller.endpoint.write(endpointId, ON_OFF, ON_TIME_ATTRIBUTE, { $integer: "30" });

        assert.equal(await controller.endpoint.read(endpointId, ON_OFF, ON_TIME_ATTRIBUTE), 30);
    });

    test("write throws InteractionRejectedError with the status for an attribute that is read-only", async (t) => {
        const { controller, endpointId } = await commissionLight(t);

        await assert.rejects(
            controller.endpoint.write(endpointId, ON_OFF, ON_OFF_ATTRIBUTE, true),
            (error: unknown) => {
                assert.ok(error instanceof InteractionRejectedError);
                assert.equal(error.code, "INTEGRATION_ERROR");
                assert.deepEqual(error.data, {
                    endpointId,
                    clusterId: ON_OFF,
                    attributeId: ON_OFF_ATTRIBUTE,
                    status: Status.UnsupportedWrite,
                });
                return true;
            },
        );
    });

    test("write throws ValidationError for a value that does not fit the attribute", async (t) => {
        const { controller, endpointId } = await commissionLight(t);

        await assert.rejects(
            controller.endpoint.write(endpointId, ON_OFF, ON_TIME_ATTRIBUTE, "thirty"),
            (error: unknown) => {
                assert.deepEqual(issuePaths(error), ["value"]);
                return true;
            },
        );
    });

    test("write leaves to the device the fabricIndex of each entry of a fabric-scoped list", async (t) => {
        const { controller, endpointId } = await commissionBindings(t, { shared: true });

        await controller.endpoint.write(endpointId, BINDING, BINDING_ATTRIBUTE, [TARGET]);

        const entries = await controller.endpoint.read(endpointId, BINDING, BINDING_ATTRIBUTE);
        assert.deepEqual(entries, [{ ...TARGET, fabricIndex: 2 }]);
    });

    test("write takes a fabric-scoped list as a read returns it", async (t) => {
        const { controller, endpointId } = await commissionBindings(t, { shared: true });
        await controller.endpoint.write(endpointId, BINDING, BINDING_ATTRIBUTE, [TARGET]);
        const entries = await controller.endpoint.read(endpointId, BINDING, BINDING_ATTRIBUTE);

        await controller.endpoint.write(endpointId, BINDING, BINDING_ATTRIBUTE, entries);

        assert.deepEqual(await controller.endpoint.read(endpointId, BINDING, BINDING_ATTRIBUTE), entries);
    });

    test("write leaves a list as it was when the device refuses one of its entries", async (t) => {
        const { controller, endpointId } = await commissionBindings(t);
        await controller.endpoint.write(endpointId, BINDING, BINDING_ATTRIBUTE, [TARGET]);
        const before = await controller.endpoint.read(endpointId, BINDING, BINDING_ATTRIBUTE);

        const written = controller.endpoint.write(endpointId, BINDING, BINDING_ATTRIBUTE, [
            { ...TARGET, node: 2 },
            // A group and an endpoint together, which the cluster does not allow.
            { group: 1, endpoint: 1 },
        ]);

        await assert.rejects(written, (error: unknown) => {
            assert.ok(error instanceof InteractionRejectedError);
            assert.deepEqual(error.data, {
                endpointId,
                clusterId: BINDING,
                attributeId: BINDING_ATTRIBUTE,
                status: Status.ConstraintError,
            });
            return true;
        });
        assert.deepEqual(await controller.endpoint.read(endpointId, BINDING, BINDING_ATTRIBUTE), before);
    });

    const absentAttributes = [
        { title: "an attribute that the cluster does not have", cluster: ON_OFF, attribute: 0x0999 },
        { title: "an attribute of a vendor cluster that the endpoint lacks", cluster: VENDOR_CLUSTER, attribute: 0 },
    ];
    for (const { title, cluster, attribute } of absentAttributes) {
        test(`write throws AttributeNotFoundError for ${title}`, async (t) => {
            const { controller, endpointId } = await commissionLight(t);

            await assert.rejects(controller.endpoint.write(endpointId, cluster, attribute, 1), (error: unknown) => {
                assert.ok(error instanceof AttributeNotFoundError);
                assert.deepEqual(error.data, { endpointId, clusterId: cluster, attributeId: attribute });
                return true;
            });
        });
    }

    test("invoke returns the fields of the response of a command that responds with data", async (t) => {
        const { controller, endpointId } = await commissionLight(t);

        const response = await controller.endpoint.invoke(endpointId, GROUPS, GET_GROUP_MEMBERSHIP_COMMAND, {
            groupList: [],
        });

        assert.deepEqual(response, { capacity: 254, groupList: [] });
    });

    test("invoke throws InteractionRejectedError with the status of the cluster that the device refuses with", async (t) => {
        const network = new TestNetwork(t);
        const bridge = await network.startBridge();
        const { number } = await bridge.add(
            new Endpoint(OnOffLightDevice.with(RefusingOnOffServer), { id: "refusing" }),
        );
        const { controller } = await network.startController();
        const { nodeId } = await controller.node.commission(bridge.manualCode);
        const endpointId = toEndpointId(nodeId, number);

        await assert.rejects(controller.endpoint.invoke(endpointId, ON_OFF, TOGGLE_COMMAND), (error: unknown) => {
            assert.ok(error instanceof InteractionRejectedError);
            assert.equal(error.code, "INTEGRATION_ERROR");
            assert.deepEqual(error.data, {
                endpointId,
                clusterId: ON_OFF,
                commandId: TOGGLE_COMMAND,
                status: Status.Failure,
                clusterStatus: CLUSTER_STATUS,
            });
            return true;
        });
    });

    test("invoke returns null for a command that responds without data", async (t) => {
        const { controller, endpointId } = await commissionLight(t);

        assert.equal(await controller.endpoint.invoke(endpointId, ON_OFF, TOGGLE_COMMAND), null);
    });

    test("reports the change of an attribute that a command causes on the device", async (t) => {
        const { controller, bus, endpointId } = await commissionLight(t);
        const changed = bus.next("$endpoint:attribute-changed", ({ attributeId }) => attributeId === ON_OFF_ATTRIBUTE);

        await controller.endpoint.invoke(endpointId, ON_OFF, TOGGLE_COMMAND);

        assert.deepEqual(await changed, { endpointId, clusterId: ON_OFF, attributeId: ON_OFF_ATTRIBUTE, value: true });
    });

    test("round-trips tagged bytes and integers through a device", async (t) => {
        const { controller, endpointId } = await commissionMessages(t);

        await controller.endpoint.invoke(endpointId, MESSAGES, PRESENT_MESSAGES_REQUEST, {
            ...MESSAGE,
            duration: { $integer: "9007199254740993" },
        });

        const messages = await controller.endpoint.read(endpointId, MESSAGES, MESSAGES_ATTRIBUTE);
        assert.ok(Array.isArray(messages));
        const [message] = messages;
        assert.ok(typeof message === "object" && message !== null && !Array.isArray(message));
        assert.deepEqual(message.messageId, MESSAGE.messageId);
        assert.deepEqual(message.duration, { $integer: "9007199254740993" });
    });

    test("invoke throws ValidationError for args that do not fit the command", async (t) => {
        const { controller, endpointId } = await commissionLight(t);

        await assert.rejects(
            controller.endpoint.invoke(endpointId, ON_OFF, ON_COMMAND, { extra: 1 }),
            (error: unknown) => {
                assert.deepEqual(issuePaths(error), ["args"]);
                return true;
            },
        );
    });

    const absentCommands = [
        { title: "a command that the cluster does not have", cluster: ON_OFF, command: 0x99 },
        { title: "a command of a vendor cluster that the endpoint lacks", cluster: VENDOR_CLUSTER, command: 0 },
    ];
    for (const { title, cluster, command } of absentCommands) {
        test(`invoke throws CommandNotFoundError for ${title}`, async (t) => {
            const { controller, endpointId } = await commissionLight(t);

            await assert.rejects(controller.endpoint.invoke(endpointId, cluster, command), (error: unknown) => {
                assert.ok(error instanceof CommandNotFoundError);
                assert.deepEqual(error.data, { endpointId, clusterId: cluster, commandId: command });
                return true;
            });
        });
    }

    test("describe returns the device type, and the attributes and accepted commands of each cluster", async (t) => {
        const { controller, endpointId } = await commissionLight(t);

        const shape = controller.endpoint.describe(endpointId);

        assert.equal(shape.deviceType, 0x0100);
        const onOff = shape.clusters.find(({ id }) => id === ON_OFF);
        assert.ok(onOff !== undefined);
        assert.deepEqual(
            onOff.attributes.find(({ id }) => id === ON_OFF_ATTRIBUTE),
            { id: ON_OFF_ATTRIBUTE, value: false },
        );
        for (const command of [OFF_COMMAND, ON_COMMAND, TOGGLE_COMMAND]) {
            assert.ok(onOff.acceptedCommands.includes(command));
        }
    });

    test("describe leaves the global attributes out of every cluster", async (t) => {
        const { controller, endpointId } = await commissionLight(t);

        const { clusters } = controller.endpoint.describe(endpointId);

        assert.ok(clusters.length > 1);
        for (const { attributes } of clusters) {
            assert.deepEqual(
                attributes.filter(({ id }) => GLOBAL_ATTRIBUTES.has(id)),
                [],
            );
        }
    });

    test("describe returns the structs of the cluster as plain objects", async (t) => {
        const { controller, endpointId } = await commissionLight(t);

        const descriptor = controller.endpoint.describe(endpointId).clusters.find(({ id }) => id === 0x1d);
        const deviceTypes = descriptor?.attributes.find(({ id }) => id === 0)?.value;

        assert.ok(Array.isArray(deviceTypes));
        const [first] = deviceTypes;
        assert.ok(typeof first === "object" && first !== null && !Array.isArray(first));
        assert.equal(Object.getPrototypeOf(first), Object.prototype);
        assert.equal(first.deviceType, 0x0100);
    });

    test("describe answers for a node whose device is off, from what the SDK stored", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode, device } = await network.startDevice();
        const { nodeId, restarted } = await network.commissionAndRestart(manualCode);
        await device.close();
        await restarted.controller.start();

        const shape = restarted.controller.endpoint.describe(toEndpointId(nodeId, 1));

        assert.notEqual(restarted.controller.node.connectionOf(nodeId), "connected");
        assert.equal(shape.deviceType, 0x0100);
        const onOff = shape.clusters.find(({ id }) => id === ON_OFF);
        assert.deepEqual(
            onOff?.attributes.find(({ id }) => id === ON_OFF_ATTRIBUTE),
            { id: ON_OFF_ATTRIBUTE, value: false },
        );
    });

    test("describe names the aggregator as the parent of a bridged light, and none for the aggregator", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startBridge();
        const { controller } = await network.startController();
        const { nodeId, endpoints } = await controller.node.commission(manualCode);
        const [aggregator, ...lights] = endpoints.map(({ number }) => toEndpointId(nodeId, number));
        assert.ok(aggregator !== undefined);
        assert.equal(lights.length, 2);

        assert.equal(controller.endpoint.describe(aggregator).parentId, null);
        for (const light of lights) {
            assert.equal(controller.endpoint.describe(light).parentId, aggregator);
        }
    });

    test("describe names the strip as the parent of its outlets, and the aggregator as the parent of the strip", async (t) => {
        const network = new TestNetwork(t);
        const bridge = await network.startBridge();
        await bridge.addStrip("strip");
        const { controller } = await network.startController();
        const { nodeId, endpoints } = await controller.node.commission(bridge.manualCode);
        // The aggregator, the two lights, and then the strip with its outlets.
        const [aggregator, , , strip, ...outlets] = endpoints.map(({ number }) => toEndpointId(nodeId, number));
        assert.ok(aggregator !== undefined && strip !== undefined);
        assert.equal(outlets.length, 2);

        assert.equal(controller.endpoint.describe(strip).parentId, aggregator);
        for (const outlet of outlets) {
            assert.equal(controller.endpoint.describe(outlet).parentId, strip);
        }
    });

    test("reports only the attributes with a value among the properties of a change", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const peer = await network.peer(manualCode);
        const bus = new RecordingBus();
        gatewayOver(t, peer, bus);

        // The tag list is optional and the light has none, and the attribute list is global, so not in the cluster.
        reportChange(peer.endpoints.for(1), "descriptor", ["tagList", "attributeList", "partsList"]);

        assert.deepEqual(attributeIdsOf(bus), [DESCRIPTOR_PARTS_LIST]);
    });

    test("reports every attribute with a value for a change that names no properties", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const peer = await network.peer(manualCode);
        const bus = new RecordingBus();
        gatewayOver(t, peer, bus);

        reportChange(peer.endpoints.for(1), "descriptor");

        assert.deepEqual(new Set(attributeIdsOf(bus)), new Set(DESCRIPTOR_ATTRIBUTES_WITH_VALUE));
    });

    test("reports null for a value that a device reports as NaN", async (t) => {
        const { sensor, bus, endpointId } = await startSensor(t, 400);
        const reported = bus.next(
            "$endpoint:attribute-changed",
            (change) => change.clusterId === CO2_MEASUREMENT && change.attributeId === MEASURED_VALUE,
        );

        await sensor.set({ carbonDioxideConcentrationMeasurement: { measuredValue: Number.NaN } });

        assert.deepEqual(await reported, {
            endpointId,
            clusterId: CO2_MEASUREMENT,
            attributeId: MEASURED_VALUE,
            value: null,
        });
    });

    test("describe answers with null for an attribute that a device reports as NaN", async (t) => {
        const { gateway, endpointId } = await startSensor(t, Number.NaN);

        const measurement = gateway.describe(endpointId).clusters.find(({ id }) => id === CO2_MEASUREMENT);
        assert.deepEqual(
            measurement?.attributes.find(({ id }) => id === MEASURED_VALUE),
            { id: MEASURED_VALUE, value: null },
        );
    });

    test("reports nothing of the root of a node", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const peer = await network.peer(manualCode);
        const bus = new RecordingBus();
        gatewayOver(t, peer, bus);

        reportChange(peer, "descriptor");

        assert.deepEqual(bus.emitted, []);
    });

    test("reports nothing of a node that is being deleted", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const peer = await network.peer(manualCode);
        const bus = new RecordingBus();
        gatewayOver(t, peer, bus);
        const light = peer.endpoints.for(1);
        let reported = false;
        // @matter/node 0.18.0: when the node starts to be destroyed, it is gone and its endpoints are still exposed.
        peer.lifecycle.changed.on(() => {
            if (!reported && peer.lifecycle.isGone && !light.lifecycle.isGone) {
                reported = true;
                reportChange(light, "descriptor");
            }
        });

        await peer.delete();

        assert.ok(reported);
        assert.deepEqual(bus.emitted, []);
    });

    test("reports nothing of a Matter event", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const peer = await network.peer(manualCode);
        const bus = new RecordingBus();
        gatewayOver(t, peer, bus);
        const endpoint = peer.endpoints.for(1);
        const behavior = endpoint.behaviors.supported["descriptor"];
        assert.ok(behavior !== undefined);

        serviceOf(endpoint).change.emit({
            kind: "event",
            endpoint,
            behavior,
            event: new EventModel({ name: "Test", id: 0 }),
            number: EventNumber(1),
            timestamp: Timestamp(0),
            timestampKind: "epoch",
            priority: Priority.Info,
        });

        assert.deepEqual(bus.emitted, []);
    });

    test("reports nothing after close()", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const peer = await network.peer(manualCode);
        const closedBus = new RecordingBus();
        const openBus = new RecordingBus();
        gatewayOver(t, peer, closedBus).close();
        const open = gatewayOver(t, peer, openBus);
        const endpointId = idOf(peer, 1);
        const changed = openBus.next("$endpoint:attribute-changed", (change) => change.endpointId === endpointId);

        await open.invoke(endpointId, ON_OFF, ON_COMMAND);
        await changed;

        assert.deepEqual(closedBus.emitted, []);
    });
});
