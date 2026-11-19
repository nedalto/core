import type { DatabaseSync, SQLInputValue, SQLOutputValue, StatementSync } from "node:sqlite";

import {
    type EndpointId,
    type NodeId,
    parseEndpointId,
    parseNodeId,
    type RoomId,
    toEndpointId,
    toNodeId,
    toRoomId,
} from "@nedalto/contract/common/ids.ts";
import type { EndpointRecord } from "@nedalto/contract/endpoint/types.ts";
import type { NodeRecord } from "@nedalto/contract/node/types.ts";
import type { RoomRecord } from "@nedalto/contract/room/types.ts";

/**
 * A row as node:sqlite returns it, every column untyped. The assertions on rows are safe because
 * every table is STRICT: SQLite checks the type of each column when it is written, so what a
 * column holds on reading is what its declaration says. Every INTEGER comes out as a bigint
 * (the connection sets `readBigInts`), so a column the record holds as a number is converted here.
 */
type Row = Record<string, SQLOutputValue>;

// SQLite always answers `PRAGMA user_version` with one row holding an integer.
export const readUserVersion = (connection: DatabaseSync): number =>
    Number((connection.prepare("PRAGMA user_version").get() as { user_version: bigint }).user_version);

// An `INSERT … RETURNING` yields one row whenever the insert does not throw.
export const insertedRow = (statement: StatementSync, ...values: SQLInputValue[]): Row =>
    statement.get(...values) as Row;

/**
 * Node 26.13: a bigint of 2^63 or more cannot be bound, so a Matter node id (a uint64) is stored
 * as the signed int64 with the same bits.
 */
const toStoredMatterId = (matterId: bigint): bigint => BigInt.asIntN(64, matterId);

export const toStoredNodeId = (nodeId: NodeId): bigint => toStoredMatterId(parseNodeId(nodeId));

export function toStoredEndpointKey(endpointId: EndpointId): [nodeId: bigint, number: number] {
    const { matterId, number } = parseEndpointId(endpointId);
    return [toStoredMatterId(matterId), number];
}

export const toStoredRoomId = (roomId: RoomId): bigint => BigInt(roomId);

const fromStoredNodeId = (stored: bigint): NodeId => toNodeId(BigInt.asUintN(64, stored));

export const toNodeRecord = (row: Row): NodeRecord => ({ id: fromStoredNodeId(row.id as bigint) });

// The connection reads every INTEGER as a bigint, so the endpoint number is turned back into a number.
export function toEndpointRecord(row: Row): EndpointRecord {
    const nodeId = fromStoredNodeId(row.node_id as bigint);
    const number = Number(row.number);
    return {
        id: toEndpointId(nodeId, number),
        nodeId,
        number,
        name: row.name as string,
        roomId: row.room_id === null ? null : toRoomId(row.room_id as bigint),
    };
}

export const toRoomRecord = (row: Row): RoomRecord => ({
    id: toRoomId(row.id as bigint),
    name: row.name as string,
});
