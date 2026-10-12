import "../../src/sdk-config.ts";
import type { TestContext } from "node:test";

import {
    Crypto,
    Entropy,
    Environment,
    Logger,
    LogLevel,
    MockCrypto,
    MockStorageService,
    Network,
    NetworkSimulator,
    StorageService,
    VendorId,
} from "@matter/main";
import { OnOffLightDevice } from "@matter/main/devices/on-off-light";
import { ServerNode } from "@matter/main/node";

import type { NodeRecord } from "@nedalto/contract/node/types.ts";

import { SdkMatterController } from "../../src/controller.ts";
import { RecordingBus } from "./bus.ts";
import { defer } from "./cleanup.ts";
import { RecordingLogger } from "./logger.ts";
import { MemoryNodeRepository } from "./repository.ts";

// The tests do not configure the SDK's logger, which would print every debug line of every node.
Logger.level = LogLevel.FATAL;

export interface TestDevice {
    readonly device: ServerNode;
    readonly manualCode: string;
    readonly qrCode: string;
}

export interface TestController {
    readonly controller: SdkMatterController;
    readonly bus: RecordingBus;
    readonly logger: RecordingLogger;
    readonly nodeRepository: MemoryNodeRepository;
}

/** A simulated network with its own hosts, devices and controllers, closed when the test ends. */
export class TestNetwork {
    readonly #context: TestContext;
    readonly #simulator = new NetworkSimulator();
    readonly #controllers: SdkMatterController[] = [];
    #hosts = 0;

    constructor(context: TestContext) {
        this.#context = context;
        // Registered first, so it runs after the devices are closed: a device closed while a controller
        // still holds a session with it takes about 5 seconds.
        defer(context, async () => {
            await Promise.all(this.#controllers.map((controller) => controller.stop()));
        });
    }

    /** An environment on a new host of the network, with crypto and storage that run in memory. */
    environment(): Environment {
        const index = ++this.#hosts;
        const environment = new Environment(`test-${index}`);
        const crypto = MockCrypto(index);
        environment.set(Entropy, crypto);
        environment.set(Crypto, crypto);
        environment.set(StorageService, new MockStorageService(environment));
        environment.set(Network, this.#simulator.addHost(index));
        return environment;
    }

    /** A controller that is not started, and is stopped when the test ends if it was. */
    controller(environment: Environment = this.environment()): TestController {
        const bus = new RecordingBus();
        const logger = new RecordingLogger();
        const nodeRepository = new MemoryNodeRepository();
        const controller = new SdkMatterController(environment, { logger, nodeRepository, bus });
        this.#controllers.push(controller);
        return { controller, bus, logger, nodeRepository };
    }

    /** A started controller. */
    async startController(environment?: Environment): Promise<TestController> {
        const started = this.controller(environment);
        await started.controller.start();
        return started;
    }

    /**
     * Commissions the device with a controller and stops it, and returns a controller that is not started,
     * on the same environment and so with the same storage, whose repository holds the node.
     */
    async commissionAndRestart(manualCode: string): Promise<{ node: NodeRecord; restarted: TestController }> {
        const environment = this.environment();
        const { controller } = await this.startController(environment);
        const { node } = await controller.node.commission(manualCode);
        await controller.stop();
        const restarted = this.controller(environment);
        restarted.nodeRepository.save(node);
        return { node, restarted };
    }

    /** A started on/off light, closed when the test ends. */
    async startDevice({ nodeLabel = "", productName = "Test Light" } = {}): Promise<TestDevice> {
        const index = this.#hosts + 1;
        const device = await ServerNode.create({
            environment: this.environment(),
            id: `device-${index}`,
            // Distinct per device, so that they do not answer each other's discovery.
            commissioning: { passcode: 20202021 + index, discriminator: 3840 + index },
            basicInformation: {
                vendorName: "Nedalto Test",
                vendorId: VendorId(0xfff1),
                productName,
                nodeLabel,
                productId: 0x8000,
                hardwareVersion: 2,
                softwareVersion: 3,
                softwareVersionString: "3.0.0",
            },
        });
        await device.add(OnOffLightDevice);
        defer(this.#context, () => device.close());
        await device.start();
        const { manualPairingCode, qrPairingCode } = device.state.commissioning.pairingCodes;
        return { device, manualCode: manualPairingCode, qrCode: qrPairingCode };
    }
}
