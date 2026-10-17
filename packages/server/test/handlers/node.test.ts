import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ValidationError } from "@nedalto/contract/common/errors.ts";
import { createNodeId } from "@nedalto/contract/common/ids.ts";

import { nodeHandlers } from "../../src/handlers/node.ts";
import { CommissionUseCase } from "../../src/use-cases/commission.ts";
import { DecommissionUseCase } from "../../src/use-cases/decommission.ts";
import { NodeView } from "../../src/views/node.ts";
import { RecordingBus } from "../helpers/bus.ts";
import { FakeEndpointGateway, FakeNodeGateway } from "../helpers/gateway.ts";
import { RecordingLogger } from "../helpers/logger.ts";
import { MemoryEndpointRepository, MemoryNodeRepository } from "../helpers/repository.ts";
import { RecordingTransactor } from "../helpers/transactor.ts";

function setup() {
    const logger = new RecordingLogger();
    const nodeRepository = new MemoryNodeRepository();
    const endpointRepository = new MemoryEndpointRepository();
    const nodeGateway = new FakeNodeGateway();
    const bus = new RecordingBus();
    const handlers = nodeHandlers({
        nodeGateway,
        nodeView: new NodeView({ nodeRepository, nodeGateway }),
        commissionUseCase: new CommissionUseCase({
            logger,
            nodeRepository,
            endpointRepository,
            transactor: new RecordingTransactor(),
            nodeGateway,
            endpointGateway: new FakeEndpointGateway(),
            bus,
        }),
        decommissionUseCase: new DecommissionUseCase({ logger, nodeRepository, nodeGateway, bus }),
    });
    return { nodeGateway, bus, handlers };
}

describe("nodeHandlers", () => {
    test("every handler throws a ValidationError, before touching the gateway or the repositories, when the params are invalid", async () => {
        const { nodeGateway, bus, handlers } = setup();
        const id = createNodeId();

        const invalid: [keyof typeof handlers, unknown][] = [
            ["node.list", { id }],
            ["node.get", {}],
            ["node.getInfo", { id: "not-an-id" }],
            ["node.commission", { setupCode: "" }],
            ["node.decommission", { id, force: "yes" }],
        ];
        await Promise.all(
            invalid.map(([method, params]) =>
                assert.rejects(async () => handlers[method](params), ValidationError, method),
            ),
        );
        assert.deepEqual(nodeGateway.commissionCalls, []);
        assert.deepEqual(nodeGateway.decommissionCalls, []);
        assert.deepEqual(bus.emitted, []);
    });
});
