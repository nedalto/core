import "../src/sdk-config.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import { Environment, StorageService } from "@matter/main";

// The storage service takes the driver from the configuration when the environment is created, so reading it
// back is what shows that the SDK reads the copy of `@matter/nodejs` that `sdk-config.ts` configures.
test("the SDK reads the sqlite storage driver", () => {
    assert.equal(Environment.default.get(StorageService).configuredDriver, "sqlite");
});
