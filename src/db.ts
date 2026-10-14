/**
 * Database access layer. Local development uses Node's built-in `node:sqlite`
 * (zero native deps). Production target is PostgreSQL — migrations are plain
 * versioned SQL files so the schema ports with minor dialect edits
 * (see docs/ARCHITECTURE.md, DATA_MODEL.md).
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../db/migrations");

let db: DatabaseSync | null = null;
let dbFile = "";

export function getDb(file?: string): DatabaseSync {
  if (db && (!file || file === dbFile)) return db;
  const f = file ?? process.env.DATABASE_FILE ?? "data/mnm-dev.sqlite";
  fs.mkdirSync(path.dirname(path.resolve(f)), { recursive: true });
  db = new DatabaseSync(f);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 8000;");
  dbFile = f;
  return db;
}

/** Run any pending .sql migrations in filename order, inside a transaction. */
export function migrate(databaseFile?: string): number {
  const d = getDb(databaseFile);
  d.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`);
  const applied = new Set(
    d.prepare("SELECT name FROM schema_migrations").all().map((r) => (r as { name: string }).name),
  );
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    d.exec("BEGIN");
    try {
      d.exec(sql);
      d.prepare("INSERT INTO schema_migrations(name) VALUES (?)").run(file);
      d.exec("COMMIT");
      count++;
      console.log(`[db] applied migration ${file}`);
    } catch (err) {
      d.exec("ROLLBACK");
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return count;
}

export interface Row { [key: string]: unknown }

export function queryAll(sql: string, params: (string | number | null)[] = []): Row[] {
  return getDb().prepare(sql).all(...params) as Row[];
}

export function queryOne(sql: string, params: (string | number | null)[] = []): Row | undefined {
  return getDb().prepare(sql).get(...params) as Row | undefined;
}

export function run(sql: string, params: (string | number | null)[] = []): { changes: number; lastInsertRowid: number } {
  const r = getDb().prepare(sql).run(...params);
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.exec("BEGIN IMMEDIATE"); // write lock up front — used for inventory atomicity
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

// CLI entry: `tsx src/db.ts --migrate`
const argv = process.argv.slice(2);
if (argv.includes("--migrate")) {
  const n = migrate(process.env.DATABASE_FILE);
  console.log(`[migrate] ${n} migration(s) applied.`);
}
