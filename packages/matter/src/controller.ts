import "./sdk-config.ts";
import { type Environment, VendorId } from "@matter/main";
import { ControllerBehavior, ServerNode } from "@matter/main/node";

import { InternalError } from "@nedalto/contract/common/errors.ts";
import type { Lifecycle } from "@nedalto/contract/common/lifecycle.ts";
import type { EndpointGateway, EndpointRepository } from "@nedalto/contract/endpoint/ports.ts";
import type { DomainEventBus } from "@nedalto/contract/events.ts";
import type { Logger } from "@nedalto/contract/logger/ports.ts";
import type { NodeGateway, NodeRepository } from "@nedalto/contract/node/ports.ts";

import { MatterEndpointGateway } from "./gateways/endpoint.ts";
import { MatterNodeGateway } from "./gateways/node.ts";
import { Identity } from "./identity.ts";
import { type VersionAttributes, versionAttributesOf } from "./version.ts";

/**
 * The Matter controller of the hub.
 * `node` and `endpoint` are available between `start()` and `stop()`.
 */
export interface Controller extends Lifecycle {
    readonly node: NodeGateway;
    readonly endpoint: EndpointGateway;
}

/** What the controller reads, writes and reports through. */
export interface MatterControllerDeps {
    readonly logger: Logger;
    readonly nodeRepository: NodeRepository;
    readonly endpointRepository: EndpointRepository;
    readonly bus: DomainEventBus;
}

// The id of the SDK node is also the name of the directory where the SDK stores the fabric credentials:
// changing it leaves an installed hub without them.
const NODE_ID = "hub";

// A test vendor id of the CSA (0xFFF1-0xFFF4). The hardware version is not zero because the SDK replaces a zero
// with its own development values.
const BASIC_INFORMATION = {
    vendorId: VendorId(0xfff1),
    vendorName: "Nedalto",
    productId: 0x8000,
    productName: "Hub",
    hardwareVersion: 1,
};

interface Open {
    readonly server: ServerNode;
    readonly node: MatterNodeGateway;
    readonly endpoint: MatterEndpointGateway;
}

export class MatterController implements Controller {
    readonly #environment: Environment;
    readonly #logger: Logger;
    readonly #nodeRepository: NodeRepository;
    readonly #endpointRepository: EndpointRepository;
    readonly #bus: DomainEventBus;
    readonly #version: VersionAttributes;
    #open: Open | undefined;

    /**
     * The controller runs on `environment`, which the caller has already configured, and announces itself on the
     * fabric as `version` of the hub.
     */
    constructor(
        environment: Environment,
        { logger, nodeRepository, endpointRepository, bus }: MatterControllerDeps,
        version: string,
    ) {
        this.#environment = environment;
        this.#logger = logger;
        this.#nodeRepository = nodeRepository;
        this.#endpointRepository = endpointRepository;
        this.#bus = bus;
        this.#version = versionAttributesOf(version);
    }

    get node(): NodeGateway {
        return this.#opened().node;
    }

    get endpoint(): EndpointGateway {
        return this.#opened().endpoint;
    }

    async start(): Promise<void> {
        // @matter/node 0.18.0: `ControllerBehavior` is what lets the node discover and commission devices, and the
        // root without Groupcast keeps the hub from offering itself as a device that receives group messages.
        // Commissioning is disabled so that the hub never advertises itself as a commissionable device; the
        // behavior only does it by itself while every fabric of the node is one it controls.
        // See `docs/decisions/0007-matter-controller-on-the-node-api.md`.
        const server = await ServerNode.create(ServerNode.RootEndpointWithoutGroupcast.with(ControllerBehavior), {
            environment: this.#environment,
            id: NODE_ID,
            basicInformation: { ...BASIC_INFORMATION, ...this.#version },
            commissioning: { enabled: false },
            // @matter/node 0.18.0: the label of our fabric on the devices, "matter.js" by default, which the SDK
            // sets on each peer once, after its first subscription.
            controller: { adminFabricLabel: BASIC_INFORMATION.vendorName },
        });
        const identity = new Identity(this.#logger);
        const node = new MatterNodeGateway(this.#logger, this.#bus, identity, server);
        const endpoint = new MatterEndpointGateway(this.#bus, identity);
        // @matter/node 0.18.0: the peers are read from storage on first access and start connecting when the
        // server goes online, so hydrating before `start()` attaches the observers before any connection.
        identity.hydrate(server.peers, this.#nodeRepository, this.#endpointRepository);
        await server.start();
        this.#open = { server, node, endpoint };
        this.#logger.notice("controller ready");
    }

    async stop(): Promise<void> {
        const open = this.#open;
        if (open === undefined) {
            return;
        }
        this.#open = undefined;

        // Closing the server takes every peer offline, which would be announced as a disconnection of each node.
        open.node.close();
        open.endpoint.close();
        await open.server.close();
        this.#logger.notice("controller closed");
    }

    #opened(): Open {
        if (this.#open === undefined) {
            throw new InternalError("Matter controller accessed outside its start()/stop() window");
        }
        return this.#open;
    }
}
