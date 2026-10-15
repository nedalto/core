import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { decode, encode } from "../../src/common/wire.ts";

describe("decode", () => {
    test("reads an integer outside the safe range exactly, as a bigint", () => {
        assert.deepEqual(decode("[12345678901234567890, -12345678901234567890, 9007199254740993]"), [
            12345678901234567890n,
            -12345678901234567890n,
            9007199254740993n,
        ]);
    });

    test("reads an integer inside the safe range as a number, whatever its width", () => {
        assert.deepEqual(decode('{"a": 5, "b": 9007199254740991, "c": -9007199254740991}'), {
            a: 5,
            b: Number.MAX_SAFE_INTEGER,
            c: Number.MIN_SAFE_INTEGER,
        });
    });

    test("reads the first integer past the safe range as a bigint", () => {
        assert.equal(decode("9007199254740992"), 9007199254740992n);
    });

    test("reads a number written with a fraction or an exponent as a number", () => {
        assert.deepEqual(decode("[1.5, 1e3, 1.0, 1e30, 9007199254740993.0]"), [1.5, 1000, 1, 1e30, 9007199254740992]);
    });

    test("reads a bigint nested in objects and arrays", () => {
        assert.deepEqual(decode('{"a": [{"b": 12345678901234567890}]}'), { a: [{ b: 12345678901234567890n }] });
    });

    test("leaves a string of digits as a string", () => {
        assert.equal(decode('"12345678901234567890"'), "12345678901234567890");
    });

    test("throws when the text is not JSON", () => {
        assert.throws(() => decode("{ not json"), SyntaxError);
    });
});

describe("encode", () => {
    test("writes a bigint outside the safe range as a number, without rounding it", () => {
        assert.equal(
            encode({ a: 12345678901234567890n, b: [-9007199254740993n] }),
            '{"a":12345678901234567890,"b":[-9007199254740993]}',
        );
    });

    test("writes a small bigint as the number that decode reads back", () => {
        const text = encode({ value: 5n });

        assert.equal(text, '{"value":5}');
        assert.deepEqual(decode(text), { value: 5 });
    });

    test("writes everything else as JSON does", () => {
        assert.equal(encode({ a: "text", b: [1, 1.5, null, true] }), '{"a":"text","b":[1,1.5,null,true]}');
    });
});
