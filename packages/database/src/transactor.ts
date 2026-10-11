import type { DatabaseSync } from "node:sqlite";

import type { Transactor } from "@nedalto/contract/database/ports.ts";

export class SqliteTransactor implements Transactor {
    readonly #connection: DatabaseSync;

    constructor(connection: DatabaseSync) {
        this.#connection = connection;
    }

    run<T>(transaction: () => T): T {
        this.#connection.exec("BEGIN");
        let result: T;
        try {
            result = transaction();
        } catch (error) {
            try {
                this.#connection.exec("ROLLBACK");
            } catch {
                // The caller needs the error that got us here, not the one from undoing it.
            }
            throw error;
        }
        this.#connection.exec("COMMIT");
        return result;
    }
}
