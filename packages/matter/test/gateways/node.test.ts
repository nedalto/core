import "../../src/sdk-config.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { VendorId } from "@matter/main";
import { CommissioningFlowType, QrPairingCodeCodec } from "@matter/main/types";

import { ValidationError } from "@nedalto/contract/common/errors.ts";
import { createNodeId } from "@nedalto/contract/common/ids.ts";
import { NodeNotFoundError } from "@nedalto/contract/node/errors.ts";

import { TestNetwork } from "../helpers/network.ts";

const isInvalidSetupCode =
    (message: RegExp) =>
    (error: unknown): boolean => {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.code, "VALIDATION_ERROR");
        const issues = error.data?.issues;
        assert.ok(Array.isArray(issues) && issues.length === 1);
        const [issue] = issues;
        assert.ok(typeof issue === "object" && issue !== null && !Array.isArray(issue));
        assert.equal(issue.path, "setupCode");
        assert.match(String(issue.message), message);
        return true;
    };

describe("SdkNodeGateway", () => {
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

    test("decommission does not announce the node leaving the fabric as a disconnection", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const { controller, bus } = await network.startController();
        const { node } = await controller.node.commission(manualCode);

        await controller.node.decommission(node.id);

        assert.deepEqual(bus.emitted, []);
    });

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

    test("isReachable is true for a node that is connected", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const { controller } = await network.startController();
        const { node } = await controller.node.commission(manualCode);

        assert.equal(controller.node.isReachable(node.id), true);
    });

    test("isReachable is false for an unknown node", async (t) => {
        const network = new TestNetwork(t);
        const { controller } = await network.startController();

        assert.equal(controller.node.isReachable(createNodeId()), false);
    });

    // A device that goes away is detected by the SDK about 13 seconds later, which is too long for a test.
    test("announces node:connected when a known node connects", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const { node, restarted } = await network.commissionAndRestart(manualCode);
        const connected = restarted.bus.next("node:connected");

        await restarted.controller.start();

        assert.equal((await connected).nodeId, node.id);
        assert.equal(restarted.controller.node.isReachable(node.id), true);
    });
});
