import type { DatabaseSync, StatementSync } from "node:sqlite";

import type { EndpointId, NodeId, RoomId } from "@nedalto/contract/common/ids.ts";
import { EndpointNotFoundError } from "@nedalto/contract/endpoint/errors.ts";
import type { EndpointRepository } from "@nedalto/contract/endpoint/ports.ts";
import type { EndpointRecord } from "@nedalto/contract/endpoint/types.ts";

import { toEndpointRecord } from "../rows.ts";

const COLUMNS = "id, node_id, matter_number, name, room_id";

export class SqliteEndpointRepository implements EndpointRepository {
    readonly #findById: StatementSync;
    readonly #findAll: StatementSync;
    readonly #findByNode: StatementSync;
    readonly #insert: StatementSync;
    readonly #updateName: StatementSync;
    readonly #updateRoom: StatementSync;

    constructor(connection: DatabaseSync) {
        this.#findById = connection.prepare(`SELECT ${COLUMNS} FROM endpoints WHERE id = ?`);
        this.#findAll = connection.prepare(`SELECT ${COLUMNS} FROM endpoints ORDER BY node_id, matter_number`);
        this.#findByNode = connection.prepare(
            `SELECT ${COLUMNS} FROM endpoints WHERE node_id = ? ORDER BY matter_number`,
        );
        this.#insert = connection.prepare(`INSERT INTO endpoints (${COLUMNS}) VALUES (?, ?, ?, ?, ?)`);
        this.#updateName = connection.prepare("UPDATE endpoints SET name = ? WHERE id = ?");
        this.#updateRoom = connection.prepare("UPDATE endpoints SET room_id = ? WHERE id = ?");
    }

    findById(id: EndpointId): EndpointRecord | null {
        const row = this.#findById.get(id);
        return row === undefined ? null : toEndpointRecord(row);
    }

    findAll(): EndpointRecord[] {
        return this.#findAll.all().map(toEndpointRecord);
    }

    findByNode(nodeId: NodeId): EndpointRecord[] {
        return this.#findByNode.all(nodeId).map(toEndpointRecord);
    }

    save(record: EndpointRecord): void {
        this.#insert.run(record.id, record.nodeId, record.matterNumber, record.name, record.roomId);
    }

    setName(id: EndpointId, name: string): void {
        if (this.#updateName.run(name, id).changes === 0) {
            throw new EndpointNotFoundError(id);
        }
    }

    setRoom(id: EndpointId, roomId: RoomId | null): void {
        if (this.#updateRoom.run(roomId, id).changes === 0) {
            throw new EndpointNotFoundError(id);
        }
    }
}
