import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "@ac/log";
import pg from "pg";

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
export type QueryResult<T extends pg.QueryResultRow = pg.QueryResultRow> = pg.QueryResult<T>;

export function createPool(databaseUrl: string): Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 5 });
}

export function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  db: Pool | PoolClient,
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return db.query<T>(text, params);
}

/** Runs `fn` inside BEGIN/COMMIT. Rolls back when `fn` throws. */
export async function withTransaction<T>(
  pool: Pool,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Splits `postgres://user:pass@host:5432/name` into the maintenance URL and the database name. */
export function splitDatabaseUrl(databaseUrl: string): { adminUrl: string; name: string } {
  const url = new URL(databaseUrl);
  const name = url.pathname.replace(/^\//, "");
  if (!name) throw new Error(`DATABASE_URL has no database name: ${databaseUrl}`);
  url.pathname = "/postgres";
  return { adminUrl: url.toString(), name };
}

/** Creates the database when it does not exist. Connects to the `postgres` database to do it. */
export async function ensureDatabase(databaseUrl: string, log: Logger): Promise<void> {
  const { adminUrl, name } = splitDatabaseUrl(databaseUrl);
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`database name not allowed: ${name}`);
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const found = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (found.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${name}"`);
      log.info({ database: name }, "database created");
    }
  } finally {
    await admin.end();
  }
}

/** The `.sql` files of a directory, in name order. An absent directory gives an empty list. */
export async function sqlFiles(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names.filter((n) => n.endsWith(".sql")).sort();
}

const MIGRATION_LOCK = 7_240_001;

/**
 * Applies the `.sql` files of `dir` that are not yet in `schema_migrations`, in name order,
 * one transaction per file, under one advisory lock so two replicas do not race.
 */
export async function migrate(pool: Pool, dir: string, log: Logger): Promise<string[]> {
  const files = await sqlFiles(dir);
  const applied: string[] = [];
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set(
      (await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map(
        (r) => r.name,
      ),
    );
    for (const name of files) {
      if (done.has(name)) continue;
      const sql = await readFile(path.join(dir, name), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${name} failed: ${(error as Error).message}`, { cause: error });
      }
      applied.push(name);
      log.info({ migration: name }, "migration applied");
    }
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]);
  } finally {
    client.release();
  }
  return applied;
}

/** Runs every `.sql` file of `dir` on each start. Each file must be idempotent (INSERT ... ON CONFLICT DO NOTHING). */
export async function seed(pool: Pool, dir: string, log: Logger): Promise<string[]> {
  const files = await sqlFiles(dir);
  for (const name of files) {
    const sql = await readFile(path.join(dir, name), "utf8");
    await pool.query(sql);
    log.info({ seed: name }, "seed applied");
  }
  return files;
}

export type StartDatabaseOptions = {
  databaseUrl: string;
  migrationsDir: string;
  seedDir?: string;
  log: Logger;
};

/** What every service does at start: create the database if missing, migrate, seed, return the pool. */
export async function startDatabase(options: StartDatabaseOptions): Promise<Pool> {
  await ensureDatabase(options.databaseUrl, options.log);
  const pool = createPool(options.databaseUrl);
  await migrate(pool, options.migrationsDir, options.log);
  if (options.seedDir) await seed(pool, options.seedDir, options.log);
  return pool;
}
