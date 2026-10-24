import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { InternalError } from "@nedalto/contract/common/errors.ts";

import { versionAttributesOf } from "../src/version.ts";

describe("versionAttributesOf", () => {
    test("weighs major, minor and patch by a million, a thousand and one", () => {
        assert.equal(versionAttributesOf("1.2.3").softwareVersion, 1_002_003);
    });

    test("gives a later release a larger number", () => {
        const releases = ["0.0.1", "0.0.2", "0.1.0", "0.999.999", "1.0.0", "2.0.0"];

        const numbers = releases.map((release) => versionAttributesOf(release).softwareVersion);

        assert.deepEqual(
            numbers,
            numbers.toSorted((a, b) => a - b),
        );
        assert.equal(new Set(numbers).size, releases.length);
    });

    test("keeps a pre-release or build suffix only in the string", () => {
        assert.deepEqual(versionAttributesOf("1.2.3-beta.1+abc"), {
            softwareVersion: versionAttributesOf("1.2.3").softwareVersion,
            softwareVersionString: "1.2.3-beta.1+abc",
        });
    });

    const invalid = [
        { title: "a version that is not semantic", version: "1.2" },
        { title: "a component of 1000 or more", version: "0.1000.0" },
        { title: "0.0.0, which the SDK takes as unset", version: "0.0.0" },
        { title: "a suffix with a character outside semantic versioning", version: "1.0.0-é" },
    ];
    for (const { title, version } of invalid) {
        test(`throws InternalError for ${title}`, () => {
            assert.throws(() => versionAttributesOf(version), InternalError);
        });
    }
});
