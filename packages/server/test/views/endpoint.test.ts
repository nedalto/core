import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createEndpointId, createRoomId } from "@nedalto/contract/common/ids.ts";
import { EndpointNotFoundError } from "@nedalto/contract/endpoint/errors.ts";

import { composeEndpoint, EndpointView } from "../../src/views/endpoint.ts";
import { createLight, createNode, LIGHT_SHAPE, stateOf } from "../helpers/fixtures.ts";
import { FakeEndpointGateway } from "../helpers/gateway.ts";
import { RecordingLogger } from "../helpers/logger.ts";
import { MemoryEndpointRepository } from "../helpers/repository.ts";

const NODE = createNode();
const KITCHEN_LIGHT = createLight(NODE.id, 1, createRoomId());
const BARE_LIGHT = createLight(NODE.id, 2);

describe("composeEndpoint", () => {
    test("joins what is stored with the shape the gateway describes", () => {
        const endpointGateway = new FakeEndpointGateway();
        endpointGateway.shapes.set(KITCHEN_LIGHT.id, LIGHT_SHAPE);

        const state = composeEndpoint({ logger: new RecordingLogger(), endpointGateway }, KITCHEN_LIGHT);

        assert.deepEqual(state, stateOf(KITCHEN_LIGHT));
    });

    test("returns null and warns when the gateway cannot describe the endpoint", () => {
        const logger = new RecordingLogger();

        const state = composeEndpoint({ logger, endpointGateway: new FakeEndpointGateway() }, BARE_LIGHT);

        assert.equal(state, null);
        assert.equal(logger.at("warn").length, 1);
        assert.ok(logger.at("warn")[0]?.includes(BARE_LIGHT.id));
    });
});

function setup() {
    const endpointRepository = new MemoryEndpointRepository();
    endpointRepository.save(KITCHEN_LIGHT);
    endpointRepository.save(BARE_LIGHT);
    const endpointGateway = new FakeEndpointGateway();
    endpointGateway.shapes.set(KITCHEN_LIGHT.id, LIGHT_SHAPE);
    const logger = new RecordingLogger();
    return { endpointGateway, logger, view: new EndpointView({ endpointRepository, logger, endpointGateway }) };
}

describe("EndpointView", () => {
    test("lists the stored endpoints as composed, and leaves out one that cannot be described", () => {
        const { view, logger } = setup();

        assert.deepEqual(view.list(), [stateOf(KITCHEN_LIGHT)]);
        assert.equal(logger.at("warn").length, 1);
    });

    test("returns the endpoint with the id as composed", () => {
        assert.deepEqual(setup().view.get(KITCHEN_LIGHT.id), stateOf(KITCHEN_LIGHT));
    });

    test("throws EndpointNotFoundError, naming the endpoint, when the endpoint is not stored", () => {
        const missing = createEndpointId();

        assert.throws(
            () => setup().view.get(missing),
            (error) => {
                assert.ok(error instanceof EndpointNotFoundError);
                assert.equal(error.code, "NOT_FOUND_ERROR");
                assert.deepEqual(error.data, { endpointId: missing });
                return true;
            },
        );
    });

    test("throws EndpointNotFoundError when the endpoint is stored but cannot be described", () => {
        assert.throws(() => setup().view.get(BARE_LIGHT.id), EndpointNotFoundError);
    });
});
