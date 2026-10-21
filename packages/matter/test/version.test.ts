import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { InternalError } from "@nedalto/contract/common/errors.ts";

import { softwareVersionOf } from "../src/version.ts";

describe("softwareVersionOf", () => {
    test("weighs major, minor and patch by a million, a thousand and one", () => {
        assert.equal(softwareVersionOf("1.2.3"), 1_002_003);
    });

    test("gives a later release a larger number", () => {
        const releases = ["0.0.1", "0.0.2", "0.1.0", "0.999.999", "1.0.0", "2.0.0"];

        const numbers = releases.map(softwareVersionOf);

        assert.deepEqual(
            numbers,
            numbers.toSorted((a, b) => a - b),
        );
        assert.equal(new Set(numbers).size, releases.length);
    });

    test("ignores a pre-release or build suffix", () => {
        assert.equal(softwareVersionOf("1.2.3-beta.1+abc"), softwareVersionOf("1.2.3"));
    });

    const invalid = [
        { title: "a version that is not semantic", version: "1.2" },
        { title: "a component of 1000 or more", version: "0.1000.0" },
        { title: "0.0.0, which the SDK takes as unset", version: "0.0.0" },
    ];
    for (const { title, version } of invalid) {
        test(`throws InternalError for ${title}`, () => {
            assert.throws(() => softwareVersionOf(version), InternalError);
        });
    }
});
