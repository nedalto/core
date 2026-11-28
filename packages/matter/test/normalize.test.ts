import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { InternalError, ValidationError } from "@nedalto/contract/common/errors.ts";
import { isTaggedBytes, isTaggedInteger } from "@nedalto/contract/common/wire.ts";
import type { AttributeValue } from "@nedalto/contract/endpoint/types.ts";

import { denormalizeValue, normalizeInteger, normalizeValue } from "../src/normalize.ts";
import { TestNetwork } from "./helpers/network.ts";

describe("normalizeValue", () => {
    test("keeps an integer in the safe range as a number", () => {
        assert.equal(normalizeValue(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
        assert.equal(normalizeValue(Number.MIN_SAFE_INTEGER), Number.MIN_SAFE_INTEGER);
    });

    test("keeps a float outside the safe range as a number", () => {
        assert.equal(normalizeValue(2 ** 60), 2 ** 60);
    });

    test("keeps a number that is not an integer", () => {
        assert.equal(normalizeValue(1.5), 1.5);
    });

    test("turns NaN and the infinities into null, also inside a list or a struct", () => {
        for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
            assert.equal(normalizeValue(value), null);
            assert.deepEqual(normalizeValue([value]), [null]);
            assert.deepEqual(normalizeValue({ field: value }), { field: null });
        }
    });

    test("keeps strings, booleans and null", () => {
        assert.equal(normalizeValue("text"), "text");
        assert.equal(normalizeValue(false), false);
        assert.equal(normalizeValue(null), null);
    });

    test("tags bytes with their lowercase hex", () => {
        assert.deepEqual(normalizeValue(new Uint8Array([0, 171, 255])), { $bytes: "00abff" });
        assert.deepEqual(normalizeValue(Buffer.from([1, 2, 254])), { $bytes: "0102fe" });
    });

    test("reads only the bytes that a view covers", () => {
        const bytes = new Uint8Array([1, 2, 3, 4]);

        assert.deepEqual(normalizeValue(bytes.subarray(1, 3)), { $bytes: "0203" });
    });

    test("normalizes arrays and objects at any depth", () => {
        const value = { list: [1n, { bytes: Buffer.from([9]), big: 2n ** 70n }], nested: { flag: true } };

        assert.deepEqual(normalizeValue(value), {
            list: [1, { bytes: { $bytes: "09" }, big: { $integer: "1180591620717411303424" } }],
            nested: { flag: true },
        });
    });

    test("leaves out the fields of an object that are undefined", () => {
        assert.deepEqual(normalizeValue({ present: 1, absent: undefined }), { present: 1 });
    });

    test("turns the state of an SDK node into plain JSON", async (t) => {
        const network = new TestNetwork(t);
        const { manualCode } = await network.startDevice();
        const root = (await network.peer(manualCode)).endpoints.for(0);

        // An access control entry has a list of 64-bit subjects, a null and a field the device left out.
        const acl = normalizeValue(root.stateOf("accessControl").acl);
        // A certificate is bytes.
        const credentials = normalizeValue(root.stateOf("operationalCredentials").nocs);

        assert.ok(Array.isArray(acl) && Array.isArray(credentials));
        const [entry] = acl;
        const [certificate] = credentials;
        assert.ok(typeof entry === "object" && entry !== null && !Array.isArray(entry));
        assert.ok(typeof certificate === "object" && certificate !== null && !Array.isArray(certificate));
        assert.equal(Object.getPrototypeOf(entry), Object.prototype);
        assert.equal(entry.targets, null);
        assert.equal("auxiliaryType" in entry, false);
        assert.ok(Array.isArray(entry.subjects) && isTaggedInteger(entry.subjects[0]));
        assert.ok(isTaggedBytes(certificate.noc));
        assert.deepEqual(JSON.parse(JSON.stringify({ acl, credentials })), { acl, credentials });
    });

    const unsupported = [
        { title: "undefined", value: undefined },
        { title: "a symbol", value: Symbol("x") },
        { title: "a function", value: () => 1 },
        { title: "a Date", value: new Date(0) },
        { title: "a Map", value: new Map() },
        { title: "a Set", value: new Set() },
        { title: "an undefined element of an array", value: [undefined] },
        { title: "a Date inside an object", value: { when: new Date(0) } },
    ];
    for (const { title, value } of unsupported) {
        test(`throws InternalError for ${title}`, () => {
            assert.throws(() => normalizeValue(value), InternalError);
        });
    }
});

describe("normalizeInteger", () => {
    test("turns an integer in the safe range into a number", () => {
        assert.equal(normalizeInteger(42n), 42);
        assert.equal(normalizeInteger(BigInt(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
        assert.equal(normalizeInteger(BigInt(Number.MIN_SAFE_INTEGER)), Number.MIN_SAFE_INTEGER);
    });

    test("tags an integer beyond the safe range with its decimal", () => {
        assert.deepEqual(normalizeInteger(2n ** 53n), { $integer: "9007199254740992" });
        assert.deepEqual(normalizeInteger(-(2n ** 53n)), { $integer: "-9007199254740992" });
        assert.deepEqual(normalizeInteger(2n ** 64n - 1n), { $integer: "18446744073709551615" });
        assert.deepEqual(normalizeInteger(-(2n ** 63n)), { $integer: "-9223372036854775808" });
    });
});

describe("denormalizeValue", () => {
    test("turns a tagged integer into a number in the safe range and a bigint outside it", () => {
        assert.equal(denormalizeValue({ $integer: "30" }, "value"), 30);
        assert.equal(denormalizeValue({ $integer: "9007199254740991" }, "value"), 9_007_199_254_740_991);
        assert.equal(denormalizeValue({ $integer: "9007199254740992" }, "value"), 9_007_199_254_740_992n);
        assert.equal(denormalizeValue({ $integer: "-9223372036854775808" }, "value"), -(2n ** 63n));
    });

    test("turns tagged bytes into a Uint8Array, also when empty", () => {
        assert.deepEqual(denormalizeValue({ $bytes: "00abff" }, "value"), new Uint8Array([0, 171, 255]));
        assert.deepEqual(denormalizeValue({ $bytes: "" }, "value"), new Uint8Array([]));
    });

    test("converts the tags inside lists and structs at any depth", () => {
        const value: AttributeValue = {
            list: [{ $bytes: "09" }, { inner: { $integer: "-9007199254740992" } }],
            flag: true,
        };

        assert.deepEqual(denormalizeValue(value, "args"), {
            list: [new Uint8Array([9]), { inner: -(2n ** 53n) }],
            flag: true,
        });
    });

    test("keeps a number with decimals", () => {
        assert.equal(denormalizeValue(1.5, "value"), 1.5);
    });

    test("keeps a key __proto__ as a field, without changing the prototype", () => {
        // A literal would set the prototype as it creates the object; JSON.parse leaves the key as a field.
        const value: AttributeValue = JSON.parse('{"onTime": 5, "__proto__": 1}');

        const result = denormalizeValue(value, "value");

        assert.ok(typeof result === "object" && result !== null);
        assert.equal(Object.getPrototypeOf(result), Object.prototype);
        assert.deepEqual(Object.entries(result), [
            ["onTime", 5],
            ["__proto__", 1],
        ]);
    });

    test("keeps an untagged number outside the safe range as it is", () => {
        // Whether it fits depends on its field, which `request.ts` checks.
        assert.equal(denormalizeValue(2 ** 60, "args"), 2 ** 60);
    });

    const rejected: { title: string; value: AttributeValue }[] = [
        { title: "a malformed tag", value: { $integer: "05" } },
        { title: "an object with another key that starts with $", value: { field: { $other: "x" } } },
        { title: "NaN", value: Number.NaN },
        { title: "an infinity", value: Number.POSITIVE_INFINITY },
        { title: "a string that is not valid Unicode", value: "room\ud800" },
    ];
    for (const { title, value } of rejected) {
        test(`throws ValidationError with the path for ${title}`, () => {
            assert.throws(
                () => denormalizeValue(value, "args"),
                (error: unknown) => {
                    assert.ok(error instanceof ValidationError);
                    assert.deepEqual(
                        error.data.issues.map(({ path }) => path),
                        ["args"],
                    );
                    return true;
                },
            );
        });
    }
});
