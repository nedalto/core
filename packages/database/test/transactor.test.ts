import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, test } from "node:test";

import { SqliteTransactor } from "../src/transactor.ts";

function openConnection(): DatabaseSync {
    const connection = new DatabaseSync(":memory:");
    connection.exec("CREATE TABLE t (value TEXT NOT NULL) STRICT;");
    return connection;
}

const insert = (connection: DatabaseSync, value: string): void => {
    connection.prepare("INSERT INTO t (value) VALUES (?)").run(value);
};

const rowCount = (connection: DatabaseSync): number => connection.prepare("SELECT value FROM t").all().length;

describe("SqliteTransactor", () => {
    test("commits and returns the result when the transaction returns", () => {
        const connection = openConnection();

        const result = new SqliteTransactor(connection).run(() => {
            insert(connection, "a");
            return 42;
        });

        assert.equal(result, 42);
        assert.equal(rowCount(connection), 1);
    });

    test("rolls every write back and rethrows the original error when the transaction throws", () => {
        const connection = openConnection();
        const original = new Error("boom");

        assert.throws(
            () =>
                new SqliteTransactor(connection).run(() => {
                    insert(connection, "a");
                    insert(connection, "b");
                    throw original;
                }),
            (error) => error === original,
        );
        assert.equal(rowCount(connection), 0);
    });

    test("rethrows the original error when the rollback itself fails", () => {
        const connection = openConnection();
        const original = new Error("boom");

        assert.throws(
            () =>
                new SqliteTransactor(connection).run(() => {
                    // Ends the transaction, so the rollback that follows the throw has nothing to undo.
                    connection.exec("ROLLBACK");
                    throw original;
                }),
            (error) => error === original,
        );
    });

    test("rolls back and rethrows when the commit fails, so the next transaction can start", () => {
        const connection = openConnection();
        connection.exec("CREATE TABLE parent (id INTEGER PRIMARY KEY) STRICT;");
        connection.exec("CREATE TABLE child (parent INTEGER REFERENCES parent(id)) STRICT;");
        const transactor = new SqliteTransactor(connection);

        assert.throws(
            () =>
                transactor.run(() => {
                    // Moves the foreign key check of the orphan to the commit, which then fails.
                    connection.exec("PRAGMA defer_foreign_keys = ON;");
                    connection.prepare("INSERT INTO child (parent) VALUES (1)").run();
                }),
            { message: "FOREIGN KEY constraint failed" },
        );

        transactor.run(() => insert(connection, "a"));
        assert.equal(rowCount(connection), 1);
    });

    test("throws when the transaction is nested and rolls everything back", () => {
        const connection = openConnection();
        const transactor = new SqliteTransactor(connection);

        assert.throws(() =>
            transactor.run(() => {
                insert(connection, "a");
                transactor.run(() => undefined);
            }),
        );
        assert.equal(rowCount(connection), 0);
    });
});
