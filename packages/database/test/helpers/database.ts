import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

import { createSqliteDatabase, type Database } from "../../src/database.ts";
import { defer } from "./cleanup.ts";
import { RecordingLogger } from "./logger.ts";

/** A path inside a directory that is removed when the test ends. */
export function temporaryDatabasePath(context: TestContext): string {
    const directory = mkdtempSync(join(tmpdir(), "nedalto-database-"));
    defer(context, () => rmSync(directory, { recursive: true, force: true }));
    return join(directory, "nedalto.db");
}

/** A started database on a temporary file, stopped when the test ends. */
export async function openDatabase(context: TestContext): Promise<Database> {
    const database = createSqliteDatabase(temporaryDatabasePath(context), new RecordingLogger());
    defer(context, () => database.stop());
    await database.start();
    return database;
}
