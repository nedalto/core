import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MIGRATIONS } from "../src/migrations.ts";

describe("MIGRATIONS", () => {
    test("numbers the migrations from 1 without gaps", () => {
        assert.deepEqual(
            MIGRATIONS.map(({ version }) => version),
            MIGRATIONS.map((_migration, index) => index + 1),
        );
    });
});
