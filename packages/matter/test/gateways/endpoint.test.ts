import "../../src/sdk-config.ts";
import assert from "node:assert/strict";
import { describe, type TestContext, test } from "node:test";

import { Status } from "@matter/main/types";

import { ValidationError } from "@nedalto/contract/common/errors.ts";
import { createEndpointId, type EndpointId } from "@nedalto/contract/common/ids.ts";
import {
    AttributeNotFoundError,
    CommandNotFoundError,
    EndpointNotFoundError,
    InteractionRejectedError,
} from "@nedalto/contract/endpoint/errors.ts";
import type { EndpointGateway } from "@nedalto/contract/endpoint/ports.ts";
import type { AttributeValue } from "@nedalto/contract/endpoint/types.ts";

import { TestNetwork } from "../helpers/network.ts";

const ON_OFF = 0x06;
const ON_OFF_ATTRIBUTE = 0x0000;
const ON_TIME_ATTRIBUTE = 0x4001;
const OFF_COMMAND = 0x00;
const ON_COMMAND = 0x01;
const TOGGLE_COMMAND = 0x02;
// The Thermostat is in the specification, but a light does not have it.
const THERMOSTAT = 0x0201;
const OCCUPIED_HEATING_SETPOINT = 0x12;
const SETPOINT_RAISE_LOWER_COMMAND = 0x00;
// A cluster of a manufacturer, which is not in the specification.
const VENDOR_CLUSTER = 0xfff1fc01;
// Ids that Matter cannot address: a cluster with a vendor prefix and a suffix that is not for a manufacturer,
// an attribute above the range of a cluster, a command above 255.
const UNADDRESSABLE_CLUSTER = 0x99999999;
const UNADDRESSABLE_ATTRIBUTE = 0x9999;
const UNADDRESSABLE_COMMAND = 0x100;
const GLOBAL_ATTRIBUTES = new Set([0xfff8, 0xfff9, 0xfffa, 0xfffb, 0xfffc, 0xfffd]);

/** A started controller that has commissioned a light, which is its only endpoint. */
async function commissionLight(t: TestContext) {
    const network = new TestNetwork(t);
    const { manualCode } = await network.startDevice();
    const started = await network.startController();
    const { endpoints } = await started.controller.node.commission(manualCode);
    const [light] = endpoints;
    assert.ok(light !== undefined);
    return { ...started, network, manualCode, endpointId: light.id };
}

const issuePaths = (error: unknown): unknown[] | undefined => {
    assert.ok(error instanceof ValidationError);
    assert.equal(error.code, "VALIDATION_ERROR");
    const issues = error.data?.issues;
    assert.ok(Array.isArray(issues));
    return issues.map((issue) => {
        assert.ok(typeof issue === "object" && issue !== null && !Array.isArray(issue));
        return issue.path;
    });
};

