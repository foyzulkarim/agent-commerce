import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { log } from "@ac/log";
import {
  createPool,
  migrate,
  query,
  splitDatabaseUrl,
  sqlFiles,
  startDatabase,
  withTransaction,
} from "./index.ts";

test("splitDatabaseUrl keeps credentials and swaps the database", () => {
  const { adminUrl, name } = splitDatabaseUrl("postgres://ac:ac@postgres:5432/orders");
  assert.equal(name, "orders");
  assert.equal(adminUrl, "postgres://ac:ac@postgres:5432/postgres");
  assert.throws(() => splitDatabaseUrl("postgres://ac:ac@postgres:5432/"));
});

test("sqlFiles sorts by name and ignores other files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ac-sql-"));
  await writeFile(path.join(dir, "002_b.sql"), "");
  await writeFile(path.join(dir, "001_a.sql"), "");
  await writeFile(path.join(dir, "README.md"), "");
  assert.deepEqual(await sqlFiles(dir), ["001_a.sql", "002_b.sql"]);
  assert.deepEqual(await sqlFiles(path.join(dir, "missing")), []);
});

const DATABASE_URL = process.env.DATABASE_URL;

test("migrate applies each file once, under the lock", {
  skip: !DATABASE_URL && "set DATABASE_URL",
}, async () => {
  const logger = log("db-test");
  const base = DATABASE_URL as string;
  const url = base.replace(/\/[^/]*$/, `/ac_test_${Date.now()}`);
  const dir = await mkdtemp(path.join(os.tmpdir(), "ac-mig-"));
  await writeFile(path.join(dir, "001_t.sql"), "CREATE TABLE t (id int PRIMARY KEY)");
  const pool = await startDatabase({ databaseUrl: url, migrationsDir: dir, log: logger });
  try {
    assert.deepEqual(await migrate(pool, dir, logger), []);
    await withTransaction(pool, async (tx) => {
      await query(tx, "INSERT INTO t VALUES (1)");
    });
    await assert.rejects(
      withTransaction(pool, async (tx) => {
        await query(tx, "INSERT INTO t VALUES (2)");
        throw new Error("boom");
      }),
    );
    const rows = await query<{ id: number }>(pool, "SELECT id FROM t ORDER BY id");
    assert.deepEqual(
      rows.rows.map((r) => r.id),
      [1],
    );
  } finally {
    await pool.end();
    const admin = createPool(splitDatabaseUrl(url).adminUrl);
    await admin.query(`DROP DATABASE "${splitDatabaseUrl(url).name}"`);
    await admin.end();
  }
});
