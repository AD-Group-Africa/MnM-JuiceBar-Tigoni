#!/usr/bin/env node
/**
 * Reliable test entrypoint for `npm test`.
 *
 * The previous script (`node --test tests/*.test.mts ... || node --test tests/*.ts`)
 * reported success while discovering ZERO tests: the first glob matched no files,
 * node --test exited 0 with "tests 0", and the `||` fallback never ran.
 *
 * This runner:
 *  - discovers tests/*.test.ts explicitly (fails if none exist),
 *  - runs them once via node --test with the tsx loader and the TAP reporter,
 *  - parses the TAP summary and exits nonzero if ANY test fails or if ZERO tests ran,
 *  - cannot be masked by a pipeline or fallback.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = path.join(root, "tests");

let entries = [];
try {
  entries = fs.readdirSync(testsDir).filter((f) => f.endsWith(".test.ts")).sort();
} catch (err) {
  console.error(`[test] FATAL: cannot read tests directory at ${testsDir}: ${err.message}`);
  process.exit(1);
}

if (entries.length === 0) {
  console.error("[test] FATAL: no tests/*.test.ts files found — refusing to report success with zero tests.");
  process.exit(1);
}

// Guard 2: node's --test counts each *file* as one passing (sub)test even when the
// file declares no tests, so `# tests 0` never appears. Count declared test()
// calls statically so an empty suite can never be reported as success.
let declared = 0;
for (const f of entries) {
  const src = fs.readFileSync(path.join(testsDir, f), "utf8");
  declared += (src.match(/\b(?:test|it)\s*\(\s*["'`]/g) ?? []).length;
}
if (declared === 0) {
  console.error("[test] FATAL: the discovered test files declare zero tests — refusing to report success.");
  process.exit(1);
}

const files = entries.map((f) => path.join("tests", f));
console.log(`[test] running ${files.length} test file(s) with ${declared} declared test(s): ${entries.join(", ")}`);

const res = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", "--test-reporter=tap", "--test-reporter-destination=stdout", ...files],
  { cwd: root, encoding: "utf8", shell: false, env: process.env },
);

const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
process.stdout.write(out);
if (res.error) {
  console.error(`[test] FATAL: failed to spawn test process: ${res.error.message}`);
  process.exit(1);
}

const num = (label) => {
  const m = out.match(new RegExp(`^# ${label} (\\d+)$`, "m"));
  return m ? Number(m[1]) : null;
};
const tests = num("tests");
const pass = num("pass");
const fail = num("fail");

console.log(`[test] summary: tests=${tests ?? "?"} pass=${pass ?? "?"} fail=${fail ?? "?"} childExit=${res.status}`);

if (tests === null || pass === null || fail === null) {
  console.error("[test] FATAL: could not parse the test summary — treating the run as failed.");
  process.exit(1);
}
if (tests === 0) {
  console.error("[test] FATAL: the runner discovered zero tests — refusing to report success.");
  process.exit(1);
}
if (fail > 0 || res.status !== 0) {
  process.exit(1);
}
process.exit(0);
