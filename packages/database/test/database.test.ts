import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, test } from "node:test";

import { IntegrationError, InternalError } from "@nedalto/contract/common/errors.ts";
import { createRoomId } from "@nedalto/contract/common/ids.ts";

import { createSqliteDatabase } from "../src/database.ts";
import { MIGRATIONS } from "../src/migrations.ts";
import { defer } from "./helpers/cleanup.ts";
import { openDatabase, temporaryDatabasePath } from "./helpers/database.ts";
import { RecordingLogger } from "./helpers/logger.ts";

const isInternalError = (error: unknown): boolean => error instanceof InternalError && error.code === "INTERNAL_ERROR";

describe("createSqliteDatabase", () => {
    test("records the schema version it migrated to", async (context) => {
        const path = temporaryDatabasePath(context);
        const database = createSqliteDatabase(path, new RecordingLogger());
        await database.start();
        await database.stop();

        const raw = new DatabaseSync(path);
        defer(context, () => raw.close());

        assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, MIGRATIONS.at(-1)?.version);
    });

    test("logs each migration it applies", async (context) => {
        const logger = new RecordingLogger();
        const database = createSqliteDatabase(temporaryDatabasePath(context), logger);
        defer(context, () => database.stop());

        await database.start();

        assert.equal(
            logger.notices.filter(([message]) => message === "migrated to schema version").length,
            MIGRATIONS.length,
        );
    });

    test("keeps the data when a new instance opens the same file", async (context) => {
        const path = temporaryDatabasePath(context);
        const roomId = createRoomId();
        const first = createSqliteDatabase(path, new RecordingLogger());
        await first.start();
        first.room.save({ id: roomId, name: "Kitchen" });
        await first.stop();

        const second = createSqliteDatabase(path, new RecordingLogger());
        defer(context, () => second.stop());
        await second.start();

        assert.deepEqual(second.room.findById(roomId), { id: roomId, name: "Kitchen" });
    });

    test("closes the connection on stop()", async (context) => {
        const path = temporaryDatabasePath(context);
        const database = createSqliteDatabase(path, new RecordingLogger());
        await database.start();
        database.room.save({ id: createRoomId(), name: "Kitchen" });

        await database.stop();

        // Node 26.10: SQLite removes the write-ahead log when the last connection to the file closes.
        assert.equal(existsSync(`${path}-wal`), false);
    });

    test("throws InternalError when its capabilities are used before start()", (context) => {
        const database = createSqliteDatabase(temporaryDatabasePath(context), new RecordingLogger());

        assert.throws(() => database.transactor, isInternalError);
        assert.throws(() => database.node, isInternalError);
        assert.throws(() => database.endpoint, isInternalError);
        assert.throws(() => database.room, isInternalError);
    });

    test("throws InternalError when its capabilities are used after stop()", async (context) => {
        const database = await openDatabase(context);

        await database.stop();

        assert.throws(() => database.transactor, isInternalError);
        assert.throws(() => database.node, isInternalError);
        assert.throws(() => database.endpoint, isInternalError);
        assert.throws(() => database.room, isInternalError);
    });

    test("does nothing on stop() before start()", async (context) => {
        const database = createSqliteDatabase(temporaryDatabasePath(context), new RecordingLogger());

        await database.stop();
    });

    test("fails start() with an IntegrationError and applies no part of the failed migration", async (context) => {
        // An `endpoints` table of another shape, so the migration creates `rooms` and `nodes` and then fails.
        const path = temporaryDatabasePath(context);
        const raw = new DatabaseSync(path);
        raw.exec("CREATE TABLE endpoints (unrelated INTEGER) STRICT;");
        defer(context, () => raw.close());
        const database = createSqliteDatabase(path, new RecordingLogger());
        defer(context, () => database.stop());

        await assert.rejects(database.start(), (error) => {
            assert.ok(error instanceof IntegrationError);
            assert.equal(error.code, "INTEGRATION_ERROR");
            assert.deepEqual(error.data, { reason: "migration-failed", version: MIGRATIONS[0]?.version });
            assert.ok(error.cause instanceof Error);
            assert.match(error.cause.message, /table endpoints already exists/);
            return true;
        });

        assert.deepEqual(
            raw
                .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
                .all()
                .map((row) => row.name),
            ["endpoints"],
        );
        assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, 0);
    });

    test("fails start() with the native error when the file is not a database", async (context) => {
        const path = temporaryDatabasePath(context);
        writeFileSync(path, "this is not a SQLite database file");
        const database = createSqliteDatabase(path, new RecordingLogger());

        await assert.rejects(database.start(), { code: "ERR_SQLITE_ERROR" });
    });

    test("does nothing on stop() after a failed start()", async (context) => {
        const path = temporaryDatabasePath(context);
        writeFileSync(path, "this is not a SQLite database file");
        const database = createSqliteDatabase(path, new RecordingLogger());
        await assert.rejects(database.start());

        await database.stop();

        assert.throws(() => database.room, isInternalError);
    });
});
