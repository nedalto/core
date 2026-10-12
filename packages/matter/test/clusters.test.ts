import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { findSpecAttribute, findSpecCommand } from "../src/clusters.ts";

const ON_OFF = 0x06;
const ON_TIME = 0x4001;
const ON = 0x01;
const GROUPS = 0x04;
const ADD_GROUP = 0x00;
// A cluster of a manufacturer: its vendor prefix is the CSA test vendor and its suffix is in the manufacturer range.
const VENDOR_CLUSTER = 0xfff1fc01;

describe("findSpecAttribute", () => {
    test("finds an attribute by the ids of its cluster and itself", () => {
        const found = findSpecAttribute(ON_OFF, ON_TIME);

        assert.ok(found !== undefined);
        assert.equal(found.cluster.id, ON_OFF);
        assert.equal(found.attribute.id, ON_TIME);
    });

    test("finds nothing for a global attribute", () => {
        // 0xFFFC is FeatureMap, which every cluster has.
        assert.equal(findSpecAttribute(ON_OFF, 0xfffc), undefined);
    });

    test("finds nothing for an attribute the cluster does not define", () => {
        assert.equal(findSpecAttribute(ON_OFF, 0x0999), undefined);
    });

    test("finds nothing for a cluster outside the specification", () => {
        assert.equal(findSpecAttribute(VENDOR_CLUSTER, 0), undefined);
    });
});

describe("findSpecCommand", () => {
    test("finds a command by the ids of its cluster and itself", () => {
        const found = findSpecCommand(ON_OFF, ON);

        assert.ok(found !== undefined);
        assert.equal(found.cluster.id, ON_OFF);
        assert.equal(found.command.id, ON);
    });

    test("finds the request when a response has the same id", () => {
        // AddGroup and AddGroupResponse are both command 0 of Groups.
        const found = findSpecCommand(GROUPS, ADD_GROUP);

        assert.ok(found !== undefined);
        assert.equal(found.command.name, "addGroup");
    });

    test("finds nothing for a command the cluster does not define", () => {
        assert.equal(findSpecCommand(ON_OFF, 0x99), undefined);
    });

    test("finds nothing for a cluster outside the specification", () => {
        assert.equal(findSpecCommand(VENDOR_CLUSTER, 0), undefined);
    });
});
