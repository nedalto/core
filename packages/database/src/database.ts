import { DatabaseSync } from "node:sqlite";

import { IntegrationError, InternalError } from "@nedalto/contract/common/errors.ts";
import type { Lifecycle } from "@nedalto/contract/common/lifecycle.ts";
import type { Transactor } from "@nedalto/contract/database/ports.ts";
import type { EndpointRepository } from "@nedalto/contract/endpoint/ports.ts";
import type { Logger } from "@nedalto/contract/logger/ports.ts";
import type { NodeRepository } from "@nedalto/contract/node/ports.ts";
import type { RoomRepository } from "@nedalto/contract/room/ports.ts";

import { MIGRATIONS } from "./migrations.ts";
import { SqliteEndpointRepository } from "./repositories/endpoint.ts";
import { SqliteNodeRepository } from "./repositories/node.ts";
import { SqliteRoomRepository } from "./repositories/room.ts";
import { readUserVersion } from "./rows.ts";
import { SqliteTransactor } from "./transactor.ts";

/**
 * The database: `start()` opens the file and applies the pending migrations, `stop()` closes it.
 * The transactor and the repositories are available between `start()` and `stop()`.
 */
export interface Database extends Lifecycle {
    readonly transactor: Transactor;
    readonly node: NodeRepository;
    readonly endpoint: EndpointRepository;
    readonly room: RoomRepository;
}

interface Open {
    readonly connection: DatabaseSync;
    readonly transactor: Transactor;
    readonly node: NodeRepository;
    readonly endpoint: EndpointRepository;
    readonly room: RoomRepository;
}

class SqliteDatabase implements Database {
    readonly #filePath: string;
    readonly #logger: Logger;
    #open: Open | undefined;

    constructor(filePath: string, logger: Logger) {
        this.#filePath = filePath;
        this.#logger = logger.get("Database");
    }

    get transactor(): Transactor {
        return this.#opened().transactor;
    }

    get node(): NodeRepository {
        return this.#opened().node;
    }

    get endpoint(): EndpointRepository {
        return this.#opened().endpoint;
    }

    get room(): RoomRepository {
        return this.#opened().room;
    }

    async start(): Promise<void> {
        const connection = new DatabaseSync(this.#filePath);

        // Set explicitly although Node 26.10 already defaults foreign_keys to ON and synchronous to
        // FULL: the cascades depend on the first, and FULL is chosen over NORMAL because a commit
        // lost to a power cut can leave a device holding a fabric nothing here records.
        connection.exec("PRAGMA journal_mode = WAL;");
        connection.exec("PRAGMA foreign_keys = ON;");
        connection.exec("PRAGMA synchronous = FULL;");

        const transactor = new SqliteTransactor(connection);
        this.#migrate(connection, transactor);

        this.#open = {
            connection,
            transactor,
            node: new SqliteNodeRepository(connection),
            endpoint: new SqliteEndpointRepository(connection),
            room: new SqliteRoomRepository(connection),
        };
        this.#logger.notice("ready", this.#filePath);
    }

    async stop(): Promise<void> {
        const open = this.#open;
        if (open === undefined) {
            return;
        }
        this.#open = undefined;

        open.connection.close();
        this.#logger.notice("closed");
    }

    #opened(): Open {
        if (this.#open === undefined) {
            throw new InternalError("Database accessed outside its start()/stop() window");
        }
        return this.#open;
    }

    #migrate(connection: DatabaseSync, transactor: SqliteTransactor): void {
        const current = readUserVersion(connection);
        for (const migration of MIGRATIONS.filter(({ version }) => version > current)) {
            try {
                // Atomic, so an interrupted migration never leaves a version half applied.
                // PRAGMA takes no bound parameters.
                transactor.run(() => {
                    migration.up(connection);
                    connection.exec(`PRAGMA user_version = ${migration.version};`);
                });
            } catch (error) {
                throw new IntegrationError(`Migration ${migration.version} failed`, {
                    cause: error,
                    data: { reason: "migration-failed", version: migration.version },
                });
            }
            this.#logger.notice("migrated to schema version", migration.version, migration.description);
        }
    }
}

/** A `Database` over the SQLite file at `filePath`, which is created if it does not exist. */
export const createSqliteDatabase = (filePath: string, logger: Logger): Database =>
    new SqliteDatabase(filePath, logger);
