import type { DatabaseSync, StatementSync } from "node:sqlite";

import type { RoomId } from "@nedalto/contract/common/ids.ts";
import { RoomNotFoundError } from "@nedalto/contract/room/errors.ts";
import type { RoomRepository } from "@nedalto/contract/room/ports.ts";
import type { RoomRecord } from "@nedalto/contract/room/types.ts";

import { insertedRow, toRoomRecord, toStoredRoomId } from "../rows.ts";

export class SqliteRoomRepository implements RoomRepository {
    readonly #findById: StatementSync;
    readonly #findAll: StatementSync;
    readonly #insert: StatementSync;
    readonly #updateName: StatementSync;
    readonly #delete: StatementSync;

    constructor(connection: DatabaseSync) {
        this.#findById = connection.prepare("SELECT id, name FROM rooms WHERE id = ?");
        this.#findAll = connection.prepare("SELECT id, name FROM rooms ORDER BY id");
        this.#insert = connection.prepare("INSERT INTO rooms (name) VALUES (?) RETURNING id, name");
        this.#updateName = connection.prepare("UPDATE rooms SET name = ? WHERE id = ?");
        this.#delete = connection.prepare("DELETE FROM rooms WHERE id = ?");
    }

    findById(id: RoomId): RoomRecord | null {
        const row = this.#findById.get(toStoredRoomId(id));
        return row === undefined ? null : toRoomRecord(row);
    }

    findAll(): RoomRecord[] {
        return this.#findAll.all().map(toRoomRecord);
    }

    create(name: string): RoomRecord {
        return toRoomRecord(insertedRow(this.#insert, name));
    }

    setName(id: RoomId, name: string): void {
        if (this.#updateName.run(name, toStoredRoomId(id)).changes === 0n) {
            throw new RoomNotFoundError(id);
        }
    }

    delete(id: RoomId): void {
        if (this.#delete.run(toStoredRoomId(id)).changes === 0n) {
            throw new RoomNotFoundError(id);
        }
    }
}
