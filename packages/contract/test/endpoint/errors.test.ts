import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createEndpointId } from "../../src/common/ids.ts";
import { AttributeNotFoundError, CommandNotFoundError, InteractionRejectedError } from "../../src/endpoint/errors.ts";

const endpointId = createEndpointId();

describe("AttributeNotFoundError", () => {
    test("writes the cluster and attribute ids in hexadecimal in its message", () => {
        const error = new AttributeNotFoundError(endpointId, 0x201, 0x12);

        assert.equal(error.message, `Attribute 0x12 of cluster 0x201 not found on endpoint ${endpointId}`);
    });
});

describe("CommandNotFoundError", () => {
    test("writes the cluster and command ids in hexadecimal in its message", () => {
        const error = new CommandNotFoundError(endpointId, 0x6, 0xa);

        assert.equal(error.message, `Command 0xa of cluster 0x6 not found on endpoint ${endpointId}`);
    });
});

describe("InteractionRejectedError", () => {
    test("writes the cluster id and the status in hexadecimal in its message", () => {
        const error = new InteractionRejectedError(endpointId, 0x6, { commandId: 0x1 }, 0x87);

        assert.equal(
            error.message,
            `Device rejected the request on cluster 0x6 of endpoint ${endpointId}: status 0x87`,
        );
    });
});
