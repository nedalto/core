import type { DatabaseSync, StatementSync } from "node:sqlite";

import type { NodeId } from "@nedalto/contract/common/ids.ts";
import { NodeNotFoundError } from "@nedalto/contract/node/errors.ts";
import type { NodeRepository } from "@nedalto/contract/node/ports.ts";
import type { NodeRecord } from "@nedalto/contract/node/types.ts";

import { insertedRow, toNodeRecord, toStoredNodeId } from "../rows.ts";

export class SqliteNodeRepository implements NodeRepository {
    readonly #findById: StatementSync;
    readonly #findAll: StatementSync;
    readonly #insert: StatementSync;
    readonly #delete: StatementSync;

    constructor(connection: DatabaseSync) {
        this.#findById = connection.prepare("SELECT id FROM nodes WHERE id = ?");
        // `id < 0` puts last the ids of 2^63 and more, which are stored negative.
        this.#findAll = connection.prepare("SELECT id FROM nodes ORDER BY id < 0, id");
        this.#insert = connection.prepare("INSERT INTO nodes (id) VALUES (?) RETURNING id");
        this.#delete = connection.prepare("DELETE FROM nodes WHERE id = ?");
    }

    findById(id: NodeId): NodeRecord | null {
        const row = this.#findById.get(toStoredNodeId(id));
        return row === undefined ? null : toNodeRecord(row);
    }

    findAll(): NodeRecord[] {
        return this.#findAll.all().map(toNodeRecord);
    }

    create(id: NodeId): NodeRecord {
        return toNodeRecord(insertedRow(this.#insert, toStoredNodeId(id)));
    }

    delete(id: NodeId): void {
        if (this.#delete.run(toStoredNodeId(id)).changes === 0n) {
            throw new NodeNotFoundError(id);
        }
    }
}
