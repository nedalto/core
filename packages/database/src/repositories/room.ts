import type { DatabaseSync, StatementSync } from "node:sqlite";

import type { RoomId } from "@nedalto/contract/common/ids.ts";
import { RoomNotFoundError } from "@nedalto/contract/room/errors.ts";
import type { RoomRepository } from "@nedalto/contract/room/ports.ts";
import type { RoomRecord } from "@nedalto/contract/room/types.ts";

import { toRoomRecord } from "../rows.ts";

export class SqliteRoomRepository implements RoomRepository {
    readonly #findById: StatementSync;
    readonly #findAll: StatementSync;
    readonly #insert: StatementSync;
    readonly #updateName: StatementSync;
    readonly #delete: StatementSync;

    constructor(connection: DatabaseSync) {
        this.#findById = connection.prepare("SELECT id, name FROM rooms WHERE id = ?");
        this.#findAll = connection.prepare("SELECT id, name FROM rooms ORDER BY name");
        this.#insert = connection.prepare("INSERT INTO rooms (id, name) VALUES (?, ?)");
        this.#updateName = connection.prepare("UPDATE rooms SET name = ? WHERE id = ?");
        this.#delete = connection.prepare("DELETE FROM rooms WHERE id = ?");
    }

    findById(id: RoomId): RoomRecord | null {
        const row = this.#findById.get(id);
        return row === undefined ? null : toRoomRecord(row);
    }

    findAll(): RoomRecord[] {
        return this.#findAll.all().map(toRoomRecord);
    }

    save(record: RoomRecord): void {
        this.#insert.run(record.id, record.name);
    }

    setName(id: RoomId, name: string): void {
        if (this.#updateName.run(name, id).changes === 0) {
            throw new RoomNotFoundError(id);
        }
    }

    delete(id: RoomId): void {
        if (this.#delete.run(id).changes === 0) {
            throw new RoomNotFoundError(id);
        }
    }
}
