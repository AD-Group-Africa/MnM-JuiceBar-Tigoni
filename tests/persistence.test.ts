/**
 * Production persistence: location assessment, strict policy, restart survival
 * and the verified backup/restore tooling.
 *
 * The restart test proves the SQLite file + WAL checkpoint behave as designed
 * inside one process; it cannot prove a hosting platform keeps the file. That
 * requires a real deploy on a mounted disk and is reported separately.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mnm-persist-"));
const root = process.cwd();

const { assessStorage, enforceStoragePolicy, PersistenceError } = await import("../src/persistence.ts");
const { migrate, run, queryOne, closeDb } = await import("../src/db.ts");

after(() => {
  closeDb();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

test("development storage is not claimed as persistent", () => {
  const a = assessStorage("data/mnm-dev.sqlite", { production: false });
  assert.equal(a.mode, "development");
});

test("the development default is ephemeral-risk in production", () => {
  const a = assessStorage("data/mnm-dev.sqlite", { production: true, env: {} });
  assert.equal(a.mode, "ephemeral-risk");
  assert.equal(a.strict, false);
  assert.ok(a.reasons.some((r) => /development default/i.test(r)));
});

test("a temporary directory is ephemeral-risk in production", () => {
  const a = assessStorage(path.join(os.tmpdir(), "mnm-test.sqlite"), { production: true, env: {} });
  assert.equal(a.mode, "ephemeral-risk");
  assert.ok(a.reasons.some((r) => /temporary directory/i.test(r)));
});

test("a file inside the declared persistent root is persistent-configured", () => {
  const a = assessStorage("/var/data/mnm.sqlite", { production: true, env: {} });
  assert.equal(a.mode, "persistent-configured");
});

test("an absolute path outside the persistent root is unverified, not claimed persistent", () => {
  const a = assessStorage(path.resolve("/opt/mnm-data/elsewhere.sqlite"), {
    production: true,
    env: { DATABASE_PERSISTENT_ROOT: "/var/data" },
  });
  assert.equal(a.mode, "unverified");
});

test("strict mode refuses to boot on ephemeral storage", () => {
  const a = assessStorage("data/mnm-dev.sqlite", {
    production: true,
    env: { DATABASE_REQUIRE_PERSISTENT: "1" },
  });
  assert.equal(a.strict, true);
  assert.throws(() => enforceStoragePolicy(a, { log: () => {}, warn: () => {} }), PersistenceError);
});

test("non-strict mode warns but does not refuse to boot", () => {
  const warnings: string[] = [];
  const a = assessStorage("data/mnm-dev.sqlite", { production: true, env: {} });
  assert.doesNotThrow(() => enforceStoragePolicy(a, { log: () => {}, warn: (m: string) => warnings.push(m) }));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /WILL be lost/);
});

test("committed rows survive closing and reopening the database", () => {
  const file = path.join(tmp, "restart.sqlite");
  migrate(file);
  run(
    `INSERT INTO juice_orders(order_ref,type,customer_name,customer_phone,subtotal_minor,delivery_fee_minor,discount_minor,total_minor,currency,status)
     VALUES ('MNM-J-RESTART1','pickup','Restart Test','+254700000001',10000,0,0,10000,'KES','new')`,
  );
  closeDb();
  migrate(file); // fresh handle, zero migrations expected
  const row = queryOne("SELECT order_ref, total_minor FROM juice_orders WHERE order_ref='MNM-J-RESTART1'");
  assert.ok(row, "row must still exist after the handle was closed and reopened");
  assert.equal(Number(row!.total_minor), 10000);
  closeDb();
});

test("backup and restore round-trip preserves rows and is verified", () => {
  const file = path.join(tmp, "source.sqlite");
  const outDir = path.join(tmp, "backups");
  migrate(file);
  run(
    `INSERT INTO juice_orders(order_ref,type,customer_name,customer_phone,subtotal_minor,delivery_fee_minor,discount_minor,total_minor,currency,status)
     VALUES ('MNM-J-BACKUP1','pickup','Backup Test','+254700000002',25000,0,0,25000,'KES','new')`,
  );
  closeDb();

  const backup = spawnSync(
    process.execPath,
    [path.join(root, "scripts/db-backup.mjs"), "--source", file, "--out", outDir],
    { encoding: "utf8" },
  );
  assert.equal(backup.status, 0, `backup failed: ${backup.stdout}${backup.stderr}`);
  const files = fs.readdirSync(outDir).filter((f) => f.endsWith(".sqlite"));
  assert.equal(files.length, 1);
  const backupPath = path.join(outDir, files[0]!);
  const manifest = JSON.parse(fs.readFileSync(`${backupPath}.json`, "utf8"));
  assert.equal(manifest.integrity, "ok");
  assert.equal(manifest.counts.juice_orders, 1);

  const restored = path.join(tmp, "restored.sqlite");
  const restore = spawnSync(
    process.execPath,
    [path.join(root, "scripts/db-restore.mjs"), "--backup", backupPath, "--target", restored, "--yes"],
    { encoding: "utf8" },
  );
  assert.equal(restore.status, 0, `restore failed: ${restore.stdout}${restore.stderr}`);

  migrate(restored);
  const row = queryOne("SELECT order_ref FROM juice_orders WHERE order_ref='MNM-J-BACKUP1'");
  assert.ok(row, "restored database must contain the backed-up row");
  closeDb();
});

test("restore refuses to overwrite without explicit confirmation", () => {
  const file = path.join(tmp, "source2.sqlite");
  migrate(file);
  closeDb();
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts/db-restore.mjs"), "--backup", file, "--target", path.join(tmp, "x.sqlite")],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--yes/);
  assert.equal(fs.existsSync(path.join(tmp, "x.sqlite")), false);
});
