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
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors/bridged-device-basic-information";
import { OnOffLightDevice } from "@matter/main/devices/on-off-light";
import { OnOffPlugInUnitDevice } from "@matter/main/devices/on-off-plug-in-unit";
import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";
import { BridgedNodeEndpoint } from "@matter/main/endpoints/bridged-node";
import { type ClientNode, type CommissioningClient, ControllerBehavior, Endpoint, ServerNode } from "@matter/main/node";

import type { NodeId } from "@nedalto/contract/common/ids.ts";

import { MatterController } from "../../src/controller.ts";
import { RecordingBus } from "./bus.ts";
import { defer } from "./cleanup.ts";
import { QuietLogger } from "./logger.ts";

// The tests do not configure the SDK's logger, which would print every debug line of every node.
Logger.level = LogLevel.FATAL;

export interface TestDevice {
    readonly device: ServerNode;
    readonly manualCode: string;
    readonly qrCode: string;
}

/** A bridge whose devices can come and go while it runs. */
export interface TestBridge extends TestDevice {
    /** Adds a bridged light that is on, under the aggregator, so its state cannot be mistaken for a default. */
    readonly addLight: (id: string, number?: number) => Promise<Endpoint>;

    /** Adds `endpoint` under the aggregator, for a shape the other helpers do not build. */
    readonly add: (endpoint: Endpoint) => Promise<Endpoint>;

    /**
     * Adds a bridged power strip under the aggregator, in one go with the two on/off outlets that hang from it.
     * With `numbers`, it holds the first and the outlets the others, as an endpoint number says nothing of its place.
     */
    readonly addStrip: (id: string, numbers?: readonly [number, number, number]) => Promise<Endpoint>;
}

export interface TestController {
    readonly controller: MatterController;
    readonly bus: RecordingBus;
}

const bridgedInformation = (id: string, productName: string) => ({
    nodeLabel: id,
    productName,
    uniqueId: id,
    reachable: true,
});

/** Resolves once the node of the controller is connected, which it is not yet when its commissioning returns. */
export async function untilConnected({ controller, bus }: TestController, nodeId: NodeId): Promise<void> {
    if (controller.node.connectionOf(nodeId) !== "connected") {
        await bus.next(
            "$node:connection-changed",
            (change) => change.nodeId === nodeId && change.connection === "connected",
        );
    }
}

/** A simulated network with its own hosts, devices and controllers, closed when the test ends. */
export class TestNetwork {
    readonly #context: TestContext;
    readonly #simulator = new NetworkSimulator();
    readonly #controllers: MatterController[] = [];
    readonly #peerServers: ServerNode[] = [];
    #hosts = 0;

    constructor(context: TestContext) {
        this.#context = context;
        // Registered first, so it runs after the devices are closed: a device closed while a controller
        // still holds a session with it takes about 5 seconds.
        defer(context, async () => {
            await Promise.all([
                ...this.#controllers.map((controller) => controller.stop()),
                ...this.#peerServers.map((server) => server.close()),
            ]);
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
        const controller = new MatterController(environment, { logger: new QuietLogger(), bus }, "0.0.1");
        this.#controllers.push(controller);
        return { controller, bus };
    }

    /** A started controller. */
    async startController(environment?: Environment): Promise<TestController> {
        const started = this.controller(environment);
        await started.controller.start();
        return started;
    }

    /**
     * Commissions the device with a controller and stops it, and returns the id of the node and a controller that is
     * not started, on the same environment and so with the same storage.
     */
    async commissionAndRestart(manualCode: string): Promise<{ nodeId: NodeId; restarted: TestController }> {
        const environment = this.environment();
        const { controller } = await this.startController(environment);
        const { nodeId } = await controller.node.commission(manualCode);
        await controller.stop();
        return { nodeId, restarted: this.controller(environment) };
    }

    /**
     * The SDK node that a controller of its own holds for the device, which it has commissioned.
     * It is what the gateways would hold, for the tests that exercise a unit with SDK values.
     */
    async peer(
        manualCode: string,
        options: Partial<CommissioningClient.CommissioningOptions> = {},
    ): Promise<ClientNode> {
        const server = await this.controllerNode();
        await server.start();
        return server.peers.commission({ pairingCode: manualCode, ...options });
    }

    /**
     * An SDK controller node that is not started, closed when the test ends, for the tests that build a gateway over
     * it. On the same `environment` it has the same storage.
     */
    async controllerNode(environment: Environment = this.environment()): Promise<ServerNode> {
        const server = await ServerNode.create(ServerNode.RootEndpointWithoutGroupcast.with(ControllerBehavior), {
            environment,
            id: "peer-controller",
            commissioning: { enabled: false },
        });
        this.#peerServers.push(server);
        return server;
    }

    /** A started on/off light, closed when the test ends. */
    async startDevice({ nodeLabel = "", productName = "Test Light" } = {}): Promise<TestDevice> {
        return this.#startNode({ nodeLabel, productName }, (device) => device.add(OnOffLightDevice));
    }

    /**
     * A started bridge: an aggregator with two on/off lights hanging from it, closed when the test ends.
     * Its endpoints are nested, the lights under the aggregator.
     */
    async startBridge(): Promise<TestBridge> {
        const aggregator = new Endpoint(AggregatorEndpoint, { id: "aggregator" });
        const addEndpoint = async (endpoint: Endpoint): Promise<Endpoint> => {
            await aggregator.add(endpoint);
            return endpoint;
        };
        const addLight = (id: string, number?: number, onOff = true): Promise<Endpoint> =>
            addEndpoint(
                new Endpoint(OnOffLightDevice.with(BridgedDeviceBasicInformationServer), {
                    id,
                    number,
                    onOff: { onOff },
                    bridgedDeviceBasicInformation: bridgedInformation(id, "Bridged Light"),
                }),
            );
        const addStrip = (id: string, numbers?: readonly [number, number, number]): Promise<Endpoint> =>
            addEndpoint(
                new Endpoint(BridgedNodeEndpoint.with(BridgedDeviceBasicInformationServer), {
                    id,
                    number: numbers?.[0],
                    bridgedDeviceBasicInformation: bridgedInformation(id, "Bridged Strip"),
                    parts: [
                        new Endpoint(OnOffPlugInUnitDevice, { id: `${id}-outlet-1`, number: numbers?.[1] }),
                        new Endpoint(OnOffPlugInUnitDevice, { id: `${id}-outlet-2`, number: numbers?.[2] }),
                    ],
                }),
            );
        const started = await this.#startNode({ nodeLabel: "", productName: "Test Bridge" }, async (device) => {
            await device.add(aggregator);
            // One after the other, so that the endpoint numbers follow the order.
            await addLight("light-1", undefined, false);
            await addLight("light-2", undefined, false);
        });
        return { ...started, addLight, addStrip, add: addEndpoint };
    }

    async #startNode(
        { nodeLabel, productName }: { nodeLabel: string; productName: string },
        populate: (device: ServerNode) => Promise<unknown>,
    ): Promise<TestDevice> {
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
        await populate(device);
        defer(this.#context, () => device.close());
        await device.start();
        const { manualPairingCode, qrPairingCode } = device.state.commissioning.pairingCodes;
        return { device, manualCode: manualPairingCode, qrCode: qrPairingCode };
    }
}
