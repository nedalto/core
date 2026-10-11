import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

import type { EndpointId, NodeId, RoomId } from "@nedalto/contract/common/ids.ts";
import type { EndpointRecord } from "@nedalto/contract/endpoint/types.ts";
import type { NodeRecord } from "@nedalto/contract/node/types.ts";
import type { RoomRecord } from "@nedalto/contract/room/types.ts";

/**
 * A row as node:sqlite returns it, every column untyped. The assertions on rows are safe because
 * every table is STRICT: SQLite checks the type of each column when it is written, so what a
 * column holds on reading is what its declaration says.
 */
type Row = Record<string, SQLOutputValue>;

// SQLite always answers `PRAGMA user_version` with one row holding an integer.
export const readUserVersion = (connection: DatabaseSync): number =>
    (connection.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;

export const toRoomRecord = (row: Row): RoomRecord => ({
    id: row.id as RoomId,
    name: row.name as string,
});

/**
 * Node 26.10: a bigint of 2^63 or more cannot be bound, so a Matter node id (a uint64) is stored
 * as the signed int64 with the same bits. `toNodeRecord` converts it back.
 */
export const toStoredMatterId = (matterId: bigint): bigint => BigInt.asIntN(64, matterId);

/**
 * The row must come from a statement prepared with `readBigInts`: Node 26.10 reads an INTEGER as
 * a number otherwise, and throws past 2^53.
 */
export const toNodeRecord = (row: Row): NodeRecord => ({
    id: row.id as NodeId,
    matterId: BigInt.asUintN(64, row.matter_id as bigint),
});

export const toEndpointRecord = (row: Row): EndpointRecord => ({
    id: row.id as EndpointId,
    nodeId: row.node_id as NodeId,
    matterNumber: row.matter_number as number,
    name: row.name as string,
    roomId: row.room_id as RoomId | null,
});
