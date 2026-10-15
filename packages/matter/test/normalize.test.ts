import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { InternalError } from "@nedalto/contract/common/errors.ts";

import { normalizeValue } from "../src/normalize.ts";
import { TestNetwork } from "./helpers/network.ts";

describe("normalizeValue", () => {
    test("keeps an integer in the safe range as a number", () => {
        assert.equal(normalizeValue(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
        assert.equal(normalizeValue(Number.MIN_SAFE_INTEGER), Number.MIN_SAFE_INTEGER);
    });

    test("turns a small bigint into a number", () => {
        assert.equal(normalizeValue(42n), 42);
        assert.equal(normalizeValue(BigInt(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
        assert.equal(normalizeValue(BigInt(Number.MIN_SAFE_INTEGER)), Number.MIN_SAFE_INTEGER);
    });

    test("keeps a bigint beyond the safe range as a bigint", () => {
        assert.equal(normalizeValue(2n ** 53n), 2n ** 53n);
        assert.equal(normalizeValue(-(2n ** 53n)), -(2n ** 53n));
        assert.equal(normalizeValue(2n ** 64n - 1n), 2n ** 64n - 1n);
    });

    test("turns an integer number beyond the safe range into a bigint", () => {
        assert.equal(normalizeValue(2 ** 60), 2n ** 60n);
    });

    test("keeps a number that is not an integer", () => {
        assert.equal(normalizeValue(1.5), 1.5);
    });

    test("keeps strings, booleans and null", () => {
        assert.equal(normalizeValue("text"), "text");
        assert.equal(normalizeValue(false), false);
        assert.equal(normalizeValue(null), null);
    });

    test("turns bytes into lowercase hex without a prefix", () => {
        assert.equal(normalizeValue(new Uint8Array([0, 171, 255])), "00abff");
        assert.equal(normalizeValue(Buffer.from([1, 2, 254])), "0102fe");
    });

    test("reads only the bytes that a view covers", () => {
        const bytes = new Uint8Array([1, 2, 3, 4]);

        assert.equal(normalizeValue(bytes.subarray(1, 3)), "0203");
    });

    test("normalizes arrays and objects at any depth", () => {
        const value = { list: [1n, { bytes: Buffer.from([9]), big: 2n ** 70n }], nested: { flag: true } };

        assert.deepEqual(normalizeValue(value), { list: [1, { bytes: "09", big: 2n ** 70n }], nested: { flag: true } });
    });

    test("leaves out the fields of an object that are undefined", () => {
        assert.deepEqual(normalizeValue({ present: 1, absent: undefined }), { present: 1 });
    });

    test("turns the structs and bytes in the state of an SDK node into plain values", async (t) => {
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
        assert.ok(Array.isArray(entry.subjects) && typeof entry.subjects[0] === "bigint");
        assert.match(String(certificate.noc), /^[0-9a-f]+$/);
    });

    const unsupported = [
        { title: "undefined", value: undefined },
        { title: "a symbol", value: Symbol("x") },
        { title: "a function", value: () => 1 },
        { title: "a Date", value: new Date(0) },
        { title: "a Map", value: new Map() },
        { title: "a Set", value: new Set() },
        { title: "NaN", value: Number.NaN },
        { title: "an infinity inside an array", value: [Number.POSITIVE_INFINITY] },
        { title: "an undefined element of an array", value: [undefined] },
        { title: "a Date inside an object", value: { when: new Date(0) } },
    ];
    for (const { title, value } of unsupported) {
        test(`throws InternalError for ${title}`, () => {
            assert.throws(() => normalizeValue(value), InternalError);
        });
    }
});
