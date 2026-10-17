import type { EndpointGateway } from "@nedalto/contract/endpoint/ports.ts";
import {
    validateGetParams,
    validateInvokeParams,
    validateListParams,
    validateReadParams,
    validateSetNameParams,
    validateSetRoomParams,
    validateWriteParams,
} from "@nedalto/contract/endpoint/schemas.ts";

import type { EndpointUseCase } from "../use-cases/endpoint.ts";
import type { EndpointView } from "../views/endpoint.ts";

export interface EndpointHandlerDeps {
    readonly endpointGateway: EndpointGateway;
    readonly endpointView: EndpointView;
    readonly endpointUseCase: EndpointUseCase;
}

export const endpointHandlers = ({ endpointGateway, endpointView, endpointUseCase }: EndpointHandlerDeps) => ({
    "endpoint.list": (params: unknown) => {
        validateListParams(params);
        return endpointView.list();
    },
    "endpoint.get": (params: unknown) => {
        const { id } = validateGetParams(params);
        return endpointView.get(id);
    },
    "endpoint.read": (params: unknown) => {
        const { id, clusterId, attributeId } = validateReadParams(params);
        return endpointGateway.read(id, clusterId, attributeId);
    },
    "endpoint.write": async (params: unknown) => {
        const { id, clusterId, attributeId, value } = validateWriteParams(params);
        await endpointGateway.write(id, clusterId, attributeId, value);
        return null;
    },
    "endpoint.invoke": async (params: unknown) => {
        const { id, clusterId, commandId, args } = validateInvokeParams(params);
        await endpointGateway.invoke(id, clusterId, commandId, args);
        return null;
    },
    "endpoint.setName": (params: unknown) => {
        const { id, name } = validateSetNameParams(params);
        endpointUseCase.rename(id, name);
        return null;
    },
    "endpoint.setRoom": (params: unknown) => {
        const { id, roomId } = validateSetRoomParams(params);
        endpointUseCase.assignRoom(id, roomId);
        return null;
    },
});
