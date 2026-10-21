// Before any other "@matter/main" import: see sdk-config.ts.
import "./sdk-config.ts";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import type { TestContext } from "node:test";

import { Endpoint, Environment, LogDestination, LogFormat, Logger, ServerNode, VendorId } from "@matter/main";
import { OnOffLightDevice } from "@matter/main/devices";

import { defer, scratchDirectory } from "./cleanup.ts";

export interface SimulatedLight {
    /** The 11-digit code printed on a device's label. */
    readonly manualPairingCode: string;

    /** The `MT:` payload of the label's QR image. */
    readonly qrPairingCode: string;

    /** Whether the light is on, read from the device and not through the hub. */
    readonly isOn: () => boolean;

    /** Switches the light at the device, as a wall switch would. */
    readonly setOn: (on: boolean) => Promise<void>;
}

// The hub's controller takes the Matter port 5540, so a device on the same host needs another.
const DEVICE_PORT = 5541;

// Any passcode and discriminator the specification allows.
const PASSCODE = 20202021;
const DISCRIMINATOR = 3840;

/**
 * An On/Off light on the real network, with its storage and its SDK log in a directory of its own.
 * Closed when the test ends, so start it before the hub: the hub then stops first.
 */
export async function startLight(context: TestContext): Promise<SimulatedLight> {
    const directory = await scratchDirectory(context, "nedalto-e2e-light-");

    // @matter/nodejs 0.17.9: the filesystem reads `storage.path` each time it opens a file.
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
        id: "light",
        network: { port: DEVICE_PORT },
        commissioning: { passcode: PASSCODE, discriminator: DISCRIMINATOR },
        basicInformation: {
            vendorName: "Nedalto",
            vendorId: VendorId(0xfff1),
            productName: "Nedalto E2E Light",
            productId: 0x8000,
            nodeLabel: "Bedside",
        },
    });
    defer(context, () => node.close());
    const light = new Endpoint(OnOffLightDevice, { id: "onoff" });
    await node.add(light);
    await node.start();

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
