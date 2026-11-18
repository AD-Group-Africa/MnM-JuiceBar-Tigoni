#!/usr/bin/env node
/**
 * Verified SQLite backup.
 *
 * Copies the live database with `VACUUM INTO`, which produces a consistent
 * single-file snapshot even while the server is running in WAL mode (unlike
 * copying the .sqlite file alone, which omits un-checkpointed WAL frames).
 *
 * The backup is opened and checked before it is reported as usable:
 *   - PRAGMA integrity_check must return "ok"
 *   - row counts for the tables that matter must be readable
 * A JSON sidecar records the counts, byte size, source path and timestamp so a
 * later restore can prove it received the same data.
 *
 * Usage:
 *   node scripts/db-backup.mjs [--source <db>] [--out <dir>]
 * Defaults: --source $DATABASE_FILE or data/mnm-dev.sqlite, --out backups
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const source = path.resolve(arg("source", process.env.DATABASE_FILE || "data/mnm-dev.sqlite"));
const outDir = path.resolve(arg("out", "backups"));
const TRACKED_TABLES = [
  "orders", "order_items", "payments", "tickets", "reservations",
  "juice_orders", "juice_order_items", "customers", "users", "events", "products", "audit_log",
];

function fail(message) {
  console.error(`[backup] FAILED: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(source)) fail(`source database not found: ${source}`);
const stat = fs.statSync(source);
if (stat.size === 0) fail(`source database is empty: ${source}`);

fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
const target = path.join(outDir, `mnm-${stamp}.sqlite`);
if (fs.existsSync(target)) fail(`refusing to overwrite existing backup: ${target}`);

// sqlite string literal: single quotes doubled.
const literal = target.replace(/'/g, "''");
const db = new DatabaseSync(source);
try {
  db.exec("PRAGMA busy_timeout = 8000;");
  db.exec(`VACUUM INTO '${literal}'`);
} catch (err) {
  fail(`VACUUM INTO failed: ${err.message}`);
} finally {
  db.close();
}

if (!fs.existsSync(target)) fail("VACUUM INTO reported success but no file was written");

const check = new DatabaseSync(target, { readOnly: true });
const counts = {};
let integrity = "";
try {
  integrity = String(check.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "");
  if (integrity !== "ok") fail(`integrity_check returned "${integrity}"`);
  for (const table of TRACKED_TABLES) {
    try {
      counts[table] = Number(check.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
    } catch {
      counts[table] = null; // table absent in this schema generation
    }
  }
} finally {
  check.close();
}

const manifest = {
  createdAt: new Date().toISOString(),
  source,
  backup: target,
  bytes: fs.statSync(target).size,
  integrity,
  counts,
  node: process.version,
};
fs.writeFileSync(`${target}.json`, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`[backup] verified ${path.basename(target)} (${manifest.bytes} bytes, integrity ${integrity})`);
console.log(`[backup] manifest: ${path.basename(target)}.json`);
console.log(`[backup] rows: ${JSON.stringify(counts)}`);
console.log("[backup] Store this file off the host that runs the service.");
