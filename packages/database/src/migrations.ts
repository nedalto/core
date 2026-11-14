import type { DatabaseSync } from "node:sqlite";

export interface Migration {
    readonly version: number;
    readonly description: string;
    readonly up: (connection: DatabaseSync) => void;
}

export const MIGRATIONS: readonly Migration[] = [
    {
        version: 1,
        description: "rooms, nodes and endpoints",
        up: (connection) => {
            // Deleting a node or a room needs no further statement: the repositories rely on these
            // two actions, which fire because the connection enforces foreign keys.
            // AUTOINCREMENT keeps SQLite from giving a new room the id of the last one deleted.
            // WITHOUT ROWID stores endpoints ordered by their key, with no hidden rowid or extra index.
            connection.exec(`
                CREATE TABLE rooms (
                    id   INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL
                ) STRICT;

                CREATE TABLE nodes (
                    id INTEGER PRIMARY KEY
                ) STRICT;

                CREATE TABLE endpoints (
                    node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                    number  INTEGER NOT NULL,
                    name    TEXT NOT NULL,
                    room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
                    PRIMARY KEY (node_id, number)
                ) STRICT, WITHOUT ROWID;
            `);
        },
    },
];
