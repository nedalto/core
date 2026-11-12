import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { InternalError } from "../../src/common/errors.ts";

describe("AppError", () => {
    test("takes the name of the class it is created from", () => {
        assert.equal(new InternalError("boom").name, InternalError.name);
    });
});
