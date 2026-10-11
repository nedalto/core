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
            connection.exec(`
                CREATE TABLE rooms (
                    id   TEXT PRIMARY KEY,
                    name TEXT NOT NULL
                ) STRICT;

                CREATE TABLE nodes (
                    id        TEXT PRIMARY KEY,
                    matter_id INTEGER NOT NULL UNIQUE
                ) STRICT;

                CREATE TABLE endpoints (
                    id            TEXT PRIMARY KEY,
                    node_id       TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                    matter_number INTEGER NOT NULL,
                    name          TEXT NOT NULL,
                    room_id       TEXT REFERENCES rooms(id) ON DELETE SET NULL,
                    UNIQUE (node_id, matter_number)
                ) STRICT;
            `);
        },
    },
];
