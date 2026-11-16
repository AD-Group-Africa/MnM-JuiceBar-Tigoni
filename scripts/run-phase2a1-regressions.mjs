#!/usr/bin/env node
/**
 * Phase 2A.1 known-defect regression command.
 *
 * This intentionally runs tests that assert the INTENDED contract for defects
 * that Phase 2A.1 is not allowed to fix. It exits non-zero while those defects
 * remain. It is deliberately separate from `npm test`:
 *
 *   npm test                                  # passing baseline + active regressions
 *   node scripts/run-phase2a1-regressions.mjs # red known-defect specifications
 *
 * Do not wire this into `npm test` until Phase 2B fixes the defects and the
 * assertions pass legitimately.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "tests", "phase2a1");

let entries = [];
try {
  entries = fs.readdirSync(dir).filter((f) => f.endsWith(".test.ts")).sort();
} catch (err) {
  console.error(`[phase2a1] FATAL: cannot read ${dir}: ${err.message}`);
  process.exit(2);
}
if (entries.length === 0) {
  console.error("[phase2a1] FATAL: no known-defect test files found.");
  process.exit(2);
}

const files = entries.map((f) => path.join("tests", "phase2a1", f));
console.log(`[phase2a1] running ${files.length} known-defect file(s): ${entries.join(", ")}`);
console.log("[phase2a1] non-zero exit means at least one asserted defect is still present.");

const res = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", "--test-reporter=spec", ...files],
  { cwd: root, encoding: "utf8", shell: false, env: process.env },
);

process.stdout.write(`${res.stdout ?? ""}${res.stderr ?? ""}`);
if (res.error) {
  console.error(`[phase2a1] FATAL: failed to spawn test process: ${res.error.message}`);
  process.exit(2);
}
process.exit(res.status ?? 1);