describe("MatterEndpointGateway", () => {
    const unknownEndpointCases: { name: string; call: (gateway: EndpointGateway, id: EndpointId) => unknown }[] = [
        { name: "read", call: (gateway, id) => gateway.read(id, ON_OFF, ON_OFF_ATTRIBUTE) },
        { name: "write", call: (gateway, id) => gateway.write(id, ON_OFF, ON_TIME_ATTRIBUTE, 30) },
        { name: "invoke", call: (gateway, id) => gateway.invoke(id, ON_OFF, ON_COMMAND) },
        { name: "describe", call: (gateway, id) => gateway.describe(id) },
    ];
    for (const { name, call } of unknownEndpointCases) {
        test(`${name} throws EndpointNotFoundError for an unknown endpoint`, async (t) => {
            const { controller } = await commissionLight(t);
            const unknown = createEndpointId();

            await assert.rejects(async () => call(controller.endpoint, unknown), EndpointNotFoundError);
        });
    }

    test("read returns the value of an attribute", async (t) => {
        const { controller, endpointId } = await commissionLight(t);

        assert.equal(await controller.endpoint.read(endpointId, ON_OFF, ON_OFF_ATTRIBUTE), false);
    });

    const notServedCases = [
        { title: "an attribute that the cluster of the endpoint lacks", cluster: ON_OFF, attribute: 0x0005 },
        { title: "a cluster that the endpoint lacks", cluster: THERMOSTAT, attribute: OCCUPIED_HEATING_SETPOINT },
    ];
    for (const { title, cluster, attribute } of notServedCases) {
        test(`read throws AttributeNotFoundError for ${title}`, async (t) => {
            const { controller, endpointId } = await commissionLight(t);

            await assert.rejects(controller.endpoint.read(endpointId, cluster, attribute), (error: unknown) => {
                assert.ok(error instanceof AttributeNotFoundError);
                assert.equal(error.code, "NOT_FOUND_ERROR");
                assert.deepEqual(error.data, { endpointId, clusterId: cluster, attributeId: attribute });
                return true;
            });
        });
    }

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

    test("write throws AttributeNotFoundError for an attribute of a cluster that the endpoint lacks", async (t) => {
        const { controller, endpointId } = await commissionLight(t);

        await assert.rejects(
            controller.endpoint.write(endpointId, THERMOSTAT, OCCUPIED_HEATING_SETPOINT, 2000),
            (error: unknown) => {
                assert.ok(error instanceof AttributeNotFoundError);
                assert.deepEqual(error.data, {
                    endpointId,
                    clusterId: THERMOSTAT,
                    attributeId: OCCUPIED_HEATING_SETPOINT,
                });
                return true;
            },
        );
    });

    const misfitValues = [
        { title: "a string for a number", value: "thirty" },
        { title: "a number above the range of the type", value: 70_000 },
        { title: "null for a type that is not nullable", value: null },
    ];
    for (const { title, value } of misfitValues) {
        test(`write throws ValidationError for ${title}`, async (t) => {
            const { controller, endpointId } = await commissionLight(t);

            await assert.rejects(
                controller.endpoint.write(endpointId, ON_OFF, ON_TIME_ATTRIBUTE, value),
                (error: unknown) => {
                    assert.deepEqual(issuePaths(error), ["value"]);
                    return true;
                },
            );
        });
    }

    const notInSpecification = [
        { title: "an attribute that the cluster does not define", cluster: ON_OFF, attribute: 0x0999 },
        { title: "an attribute of a cluster outside the specification", cluster: VENDOR_CLUSTER, attribute: 0 },
    ];
    for (const { title, cluster, attribute } of notInSpecification) {
        test(`write throws AttributeNotFoundError for ${title}`, async (t) => {
            const { controller, endpointId } = await commissionLight(t);

            await assert.rejects(controller.endpoint.write(endpointId, cluster, attribute, 1), (error: unknown) => {
                assert.ok(error instanceof AttributeNotFoundError);
                assert.deepEqual(error.data, { endpointId, clusterId: cluster, attributeId: attribute });
                return true;
            });
        });
    }

    test("invoke runs a command, and the change it causes is announced as endpoint:changed", async (t) => {
        const { controller, bus, endpointId } = await commissionLight(t);
        const before = Date.now();
        const changed = bus.next("endpoint:changed", ({ attributeId }) => attributeId === ON_OFF_ATTRIBUTE);

        await controller.endpoint.invoke(endpointId, ON_OFF, ON_COMMAND);

        const { timestamp, ...event } = await changed;
        assert.deepEqual(event, { endpointId, clusterId: ON_OFF, attributeId: ON_OFF_ATTRIBUTE, value: true });
        assert.ok(timestamp >= before && timestamp <= Date.now());
        assert.equal(await controller.endpoint.read(endpointId, ON_OFF, ON_OFF_ATTRIBUTE), true);
    });

    test("invoke throws CommandNotFoundError for a command of a cluster that the endpoint lacks", async (t) => {
        const { controller, endpointId } = await commissionLight(t);

        await assert.rejects(
            controller.endpoint.invoke(endpointId, THERMOSTAT, SETPOINT_RAISE_LOWER_COMMAND, { mode: 0, amount: 1 }),
            (error: unknown) => {
                assert.ok(error instanceof CommandNotFoundError);
                assert.deepEqual(error.data, {
                    endpointId,
                    clusterId: THERMOSTAT,
                    commandId: SETPOINT_RAISE_LOWER_COMMAND,
                });
                return true;
            },
        );
    });

    const misfitArguments: { title: string; cluster: number; command: number; args: AttributeValue }[] = [
        { title: "a field that the command does not have", cluster: ON_OFF, command: ON_COMMAND, args: { extra: 1 } },
        {
            title: "a mandatory field that is missing",
            cluster: THERMOSTAT,
            command: SETPOINT_RAISE_LOWER_COMMAND,
            args: { mode: 0 },
        },
    ];
    for (const { title, cluster, command, args } of misfitArguments) {
        test(`invoke throws ValidationError for ${title}`, async (t) => {
            const { controller, endpointId } = await commissionLight(t);

            await assert.rejects(controller.endpoint.invoke(endpointId, cluster, command, args), (error: unknown) => {
                assert.deepEqual(issuePaths(error), ["args"]);
                return true;
            });
        });
    }

    const commandsNotInSpecification = [
        { title: "a command that the cluster does not define", cluster: ON_OFF, command: 0x99 },
        { title: "a command of a cluster outside the specification", cluster: VENDOR_CLUSTER, command: 0 },
    ];
    for (const { title, cluster, command } of commandsNotInSpecification) {
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

    test("describe answers for a node that is unreachable, from what the SDK stored", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode, device } = await network.startDevice();
        const { node, endpoints, restarted } = await network.commissionAndRestart(manualCode);
        await device.close();
        await restarted.controller.start();
        const [light] = endpoints;
        assert.ok(light !== undefined);

        const shape = restarted.controller.endpoint.describe(light.id);

        assert.equal(restarted.controller.node.isReachable(node.id), false);
        assert.equal(shape.deviceType, 0x0100);
        const onOff = shape.clusters.find(({ id }) => id === ON_OFF);
        assert.deepEqual(
            onOff?.attributes.find(({ id }) => id === ON_OFF_ATTRIBUTE),
            { id: ON_OFF_ATTRIBUTE, value: false },
        );
    });

    test("commission of a bridge registers the nested endpoints, and read works on one of them", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startBridge();
        const { controller } = await network.startController();

        const { endpoints } = await controller.node.commission(manualCode);

        // The aggregator, and the two lights that hang from it.
        const nested = endpoints.toSorted((a, b) => a.matterNumber - b.matterNumber);
        assert.deepEqual(
            nested.map(({ id }) => controller.endpoint.describe(id).deviceType),
            [0x000e, 0x0100, 0x0100],
        );
        const lastLight = nested.at(-1);
        assert.ok(lastLight !== undefined);
        assert.equal(await controller.endpoint.read(lastLight.id, ON_OFF, ON_OFF_ATTRIBUTE), false);
    });
});
