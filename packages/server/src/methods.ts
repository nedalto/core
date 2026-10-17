import type { EndpointGateway } from "@nedalto/contract/endpoint/ports.ts";
import type { NodeGateway } from "@nedalto/contract/node/ports.ts";
import type { MethodMap } from "@nedalto/contract/server/types.ts";

import { endpointHandlers } from "./handlers/endpoint.ts";
import { nodeHandlers } from "./handlers/node.ts";
import { roomHandlers } from "./handlers/room.ts";
import type { Views } from "./subscriptions.ts";
import type { CommissionUseCase } from "./use-cases/commission.ts";
import type { DecommissionUseCase } from "./use-cases/decommission.ts";
import type { EndpointUseCase } from "./use-cases/endpoint.ts";
import type { RoomUseCase } from "./use-cases/room.ts";

export interface UseCases {
    readonly commission: CommissionUseCase;
    readonly decommission: DecommissionUseCase;
    readonly endpoint: EndpointUseCase;
    readonly room: RoomUseCase;
}

export interface HandlersDeps {
    readonly nodeGateway: NodeGateway;
    readonly endpointGateway: EndpointGateway;
    readonly views: Views;
    readonly useCases: UseCases;
}

/** The one method the transport answers itself instead of the dispatcher. */
export const SUBSCRIBE_METHOD = "hub.subscribe" satisfies keyof MethodMap;

/** A handler per method of the contract but the subscription, each answering what the contract says. */
export type HandlerTable = {
    readonly [Method in Exclude<keyof MethodMap, typeof SUBSCRIBE_METHOD>]: (
        params: unknown,
    ) => MethodMap[Method]["result"] | Promise<MethodMap[Method]["result"]>;
};

/** The handler of every method but `hub.subscribe`. */
export const createHandlers = ({ nodeGateway, endpointGateway, views, useCases }: HandlersDeps): HandlerTable => ({
    ...nodeHandlers({
        nodeGateway,
        nodeView: views.node,
        commissionUseCase: useCases.commission,
        decommissionUseCase: useCases.decommission,
    }),
    ...endpointHandlers({ endpointGateway, endpointView: views.endpoint, endpointUseCase: useCases.endpoint }),
    ...roomHandlers({ roomView: views.room, roomUseCase: useCases.room }),
});
