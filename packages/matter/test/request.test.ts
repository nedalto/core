import "../src/sdk-config.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Binding } from "@matter/main/clusters/binding";
import { ContentLauncher } from "@matter/main/clusters/content-launcher";
import { DoorLock } from "@matter/main/clusters/door-lock";
import { EnergyEvse } from "@matter/main/clusters/energy-evse";
import { GeneralCommissioning } from "@matter/main/clusters/general-commissioning";
import { Groups } from "@matter/main/clusters/groups";
import { Messages } from "@matter/main/clusters/messages";
import { OnOff } from "@matter/main/clusters/on-off";
import { Thermostat } from "@matter/main/clusters/thermostat";
import { UserLabel } from "@matter/main/clusters/user-label";
import { FabricIndex } from "@matter/main/types";

import { ValidationError, type ValidationIssue } from "@nedalto/contract/common/errors.ts";
import type { AttributeValue } from "@nedalto/contract/endpoint/types.ts";

import { invokeRequest, writeRequest } from "../src/request.ts";

const ENDPOINT = 1;

// The index that the device gave the fabric of the hub, other than 1, which the hub gives its own fabric.
const ON_PEER = FabricIndex(2);

type Cluster = Parameters<typeof writeRequest>[1];

function attributeOf(cluster: Cluster, id: number): Parameters<typeof writeRequest>[2] {
    const attribute = Object.values(cluster.attributes ?? {}).find((candidate) => candidate.id === id);
    assert.ok(attribute !== undefined);
    return attribute;
}

function commandOf(cluster: Cluster, id: number): Parameters<typeof invokeRequest>[2] {
    const command = Object.values(cluster.commands ?? {}).find((candidate) => candidate.id === id);
    assert.ok(command !== undefined);
    return command;
}

function issuesOf(build: () => unknown): readonly ValidationIssue[] {
    let issues: readonly ValidationIssue[] = [];
    assert.throws(build, (error: unknown) => {
        assert.ok(error instanceof ValidationError);
        issues = error.data.issues;
        return true;
    });
    return issues;
}

const ON_TIME = attributeOf(OnOff, 0x4001);

