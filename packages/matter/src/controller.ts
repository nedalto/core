import "./sdk-config.ts";
import { type Environment, VendorId } from "@matter/main";
import { ControllerBehavior, ServerNode } from "@matter/main/node";

import { InternalError } from "@nedalto/contract/common/errors.ts";
import type { Lifecycle } from "@nedalto/contract/common/lifecycle.ts";
import type { DomainEventBus } from "@nedalto/contract/events.ts";
import type { Logger } from "@nedalto/contract/logger/ports.ts";
import type { NodeGateway, NodeRepository } from "@nedalto/contract/node/ports.ts";

import { SdkNodeGateway } from "./gateways/node.ts";

/**
 * The Matter controller of the hub.
 * `node` is available between `start()` and `stop()`.
 */
export interface MatterController extends Lifecycle {
    readonly node: NodeGateway;
}

/** What the controller reads, writes and reports through. */
export interface ControllerCollaborators {
    readonly logger: Logger;
    readonly nodeRepository: NodeRepository;
    readonly bus: DomainEventBus;
}

// The id of the SDK node is also the name of the directory where the SDK stores the fabric credentials:
// changing it leaves an installed hub without them.
const NODE_ID = "hub";

// A test vendor id of the CSA (0xFFF1-0xFFF4). The versions are not zero because the SDK replaces a zero with
// its own development values.
const BASIC_INFORMATION = {
    vendorId: VendorId(0xfff1),
    vendorName: "Nedalto",
    productId: 0x8000,
    productName: "Hub",
    hardwareVersion: 1,
    softwareVersion: 1,
    softwareVersionString: "0.0.1",
};

interface Open {
    readonly server: ServerNode;
    readonly node: SdkNodeGateway;
}

export class SdkMatterController implements MatterController {
    readonly #environment: Environment;
    readonly #logger: Logger;
    readonly #nodeRepository: NodeRepository;
    readonly #bus: DomainEventBus;
    #open: Open | undefined;

    /** The controller runs on `environment`, which the caller has already configured. */
    constructor(environment: Environment, { logger, nodeRepository, bus }: ControllerCollaborators) {
        this.#environment = environment;
        this.#logger = logger.get("Matter");
        this.#nodeRepository = nodeRepository;
        this.#bus = bus;
    }

    get node(): NodeGateway {
        if (this.#open === undefined) {
            throw new InternalError("Matter controller accessed outside its start()/stop() window");
        }
        return this.#open.node;
    }

    async start(): Promise<void> {
        // @matter/node 0.17.9: `ControllerBehavior` is what lets the node discover and commission devices.
        // Commissioning is disabled so that the hub never advertises itself as a commissionable device; the
        // behavior only does it by itself while every fabric of the node is one it controls.
        const server = await ServerNode.create(ServerNode.RootEndpoint.with(ControllerBehavior), {
            environment: this.#environment,
            id: NODE_ID,
            basicInformation: BASIC_INFORMATION,
            commissioning: { enabled: false },
            // @matter/node 0.17.9: the label of our fabric on the devices, "matter.js" by default.
            controller: { adminFabricLabel: BASIC_INFORMATION.vendorName },
        });
        const node = new SdkNodeGateway(this.#logger, this.#bus, server);
        // @matter/node 0.17.9: the peers are read from storage on first access and start connecting when the
        // server goes online, so hydrating before `start()` attaches the observers before any connection.
        node.hydrate(this.#nodeRepository.findAll());
        await server.start();
        this.#open = { server, node };
        this.#logger.notice("controller ready");
    }

    async stop(): Promise<void> {
        const open = this.#open;
        if (open === undefined) {
            return;
        }
        this.#open = undefined;

        // Closing the server takes every peer offline, which would be announced as a disconnection of each node.
        open.node.stop();
        await open.server.close();
        this.#logger.notice("controller closed");
    }
}
