import type { NodeGateway } from "@nedalto/contract/node/ports.ts";
import {
    validateCommissionParams,
    validateDecommissionParams,
    validateGetInfoParams,
    validateGetParams,
    validateListParams,
} from "@nedalto/contract/node/schemas.ts";

import type { CommissionUseCase } from "../use-cases/commission.ts";
import type { DecommissionUseCase } from "../use-cases/decommission.ts";
import type { NodeView } from "../views/node.ts";

export interface NodeHandlerDeps {
    readonly nodeGateway: NodeGateway;
    readonly nodeView: NodeView;
    readonly commissionUseCase: CommissionUseCase;
    readonly decommissionUseCase: DecommissionUseCase;
}

export const nodeHandlers = ({ nodeGateway, nodeView, commissionUseCase, decommissionUseCase }: NodeHandlerDeps) => ({
    "node.list": (params: unknown) => {
        validateListParams(params);
        return nodeView.list();
    },
    "node.get": (params: unknown) => {
        const { id } = validateGetParams(params);
        return nodeView.get(id);
    },
    "node.getInfo": (params: unknown) => {
        const { id } = validateGetInfoParams(params);
        return nodeGateway.getInfo(id);
    },
    "node.commission": (params: unknown) => {
        const { setupCode } = validateCommissionParams(params);
        return commissionUseCase.execute(setupCode);
    },
    "node.decommission": async (params: unknown) => {
        const { id, force } = validateDecommissionParams(params);
        await decommissionUseCase.execute(id, force);
        return null;
    },
});