describe("writeRequest", () => {
    const misfitValues = [
        { title: "a string for a number", value: "thirty" },
        { title: "a number above the range of the type", value: 70_000 },
        { title: "null for a type that is not nullable", value: null },
    ];
    for (const { title, value } of misfitValues) {
        test(`throws ValidationError with the path for ${title}`, () => {
            const issues = issuesOf(() => writeRequest(ENDPOINT, OnOff, ON_TIME, value, ON_PEER));
            assert.deepEqual(
                issues.map(({ path }) => path),
                ["value"],
            );
        });
    }

    test("throws ValidationError for an object with a key that starts with $ and is not a tag", () => {
        const [issue] = issuesOf(() => writeRequest(ENDPOINT, OnOff, ON_TIME, { $number: "30" }, ON_PEER));
        // Not the type check of the SDK, which would also reject it, with another message.
        assert.equal(issue?.path, "value");
        assert.match(issue.message, /not a valid tag/);
    });

    test("throws ValidationError for a number with decimals in an integer attribute", () => {
        assert.deepEqual(
            issuesOf(() => writeRequest(ENDPOINT, OnOff, ON_TIME, 300.7, ON_PEER)),
            [{ path: "value", message: "value holds 300.7 for an integer field" }],
        );
    });

    const unsafe: { title: string; cluster: Cluster; attribute: number; value: AttributeValue }[] = [
        {
            title: "at the top of the safe range plus one",
            cluster: GeneralCommissioning,
            attribute: 0x0000,
            value: 2 ** 53,
        },
        {
            title: "at the bottom of the safe range minus one",
            cluster: EnergyEvse,
            attribute: 0x0009,
            value: -(2 ** 53),
        },
    ];
    for (const { title, cluster, attribute, value } of unsafe) {
        test(`throws ValidationError that asks for $integer for an untagged integer ${title}`, () => {
            assert.deepEqual(
                issuesOf(() => writeRequest(ENDPOINT, cluster, attributeOf(cluster, attribute), value, ON_PEER)),
                [
                    {
                        path: "value",
                        message: 'value holds an integer outside the safe range, which goes as { "$integer": "…" }',
                    },
                ],
            );
        });
    }

    const BINDING = attributeOf(Binding, 0x0000);
    const TARGET = { node: 1, endpoint: 1, cluster: 6 };

    test("throws ValidationError naming a field of a list entry that the attribute does not have", () => {
        assert.deepEqual(
            issuesOf(() => writeRequest(ENDPOINT, Binding, BINDING, [{ ...TARGET, extra: 1 }], ON_PEER)),
            [{ path: "value", message: "value[0].extra would not reach the device as given" }],
        );
    });

    test("throws ValidationError naming a field of a bitmap that the request would change", () => {
        // @matter/main 0.18.0: of the bitmaps that a client writes in the standard clusters, only this one has fields
        // wider than one bit. 5 does not fit the two bits of the cooling stage and would reach the device as 1, with a
        // heating stage that was not given.
        const configuration = attributeOf(Thermostat, 0x0009);

        assert.deepEqual(
            issuesOf(() => writeRequest(ENDPOINT, Thermostat, configuration, { coolingStage: 5 }, ON_PEER)),
            [{ path: "value", message: "value.coolingStage would not reach the device as given" }],
        );
    });

    test("treats a fabricIndex in a list that is not fabric-scoped as a field that the entry does not have", () => {
        const entry = { label: "room", value: "kitchen", fabricIndex: 7 };

        assert.deepEqual(
            issuesOf(() => writeRequest(ENDPOINT, UserLabel, attributeOf(UserLabel, 0x0000), [entry], ON_PEER)),
            [{ path: "value", message: "value[0].fabricIndex would not reach the device as given" }],
        );
    });

    test("leaves fabricIndex to the device for an entry of a fabric-scoped list that leaves it out", () => {
        assert.doesNotThrow(() => writeRequest(ENDPOINT, Binding, BINDING, [TARGET], ON_PEER));
    });

    test("accepts the fabricIndex that the device gave the hub, as a read returns it", () => {
        const entry = { ...TARGET, fabricIndex: ON_PEER };
        assert.doesNotThrow(() => writeRequest(ENDPOINT, Binding, BINDING, [entry], ON_PEER));
    });

    const otherIndexes: { title: string; onPeer: FabricIndex | undefined; fabricIndex: number; message: string }[] = [
        {
            title: "that is not the one the device gave the hub",
            onPeer: ON_PEER,
            fabricIndex: 1,
            message: "value[0].fabricIndex is set by the device to 2: leave it out",
        },
        {
            title: "while the one the device gave the hub is not known",
            onPeer: undefined,
            fabricIndex: 2,
            message: "value[0].fabricIndex is set by the device: leave it out",
        },
    ];
    for (const { title, onPeer, fabricIndex, message } of otherIndexes) {
        test(`throws ValidationError for a fabricIndex ${title}`, () => {
            assert.deepEqual(
                issuesOf(() => writeRequest(ENDPOINT, Binding, BINDING, [{ ...TARGET, fabricIndex }], onPeer)),
                [{ path: "value", message }],
            );
        });
    }
});

