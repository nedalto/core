import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { NotFoundError } from "../../src/common/errors.ts";

describe("AppError", () => {
    test("keeps the cause and the data it is created with", () => {
        const cause = new Error("disk full");
        const data = { roomId: "017f22e2-79b0-7cc3-98c4-dc0c0c07398f" };

        const error = new NotFoundError("room not found", { cause, data });

        assert.equal(error.cause, cause);
        assert.deepEqual(error.data, data);
    });

    test("takes the name of the class it is created from", () => {
        assert.equal(new NotFoundError("room not found").name, NotFoundError.name);
    });
});
