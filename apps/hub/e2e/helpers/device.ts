// Before any other "@matter/main" import: see sdk-config.ts.
import "./sdk-config.ts";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import type { TestContext } from "node:test";

import { Endpoint, Environment, LogDestination, LogFormat, Logger, ServerNode, VendorId } from "@matter/main";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors/bridged-device-basic-information";
import { OnOffLightDevice } from "@matter/main/devices";
import { AggregatorEndpoint } from "@matter/main/endpoints";

import { defer, scratchDirectory } from "./cleanup.ts";

interface PairingCodes {
    /** The 11-digit code printed on a device's label. */
    readonly manualPairingCode: string;

    /** The `MT:` payload of the label's QR image. */
    readonly qrPairingCode: string;
}

export interface SimulatedLight extends PairingCodes {
    /** Whether the light is on, read from the device and not through the hub. */
    readonly isOn: () => boolean;

    /** Switches the light at the device, as a wall switch would. */
    readonly setOn: (on: boolean) => Promise<void>;
}

/** A light behind a bridge, which the bridge can gain and lose while it runs. */
export interface BridgedLight {
    /** What the light reports as its Unique ID, by which a client can tell it from the other endpoints of the bridge. */
    readonly uniqueId: string;

    /** Switches the light at the device, as a wall switch would. */
    readonly setOn: (on: boolean) => Promise<void>;

    /** Takes the light out of the bridge. */
    readonly remove: () => Promise<void>;
}

export interface SimulatedBridge extends PairingCodes {
    /** Adds a light that is off under the aggregator, also while the bridge runs. */
    readonly addLight: (name: string) => Promise<BridgedLight>;
}

// Any passcode and discriminator the specification allows.
const PASSCODE = 20202021;
const DISCRIMINATOR = 3840;

const BridgedOnOffLight = OnOffLightDevice.with(BridgedDeviceBasicInformationServer);

// A started node on the real network, with its storage and its SDK log in a directory of its own, closed when the test
// ends.
async function startNode(
    context: TestContext,
    id: string,
    { productName, nodeLabel }: { productName: string; nodeLabel: string },
    populate: (node: ServerNode) => Promise<void>,
): Promise<ServerNode> {
    const directory = await scratchDirectory(context, `nedalto-e2e-${id}-`);

    // @matter/nodejs 0.18.0: the filesystem reads `storage.path` each time it opens a file.
    const environment = Environment.default;
    environment.vars.set("storage.path", directory);

    const log = createWriteStream(join(directory, "matter.log"));
    defer(context, () => new Promise((resolve) => log.end(resolve)));
    Logger.destinations.default = LogDestination({
        write: (text) => {
            log.write(`${text}\n`);
        },
    });
    Logger.format = LogFormat.PLAIN;

    const node = await ServerNode.create({
        id,
        commissioning: { passcode: PASSCODE, discriminator: DISCRIMINATOR },
        basicInformation: {
            vendorName: "Nedalto",
            vendorId: VendorId(0xfff1),
            productName,
            productId: 0x8000,
            nodeLabel,
        },
    });
    defer(context, () => node.close());
    await populate(node);
    await node.start();
    return node;
}

/**
 * An On/Off light on the real network.
 * Closed when the test ends, so start it before the hub: the hub then stops first.
 */
export async function startLight(context: TestContext): Promise<SimulatedLight> {
    const light = new Endpoint(OnOffLightDevice, { id: "onoff" });
    const node = await startNode(
        context,
        "light",
        { productName: "Nedalto E2E Light", nodeLabel: "Bedside" },
        async (created) => {
            await created.add(light);
        },
    );

    const { manualPairingCode, qrPairingCode } = node.state.commissioning.pairingCodes;
    return {
        manualPairingCode,
        qrPairingCode,
        isOn: () => light.stateOf(OnOffLightDevice.behaviors.onOff).onOff,
        setOn: async (on) => {
            await light.setStateOf(OnOffLightDevice.behaviors.onOff, { onOff: on });
        },
    };
}

/**
 * A bridge on the real network, with an aggregator and one light behind it.
 * Closed when the test ends, so start it before the hub: the hub then stops first.
 */
export async function startBridge(context: TestContext): Promise<SimulatedBridge> {
    const aggregator = new Endpoint(AggregatorEndpoint, { id: "aggregator" });

    const addLight = async (name: string): Promise<BridgedLight> => {
        const uniqueId = `nedalto-e2e-${name}`;
        const light = new Endpoint(BridgedOnOffLight, {
            id: name,
            bridgedDeviceBasicInformation: { nodeLabel: `E2E ${name}`, uniqueId, reachable: true },
        });
        await aggregator.add(light);
        return {
            uniqueId,
            setOn: async (on) => {
                await light.setStateOf(BridgedOnOffLight.behaviors.onOff, { onOff: on });
            },
            remove: () => light.delete(),
        };
    };

    const node = await startNode(
        context,
        "bridge",
        { productName: "Nedalto E2E Bridge", nodeLabel: "Hallway" },
        async (created) => {
            await created.add(aggregator);
            await addLight("ceiling");
        },
    );

    const { manualPairingCode, qrPairingCode } = node.state.commissioning.pairingCodes;
    return { manualPairingCode, qrPairingCode, addLight };
}