describe("invokeRequest", () => {
    const misfitArguments: { title: string; cluster: Cluster; command: number; args: AttributeValue }[] = [
        { title: "args for a command that takes none", cluster: OnOff, command: 0x01, args: { extra: 1 } },
        { title: "a mandatory field that is missing", cluster: Groups, command: 0x02, args: {} },
    ];
    for (const { title, cluster, command, args } of misfitArguments) {
        test(`throws ValidationError with the path for ${title}`, () => {
            const issues = issuesOf(() => invokeRequest(ENDPOINT, cluster, commandOf(cluster, command), args));
            assert.deepEqual(
                issues.map(({ path }) => path),
                ["args"],
            );
        });
    }

    const ON_WITH_TIMED_OFF = commandOf(OnOff, 0x42);
    const dropped: {
        title: string;
        cluster: Cluster;
        command: Parameters<typeof invokeRequest>[2];
        args: AttributeValue;
        lost: string;
    }[] = [
        {
            title: "a field that the command does not have",
            cluster: Groups,
            command: commandOf(Groups, 0x00),
            args: { groupId: 1, groupName: "Kitchen", extra: 1 },
            lost: "args.extra",
        },
        {
            title: "an optional field with a wrong name",
            cluster: DoorLock,
            command: commandOf(DoorLock, 0x00),
            args: { pincode: { $bytes: "31323334" } },
            lost: "args.pincode",
        },
        {
            title: "a flag that the bitmap does not have",
            cluster: OnOff,
            command: ON_WITH_TIMED_OFF,
            args: { onOffControl: { acceptOnlyWhenOn: true, bogus: true }, onTime: 1, offWaitTime: 1 },
            lost: "args.onOffControl.bogus",
        },
        {
            title: "a number for a bitmap",
            cluster: OnOff,
            command: ON_WITH_TIMED_OFF,
            args: { onOffControl: 1, onTime: 1, offWaitTime: 1 },
            lost: "args.onOffControl",
        },
        {
            title: "a flag that is not a boolean",
            cluster: OnOff,
            command: ON_WITH_TIMED_OFF,
            args: { onOffControl: { acceptOnlyWhenOn: "yes" }, onTime: 1, offWaitTime: 1 },
            lost: "args.onOffControl.acceptOnlyWhenOn",
        },
    ];
    for (const { title, cluster, command, args, lost } of dropped) {
        test(`throws ValidationError naming ${title}, which the request would drop or change`, () => {
            assert.deepEqual(
                issuesOf(() => invokeRequest(ENDPOINT, cluster, command, args)),
                [{ path: "args", message: `${lost} would not reach the device as given` }],
            );
        });
    }

    test("keeps a bitmap that gives only some of its flags", () => {
        const args = { onOffControl: {}, onTime: 1, offWaitTime: 1 };
        assert.doesNotThrow(() => invokeRequest(ENDPOINT, OnOff, ON_WITH_TIMED_OFF, args));
    });

    test("throws ValidationError for a number with decimals in an integer field", () => {
        const args = { onOffControl: { acceptOnlyWhenOn: false }, onTime: 25, offWaitTime: 7.2 };
        const issues = issuesOf(() => invokeRequest(ENDPOINT, OnOff, ON_WITH_TIMED_OFF, args));
        assert.deepEqual(
            issues.map(({ path }) => path),
            ["args"],
        );
    });

    test("throws ValidationError for a text that the SDK would send with a length that does not fit", () => {
        // 250 characters in 256 bytes, the most that the field takes, which @matter/types 0.18.0 sizes by characters.
        // With the update to 0.18.1, which fixes it, this test fails: it goes with the check.
        const messageText = "é".repeat(6) + "x".repeat(244);
        const args = {
            messageId: { $bytes: "000102030405060708090a0b0c0d0e0f" },
            priority: 0,
            messageControl: {},
            startTime: null,
            duration: null,
            messageText,
        };

        assert.deepEqual(
            issuesOf(() => invokeRequest(ENDPOINT, Messages, commandOf(Messages, 0x00), args)),
            [{ path: "args", message: "args holds a text of 256 bytes in 250 characters, which the SDK cannot send" }],
        );
    });

    test("keeps numbers with decimals or beyond the safe range in fields with decimals", () => {
        // @matter/main 0.18.0: the sizes of the branding of LaunchUrl are the only fields with decimals that the
        // standard clusters take.
        const args = {
            contentUrl: "https://example.com",
            brandingInformation: {
                providerName: "Example",
                background: { size: { width: 1.5, height: 2 ** 60, metric: 0 } },
            },
        };
        assert.doesNotThrow(() => invokeRequest(ENDPOINT, ContentLauncher, commandOf(ContentLauncher, 0x01), args));
    });
});
