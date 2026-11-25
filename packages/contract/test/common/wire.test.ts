import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isTaggedBytes, isTaggedInteger } from "../../src/common/wire.ts";

describe("isTaggedInteger", () => {
    const accepted = ["0", "-9223372036854775808", "18446744073709551615"];
    for (const text of accepted) {
        test(`accepts ${text}`, () => {
            assert.equal(isTaggedInteger({ $integer: text }), true);
        });
    }

    const rejected: { title: string; value: unknown }[] = [
        { title: "a leading zero", value: { $integer: "05" } },
        { title: "a plus sign", value: { $integer: "+5" } },
        { title: "a negative zero", value: { $integer: "-0" } },
        { title: "an exponent", value: { $integer: "1e3" } },
        { title: "a space", value: { $integer: " 5" } },
        { title: "an empty text", value: { $integer: "" } },
        { title: "a decimal point", value: { $integer: "5.0" } },
        { title: "21 digits", value: { $integer: "100000000000000000000" } },
        { title: "a number instead of a text", value: { $integer: 5 } },
        { title: "a key besides the tag", value: { $integer: "5", extra: 1 } },
        { title: "the bytes tag", value: { $bytes: "10" } },
        { title: "null", value: null },
    ];
    for (const { title, value } of rejected) {
        test(`rejects ${title}`, () => {
            assert.equal(isTaggedInteger(value), false);
        });
    }
});

describe("isTaggedBytes", () => {
    const accepted = ["", "00ff", "0a1b2c"];
    for (const text of accepted) {
        test(`accepts ${JSON.stringify(text)}`, () => {
            assert.equal(isTaggedBytes({ $bytes: text }), true);
        });
    }

    const rejected: { title: string; value: unknown }[] = [
        { title: "uppercase hexadecimal", value: { $bytes: "00FF" } },
        { title: "an odd length", value: { $bytes: "abc" } },
        { title: "a character that is not hexadecimal", value: { $bytes: "0g12" } },
        { title: "a key besides the tag", value: { $bytes: "00", extra: 1 } },
        { title: "the integer tag", value: { $integer: "10" } },
        { title: "null", value: null },
    ];
    for (const { title, value } of rejected) {
        test(`rejects ${title}`, () => {
            assert.equal(isTaggedBytes(value), false);
        });
    }
});
