#!/usr/bin/env node
/**
 * Guarded SQLite restore.
 *
 * Safety rules enforced here:
 *   1. The backup must pass PRAGMA integrity_check and match its JSON manifest
 *      row counts, or the restore is refused.
 *   2. The current target database is copied to backups/pre-restore-<stamp>.sqlite
 *      before anything is overwritten.
 *   3. --yes is mandatory: nothing is replaced by accident.
 *   4. -wal / -shm sidecars are removed after the swap so SQLite does not merge
 *      stale frames into the restored file.
 *
 * Stop the application first. Restoring a database underneath a running process
 * is unsupported: it may hold an open handle and cached pages.
 *
 * Usage:
 *   node scripts/db-restore.mjs --backup backups/mnm-...sqlite --target data/mnm-dev.sqlite --yes
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
function fail(message) {
  console.error(`[restore] FAILED: ${message}`);
  process.exit(1);
}

const backup = path.resolve(arg("backup", ""));
const target = path.resolve(arg("target", process.env.DATABASE_FILE || "data/mnm-dev.sqlite"));
const confirmed = args.includes("--yes");

if (!arg("backup", "")) fail("--backup <file> is required");
if (!fs.existsSync(backup)) fail(`backup not found: ${backup}`);
if (!confirmed) fail("refusing to overwrite data without --yes (stop the service and re-run with --yes)");

let manifest = null;
if (fs.existsSync(`${backup}.json`)) {
  try {
    manifest = JSON.parse(fs.readFileSync(`${backup}.json`, "utf8"));
  } catch (err) {
    fail(`backup manifest is unreadable: ${err.message}`);
  }
}

// Verify the backup before touching the live file.
const check = new DatabaseSync(backup, { readOnly: true });
try {
  const integrity = String(check.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "");
  if (integrity !== "ok") fail(`backup failed integrity_check: "${integrity}"`);
  if (manifest?.counts) {
    for (const [table, expected] of Object.entries(manifest.counts)) {
      if (expected === null) continue;
      try {
        const actual = Number(check.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
        if (actual !== expected) fail(`row count mismatch for ${table}: manifest ${expected}, backup ${actual}`);
      } catch (err) {
        fail(`cannot verify ${table}: ${err.message}`);
      }
    }
  }
} finally {
  check.close();
}

// Preserve whatever is currently in place (if anything) before the swap.
if (fs.existsSync(target)) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  const safetyDir = path.join(path.dirname(target), "..", "backups");
  fs.mkdirSync(safetyDir, { recursive: true });
  const safety = path.join(safetyDir, `pre-restore-${stamp}.sqlite`);
  fs.copyFileSync(target, safety);
  console.log(`[restore] current database preserved at ${safety}`);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(backup, target);
for (const suffix of ["-wal", "-shm"]) {
  try {
    fs.rmSync(`${target}${suffix}`);
  } catch {
    // Absent sidecars are fine.
  }
}

const verify = new DatabaseSync(target, { readOnly: true });
try {
  const integrity = String(verify.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "");
  if (integrity !== "ok") fail(`restored database failed integrity_check: "${integrity}"`);
} finally {
  verify.close();
}
console.log(`[restore] restored ${backup} -> ${target} (integrity ok). Start the service and verify /health.`);
