import type { Transactor } from "@nedalto/contract/database/ports.ts";
import type { EndpointGateway, EndpointRepository } from "@nedalto/contract/endpoint/ports.ts";
import type { DomainEventBus } from "@nedalto/contract/events.ts";
import type { Logger } from "@nedalto/contract/logger/ports.ts";
import type { NodeGateway, NodeRepository } from "@nedalto/contract/node/ports.ts";
import type { RoomRepository } from "@nedalto/contract/room/ports.ts";

import { HttpServer, type ServerOptions } from "./http-server.ts";
import { createHandlers, type UseCases } from "./methods.ts";
import type { Views } from "./subscriptions.ts";
import { CommissionUseCase } from "./use-cases/commission.ts";
import { DecommissionUseCase } from "./use-cases/decommission.ts";
import { EndpointUseCase } from "./use-cases/endpoint.ts";
import { RoomUseCase } from "./use-cases/room.ts";
import { EndpointView } from "./views/endpoint.ts";
import { NodeView } from "./views/node.ts";
import { RoomView } from "./views/room.ts";

export type { HttpServer, ServerOptions } from "./http-server.ts";

/** The ports the server reads, writes and reports through. */
export interface ServerDeps {
    readonly logger: Logger;
    readonly nodeRepository: NodeRepository;
    readonly endpointRepository: EndpointRepository;
    readonly roomRepository: RoomRepository;
    readonly transactor: Transactor;
    readonly nodeGateway: NodeGateway;
    readonly endpointGateway: EndpointGateway;
    readonly bus: DomainEventBus;
}

/** The server of the client API, with its views, use cases and handlers over `deps`. */
export function createHttpServer(
    {
        logger: rootLogger,
        nodeRepository,
        endpointRepository,
        roomRepository,
        transactor,
        nodeGateway,
        endpointGateway,
        bus,
    }: ServerDeps,
    options: ServerOptions,
): HttpServer {
    const logger = rootLogger.get("Server");
    const views: Views = {
        node: new NodeView({ nodeRepository, nodeGateway }),
        endpoint: new EndpointView({ endpointRepository, logger, endpointGateway }),
        room: new RoomView(roomRepository),
    };
    const useCases: UseCases = {
        commission: new CommissionUseCase({
            logger,
            nodeRepository,
            endpointRepository,
            transactor,
            nodeGateway,
            endpointGateway,
            bus,
        }),
        decommission: new DecommissionUseCase({ logger, nodeRepository, nodeGateway, bus }),
        endpoint: new EndpointUseCase({ endpointRepository, roomRepository, bus }),
        room: new RoomUseCase({ roomRepository, bus }),
    };
    const handlers = createHandlers({ views, useCases, nodeGateway, endpointGateway });
    return new HttpServer({ logger, bus, views, handlers }, options);
}
