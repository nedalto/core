import type { DatabaseSync, StatementSync } from "node:sqlite";

import type { NodeId } from "@nedalto/contract/common/ids.ts";
import { NodeNotFoundError } from "@nedalto/contract/node/errors.ts";
import type { NodeRepository } from "@nedalto/contract/node/ports.ts";
import type { NodeRecord } from "@nedalto/contract/node/types.ts";

import { toNodeRecord, toStoredMatterId } from "../rows.ts";

export class SqliteNodeRepository implements NodeRepository {
    readonly #findById: StatementSync;
    readonly #findAll: StatementSync;
    readonly #insert: StatementSync;
    readonly #delete: StatementSync;

    constructor(connection: DatabaseSync) {
        this.#findById = connection.prepare("SELECT id, matter_id FROM nodes WHERE id = ?", { readBigInts: true });
        this.#findAll = connection.prepare("SELECT id, matter_id FROM nodes ORDER BY id", { readBigInts: true });
        this.#insert = connection.prepare("INSERT INTO nodes (id, matter_id) VALUES (?, ?)");
        this.#delete = connection.prepare("DELETE FROM nodes WHERE id = ?");
    }

    findById(id: NodeId): NodeRecord | null {
        const row = this.#findById.get(id);
        return row === undefined ? null : toNodeRecord(row);
    }

    findAll(): NodeRecord[] {
        return this.#findAll.all().map(toNodeRecord);
    }

    save(record: NodeRecord): void {
        this.#insert.run(record.id, toStoredMatterId(record.matterId));
    }

    delete(id: NodeId): void {
        if (this.#delete.run(id).changes === 0) {
            throw new NodeNotFoundError(id);
        }
    }
}
