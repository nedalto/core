import type { DatabaseSync, StatementSync } from "node:sqlite";

import type { EndpointId, NodeId, RoomId } from "@nedalto/contract/common/ids.ts";
import { EndpointNotFoundError } from "@nedalto/contract/endpoint/errors.ts";
import type { EndpointRepository } from "@nedalto/contract/endpoint/ports.ts";
import type { EndpointRecord, DeviceEndpoint } from "@nedalto/contract/endpoint/types.ts";

import { insertedRow, toEndpointRecord, toStoredEndpointKey, toStoredNodeId, toStoredRoomId } from "../rows.ts";

const COLUMNS = "node_id, number, name, room_id";
const KEY = "node_id = ? AND number = ?";

export class SqliteEndpointRepository implements EndpointRepository {
    readonly #findById: StatementSync;
    readonly #findAll: StatementSync;
    readonly #findByNode: StatementSync;
    readonly #insert: StatementSync;
    readonly #updateName: StatementSync;
    readonly #updateRoom: StatementSync;
    readonly #delete: StatementSync;

    constructor(connection: DatabaseSync) {
        this.#findById = connection.prepare(`SELECT ${COLUMNS} FROM endpoints WHERE ${KEY}`);
        // `node_id < 0` puts last the node ids of 2^63 and more, which are stored negative.
        this.#findAll = connection.prepare(`SELECT ${COLUMNS} FROM endpoints ORDER BY node_id < 0, node_id, number`);
        this.#findByNode = connection.prepare(`SELECT ${COLUMNS} FROM endpoints WHERE node_id = ? ORDER BY number`);
        this.#insert = connection.prepare(
            `INSERT INTO endpoints (node_id, number, name) VALUES (?, ?, ?) RETURNING ${COLUMNS}`,
        );
        this.#updateName = connection.prepare(`UPDATE endpoints SET name = ? WHERE ${KEY}`);
        this.#updateRoom = connection.prepare(`UPDATE endpoints SET room_id = ? WHERE ${KEY}`);
        this.#delete = connection.prepare(`DELETE FROM endpoints WHERE ${KEY}`);
    }

    findById(id: EndpointId): EndpointRecord | null {
        const row = this.#findById.get(...toStoredEndpointKey(id));
        return row === undefined ? null : toEndpointRecord(row);
    }

    findAll(): EndpointRecord[] {
        return this.#findAll.all().map(toEndpointRecord);
    }

    findByNode(nodeId: NodeId): EndpointRecord[] {
        return this.#findByNode.all(toStoredNodeId(nodeId)).map(toEndpointRecord);
    }

    create({ nodeId, number, name }: DeviceEndpoint): EndpointRecord {
        return toEndpointRecord(insertedRow(this.#insert, toStoredNodeId(nodeId), number, name));
    }

    setName(id: EndpointId, name: string): void {
        if (this.#updateName.run(name, ...toStoredEndpointKey(id)).changes === 0n) {
            throw new EndpointNotFoundError(id);
        }
    }

    setRoom(id: EndpointId, roomId: RoomId | null): void {
        const storedRoomId = roomId === null ? null : toStoredRoomId(roomId);
        if (this.#updateRoom.run(storedRoomId, ...toStoredEndpointKey(id)).changes === 0n) {
            throw new EndpointNotFoundError(id);
        }
    }

    delete(id: EndpointId): void {
        if (this.#delete.run(...toStoredEndpointKey(id)).changes === 0n) {
            throw new EndpointNotFoundError(id);
        }
    }
}
