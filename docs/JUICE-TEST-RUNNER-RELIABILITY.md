# Test Runner Reliability (Sprint 2)

Date: 2026-10-17 · Scope: `npm test` must never report success without actually running tests.

## The defect (before)

`package.json` ran:

```
node --import tsx --test tests/*.test.mts tests/*.mt.ts tests/unit/*.mts 2>&1 || node --import tsx --test tests/*.ts
```

The first glob set matches no files. `node --test` with no matching files prints `tests 0 / pass 0`
and **exits 0**, so the `||` fallback never executed and `npm test` reported success while running
zero tests. Verified on 2026-10-17 before the fix: `npm test` → `pass 0`, exit 0.

## The fix (after)

`package.json`: `"test": "node scripts/run-tests.mjs"`.

`scripts/run-tests.mjs` (new, zero dependencies):

1. Discovers `tests/*.test.ts` via `readdirSync` — no shell globs, so nothing can silently
   match nothing. Zero files → **exit 1** ("refusing to report success with zero tests").
2. Counts declared `test(`/`it(` calls statically across the discovered files. Zero declarations
   (a suite that parses but tests nothing) → **exit 1**. This guard exists because node's test
   runner counts each *file* as one passing (sub)test even when the file declares no tests, so a
   `# tests 0` summary never appears.
3. Runs the files exactly once:
   `node --import tsx --test --test-reporter=tap --test-reporter-destination=stdout <files>`
4. Parses the TAP summary (`# tests/# pass/# fail`). Exits nonzero if the child exited nonzero,
   any test failed, the summary cannot be parsed, or zero tests ran. No pipeline or fallback can
   mask the child's status (spawnSync + explicit exit codes; output is echoed verbatim).

CI and local development both use `npm test` — one documented command.

## Proofs (executed 2026-10-17)

| Probe | Command | Result |
|---|---|---|
| Normal run | `npm test` | 6 files, **73 tests, 73 pass, exit 0** (36 pre-existing + 37 Sprint 2) |
| Deliberately failing temp test (`tests/tmp-probe-fail.test.ts`) | `npm test` | `# fail 1`, **exit 1** — temp file removed afterward |
| Temp file declaring zero tests (`tests/tmp-probe-empty.test.ts` only) | `npm test` | **exit 1** — "the discovered test files declare zero tests — refusing to report success" |
| No test files at all (tests dir emptied temporarily) | `npm test` | **exit 1** — "no tests/*.test.ts files found" |
| Real suite re-run after probes | `npm test` | 36 tests at that point, 36 pass, exit 0; tests directory restored exactly |

All temporary probe files were deleted; `ls tests/` after the probes shows only the six real suites.

## Notes

- Test files must follow the `tests/<name>.test.ts` naming convention to be discovered.
- The runner intentionally uses the TAP reporter for parseable output; failures still print the
  full assertion diff in the captured output.
