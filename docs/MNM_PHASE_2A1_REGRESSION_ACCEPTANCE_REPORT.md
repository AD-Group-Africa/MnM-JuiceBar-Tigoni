# MnM Juice Bar — Phase 2A.1 Regression Acceptance Report

**Date:** 16 November 2026  
**Repository:** `C:\Users\thrillerpark\Desktop\Flagship Projects\MnM Juice Bar`  
**Scope:** Test-only regression completion and payment design review. No P1 fix, application-source change, migration, live payment, deployment, owner message, stage, commit or push.  
**Runner:** Node.js `v24.19.0`, `node:test` via `tsx`.

---

## 1. Preflight Git baseline and preservation status

| Item | Verified value |
|---|---|
| Git root | `C:/Users/thrillerpark/Desktop/Flagship Projects/MnM Juice Bar` |
| Branch | `main` |
| HEAD | `3c9628754636d2b3ddf71d454fd2e6f355d08cd9` (`3c96287`) |
| HEAD subject | `Branding: M&M Juice Bar Tigoni, hero tagline, /juice redirect. Migration 0007. Tests 74/74.` |
| Remote | `origin` → `https://github.com/AD-Group-Africa/MnM-JuiceBar-Tigoni.git` |
| Tracked modified | **50** |
| Untracked entries at Phase 2A.1 close | **76** |
| Staged | **0** |
| Migrations | **7** |
| Test files | **13** (8 root + 5 Phase 2A.1) |
| Dev server | `127.0.0.1:8787`, PID **1224** (not restarted or interrupted) |
| Live DB integrity (read-only) | `integrity_check = ok`, `schema_migrations = 7` |

No reset, clean, stash, branch switch, stage, commit or push was performed. No existing file was overwritten except the two test files named in §2. The Phase 2A evidence directory remains in place; its logs, runtime copies and hashes were not edited.

### Untracked-count reconciliation

The historical values are not contradictory; they were captured at different points:

| Point | Untracked | Explanation |
|---|---:|---|
| Phase 2A preflight, 12:15 | 66 | Before the Phase 2A deliverables |
| Phase 2A Git baseline | 67 | Baseline file captured after one additional untracked item |
| Phase 2A final summary | 73 | +6 reports and +1 test file |
| Phase 2A.1 after tests/runner | 75 | +`tests/phase2a1/` and +`scripts/run-phase2a1-regressions.mjs`; `.freebuff/phase2a1/*.log` is ignored by `.gitignore` |
| Phase 2A.1 close | 76 | +this report |

The 50 tracked modifications are pre-existing Phase 1/design work. `find src db/migrations -newermt '2026-11-16 12:35:00'` returned **no files**, confirming that this phase did not edit application source or migrations.

### Existing report hashes

Recorded with `sha256sum` at Phase 2A.1 close:

| Report | SHA-256 |
|---|---|
| `docs/MNM_PHASE_2A_CURRENT_STATE_AUDIT.md` | `c0da6662b5cb694d7f48f1c88ac7e4e1b921893768f7ceea3f18706b33c5baff` |
| `docs/MNM_P1_DETAILED_GAP_AUDIT.md` | `f88c4dd3791e0e769942f8335a4f5281df0cd0c6c9f832c06ad7bab79257e610` |
| `docs/MNM_DARAJA_SANDBOX_READINESS.md` | `b4a7d4d93660a2502cf94b6e95cdbeb2d72cd1909fe09a58b74b92e7f736bb9e` |
| `docs/MNM_COMMERCIAL_ACCEPTANCE_CRITERIA.md` | `34b85af3595eee764a2093050a48f9ada86bcd9856e7e27c54fdabadbd863e69` |
| `docs/MNM_PHASE_2A_EXECUTIVE_REPORT.md` | `f2b8a70308df451228cd7071e14dbf77de5541b27d0b7fe9ee2c70d34f825f11` |
| `docs/MNM_PHASE_2B_IMPLEMENTATION_PLAN.md` | `9b644e725c29d0548803fb9ea943bfbc437bb0d037342a426a31e48a80fb9843` |

The Phase 2A preserved snapshot hash remains the recorded `8207330e4b4bb6a42e631784e7aab18ad0259bbd3b46861c786d6978b1665210`; this phase did not re-hash or alter that snapshot.

---

## 2. Exact files modified and created

### Modified (test-only)

1. `tests/phase2a-regressions.test.ts`
   - Removed the three skipped tests that represented missing sale-window/minimum enforcement.
   - Added one active passing test: **“closing the window does not invalidate an already-issued ticket.”**
   - No skip or `test.todo` remains in the file.

2. `tests/config.test.ts`
   - Replaced the previous assertion that **accepted** production + `MPESA_ENV=sandbox` with a development/test sandbox assertion.
   - The production-sandbox rejection is now asserted in the red suite, where the current implementation fails honestly.
   - A comment points to that red suite; the implementation was not changed.

### Created (test-only, plus this report)

3. `tests/phase2a1/sale-window.test.ts` — 6 known-defect specifications.
4. `tests/phase2a1/delivery-minimum.test.ts` — 8 specifications.
5. `tests/phase2a1/production-config.test.ts` — 9 specifications.
6. `tests/phase2a1/daraja-amount.test.ts` — 12 specifications.
7. `tests/phase2a1/payment-ordering.test.ts` — 4 specifications.
8. `scripts/run-phase2a1-regressions.mjs` — dedicated red command; exits non-zero while defects remain.
9. `docs/MNM_PHASE_2A1_REGRESSION_ACCEPTANCE_REPORT.md` — this report.

Evidence logs were written under `.freebuff/phase2a1/` (`test-main*.log`, `test-known-defects*.log`, `typecheck*.log`, `build.log`, `diff-check.log`). These are ignored evidence artifacts, not application changes.

### Phase 2A nine-file inventory explanation

The Phase 2A summary’s “six reports and one test file” is the **top-level deliverable count**, not the complete nine-file inventory. The exact nine Phase 2A files are:

1. `docs/MNM_PHASE_2A_CURRENT_STATE_AUDIT.md`
2. `docs/MNM_P1_DETAILED_GAP_AUDIT.md`
3. `docs/MNM_DARAJA_SANDBOX_READINESS.md`
4. `docs/MNM_COMMERCIAL_ACCEPTANCE_CRITERIA.md`
5. `docs/MNM_PHASE_2A_EXECUTIVE_REPORT.md`
6. `docs/MNM_PHASE_2B_IMPLEMENTATION_PLAN.md`
7. `tests/phase2a-regressions.test.ts`
8. `.freebuff/phase2a/gap-probe.mts`
9. `.freebuff/phase2a/db-check.mjs`

Items 8 and 9 are test/evidence helpers inside the already-untracked `.freebuff/phase2a/` directory, so they did not add separate top-level Git entries. That is why the summary could describe seven deliverables while the inventory contains nine files. The remaining `.freebuff/phase2a/` contents (logs, SQLite runtime copies, hash files, HTTP JSON responses) are evidence outputs, not additional deliverables.

---

## 3. Regression results by scenario

### Status vocabulary

- **PASS** — the current implementation satisfies the asserted contract.
- **FAIL (known defect)** — the executable specification fails because the defect exists. It is not a passing enforcement test and is not described as one.
- No test is skipped or marked `todo`.

### A. Event sale-window enforcement — `tests/phase2a1/sale-window.test.ts`

Deterministic clock: `Date.UTC(2026, 10, 16, 9, 0, 0)` via Node `mock.timers` with `apis: ["Date"]`. The service under test is the real `createOrder()`; the public page is exercised only to prove it is not the enforcement mechanism.

Documented boundary policy used: **sale start inclusive, sale end exclusive** (`MNM_PHASE_2A_CURRENT_STATE_AUDIT.md`; `MNM_P1_DETAILED_GAP_AUDIT.md`).

| # | Scenario | Result | Evidence |
|---:|---|---|---|
| A1 | Purchase before `sale_starts_at` | **FAIL (known defect)** | `createOrder` returned `ok: true`; no sale-window check |
| A2 | Exactly at opening | **PASS** | Returned `ok: true`; start-inclusive boundary |
| A3 | During the window | **PASS** | Returned `ok: true` |
| A4 | Exactly at closing | **FAIL (known defect)** | Returned `ok: true`; should be outside (end-exclusive) |
| A5 | After closing | **FAIL (known defect)** | Returned `ok: true` |
| A6 | Public hidden/filtered page is not enforcement | **FAIL (known defect)** | Future event page correctly returned 404, but direct `createOrder` still returned `ok: true` |
| A7 | Request bypassing frontend | **FAIL (known defect)** | Same direct-service call; no server-side rejection |
| A8 | Paid ticket survives closing | **PASS (main suite)** | “closing the window does not invalidate an already-issued ticket” passes; `verifyTicket` still admits |

**Root cause:** `createOrder()` selects `e.status` and `e.max_per_order` only; it never selects or compares `sale_starts_at` / `sale_ends_at` (`src/orders.ts`). The public listing/filter is implemented, but the purchase service is not gated.

**Policy note:** The boundary rule is documented, not invented by this phase. The founder should still confirm it explicitly, including the timezone interpretation (the database stores ISO UTC strings; the public filters use SQLite UTC `strftime`).

### B. Delivery minimum — `tests/phase2a1/delivery-minimum.test.ts`

Exercises the real `createJuiceOrder()`. Fixture: product KES 150 (15,000 minor), zone fee KES 50 (5,000 minor), zone minimum KES 300 (30,000 minor). Exact minimum is quantity 2.

| # | Scenario | Result | Evidence |
|---:|---|---|---|
| B1 | Delivery below minimum | **FAIL (known defect)** | KES 150 accepted against KES 300 minimum |
| B2 | Exactly at minimum | **PASS** | KES 300 subtotal accepted; fee KES 50; total KES 350 |
| B3 | Above minimum | **PASS** | KES 450 accepted |
| B4 | Pickup exempt | **PASS** | KES 150 pickup accepted; fee 0 |
| B5 | Browser-submitted totals cannot bypass | **FAIL (known defect)** | Client `subtotalMinor`/`totalMinor` are ignored, but the below-minimum cart is still accepted |
| B6 | Server-resolved prices used | **FAIL (known defect)** | Client size/add-on price fields are ignored, but the below-minimum cart is still accepted |
| B7 | Unknown zone cannot bypass | **PASS** | Rejected as unavailable |
| B8 | Disabled zone cannot bypass | **PASS** | Rejected as unavailable |

**Root cause:** `createJuiceOrder()` resolves the enabled zone and charges its fee but never compares `priced.subtotalMinor` with `zone.minOrderMinor`. `computeJuiceOrderTotals()` even comments that the fee is charged and “flagged”, but no flag/enforcement reaches order creation.

**Policy-blocked, deliberately not asserted:** whether the minimum applies before or after discounts, customisations, or the delivery fee. No test encodes an invented rule. These require founder confirmation.

### C. Production sandbox rejection — `tests/phase2a1/production-config.test.ts`

Pure `loadConfig()` tests. `globalThis.fetch` is replaced with a throwing fake for the final test; no OAuth, STK or Query request is made.

| # | Scenario | Result | Evidence |
|---:|---|---|---|
| C1 | Production + `MPESA_ENV=sandbox` | **FAIL (known defect)** | No exception; production can select Safaricom sandbox |
| C2 | Production + missing `MPESA_ENV` | **FAIL (known defect)** | Defaults to `sandbox`; no exception |
| C3 | Production + missing Daraja credentials | **PASS** | Throws “missing required credentials” |
| C4 | Unknown provider value | **PASS** | Rejects `daraja-typo` |
| C5 | Unknown `MPESA_ENV` | **PASS** | Rejects `staging` |
| C6 | Development/test sandbox remains possible | **PASS** | `NODE_ENV=test`, `MPESA_ENV=sandbox` accepted |
| C7 | Production never falls back to simulator | **PASS** | `PAYMENT_PROVIDER=dev` in production rejected |
| C8 | Valid production Daraja | **PASS** | `NODE_ENV=production`, `MPESA_ENV=production` accepted |
| C9 | No provider network call | **PASS** | 0 fetch calls |

**Root cause:** `src/config.ts` validates that `MPESA_ENV` is one of `sandbox|production`, but does not require `production` when `NODE_ENV=production` and `PAYMENT_PROVIDER=daraja`. It also defaults a missing `MPESA_ENV` to `sandbox`. This is a configuration/security contract failure, not a test failure.

### D. Daraja amount consistency — `tests/phase2a1/daraja-amount.test.ts`

All provider traffic is mocked with deterministic `fetch` fakes. No real OAuth, STK Push or STK Query request leaves the process. Database is an isolated temporary SQLite file.

| # | Scenario | Result | Evidence |
|---:|---|---|---|
| D1 | KES 337.50 (33,750 minor) STK amount | **FAIL (known defect)** | STK `Amount=338` → reconstructed 33,800 ≠ 33,750 |
| D2 | Same fractional amount callback parse | **FAIL (known defect)** | Callback `Amount=338` parses to 33,800 ≠ 33,750 |
| D3 | Same fractional amount settlement | **FAIL (known defect)** | Order stayed `pending_payment`; no tickets |
| D4 | KES 0.01 (1 minor) STK amount | **FAIL (known defect)** | STK `Amount=0` → 0 ≠ 1 |
| D5 | Provider rejection | **PASS** | Returns `{ok:false,status:"unavailable"}` |
| D6 | Provider timeout | **FAIL (known defect)** | Fetch rejection escapes as an exception instead of a safe unavailable result |
| D7 | Delayed provider response | **PASS** | Awaited; returns the provider request ID |
| D8 | KES 1,000.00 (100,000 minor) STK | **PASS** | `Amount=1000` → 100,000 |
| D9 | KES 1,350.00 whole-shilling settlement | **PASS** | Settled once; one ticket |
| D10 | Amount mismatch | **PASS** | Payment marked failed; order `pending_payment`; reconcile exception |
| D11 | Currency mismatch | **PASS** | Payment not settled |
| D12 | Provider query result | **PASS with limitation** | Confirms paid/not-paid only; no amount/currency field to compare |

**Root cause:** `src/payments/daraja.ts` sends `Math.round(amountMinor / 100)`, and `parseDarajaCallback()` converts the callback with `Math.round(Number(Amount) * 100)`. The persisted order and payment use exact minor units. There is no rounding decision recorded at the pricing boundary, so the STK amount, callback amount, persisted amount, settlement comparison and reporting can disagree.

**Provider-query limitation:** `verifyTransaction()` returns `{reachable, paid, detail}` only. It does not return the provider amount or currency, so the query path cannot independently prove the paid amount. The callback path does compare amount and currency, but only after parsing the provider’s rounded whole-KES value.

### E. Payment initiation persistence ordering — `tests/phase2a1/payment-ordering.test.ts`

The failing test drives the **real `/checkout` route** with the dev provider and monkeypatches `DatabaseSync.prototype.prepare` to throw on `INSERT INTO payments`. This simulates local persistence failure after the provider has accepted the request. The patch is restored in `finally`; it is test-only.

| # | Scenario | Result | Evidence |
|---:|---|---|---|
| E1 | Provider accepts, then local payment insert fails | **FAIL (known defect)** | Route returned **500**; `hasPayment:false`; no recoverable local identity |
| E2 | Duplicate provider request ID | **PASS** | Same ID maps to one payment row |
| E3 | Second active initiation for one order | **FAIL (known defect)** | A second provider request ID creates a second active attempt; no one-active-attempt guard |
| E4 | Unknown provider callback | **PASS** | 404; no tickets issued |
| E5 | Provider timeout / delayed response | Covered in D6/D7 | Timeout throws; delayed response awaits |
| E6 | Retry after uncertain outcome | **Blocked by missing lifecycle seam** | No route/service operation exposes “retry an uncertain attempt”; E3 shows multiple active attempts are currently allowed |
| E7 | Reconciliation of unknown final state | **Partial** | Unknown callback is safely rejected; there is no reconciliation read model linking an orphan provider transaction back to an order |

**Current sequence (confirmed in `src/routes/checkout.tsx`):**

1. `createOrder()` creates the local order and reservation.
2. `provider.initiate(...)` is awaited.
3. `recordInitiated(...)` inserts the payment row.

A successful STK call followed by a failed insert or process stop leaves Safaricom holding a `CheckoutRequestID` that the application never stored. The customer may pay; the callback is rejected as unknown; no ticket is issued. The route returns 500, but the money-side outcome is not recoverable from local state alone.

**Testability blocker:** there is no provider-injection or payment-store seam in the checkout route. The monkeypatch proves the ordering defect, but a stable regression test for timeout/retry/reconciliation needs an injectable provider and a payment-attempt store. That seam should be added in Phase 2B, not in this test-only phase.

---

## 4. Passing, failing and expected-failure summary

### Main suite — passing baseline

Command:

```bash
npm test
```

Result: **94 tests, 94 pass, 0 fail, 0 skipped, 0 todo**; exit **0**.

This is the honest green baseline. The Phase 2A.1 known-defect directory is deliberately excluded by the existing runner, which discovers only `tests/*.test.ts`.

### Known-defect suite — red command

Command:

```bash
node scripts/run-phase2a1-regressions.mjs
```

Result: **39 tests, 23 pass, 16 fail, 0 skipped, 0 todo**; exit **1**.

The 16 failures are the known defects, not “expected passes.” The command reports failure while any asserted defect remains. If Phase 2B fixes the defects, these specifications should pass and the command should exit 0; the command intentionally has no xfail annotation to remove.

### Counts by area

| Area | Tests | Pass | Fail (known defect) |
|---|---:|---:|---:|
| Sale window | 6 | 2 | 4 |
| Delivery minimum | 8 | 5 | 3 |
| Production config | 9 | 7 | 2 |
| Daraja amount | 12 | 7 | 5 |
| Payment ordering | 4 | 2 | 2 |
| **Total** | **39** | **23** | **16** |

### Exact failing specifications

1. `before opening: createOrder rejects`
2. `exactly at closing: createOrder rejects (end exclusive)`
3. `after closing: createOrder rejects`
4. `public-page filtering is not the enforcement mechanism`
5. `below minimum: createJuiceOrder rejects`
6. `browser-submitted totals cannot bypass the minimum`
7. `server-resolved prices are used for the minimum decision`
8. `fractional-KES order: STK Amount must equal the payable amount`
9. `fractional-KES callback: parsed minor amount must equal the order total`
10. `fractional-KES settlement: verified success must issue tickets`
11. `one-cent payable amount must not round to zero`
12. `provider timeout must return a safe unavailable result, not throw`
13. `provider acceptance followed by local insert failure leaves no recoverable payment identity`
14. `a second active initiation for one order must be refused`
15. `production + MPESA_ENV=sandbox must fail configuration`
16. `production + missing MPESA_ENV must not silently default to sandbox`

### Test-framework strategy

**Option B** was used. Node 24.19.0’s test runner has no supported xfail annotation with the required “fail if fixed but annotation remains” semantics. Skipped tests and `test.todo` were explicitly prohibited. The red suite is separate, executable and non-zero while defects remain; the main suite is green and does not hide a defect.

The main suite’s three former skips were removed. The replacement coverage is active: four sale-window/minimum specifications moved to the red suite, and one paid-ticket-after-close regression was added to the main suite.

---

## 5. Existing baseline and build checks

### Pre-Phase 2A.1 baseline

The last pre-modification run is the Phase 2A final log, not a newly executed Phase 2A.1 run:

| Check | Result | Source |
|---|---|---|
| Phase 2A final tests | 96 tests, 93 pass, 0 fail, 3 skipped | `.freebuff/phase2a/test-final.log` |
| Current main tests | 94 tests, 94 pass, 0 fail, 0 skipped | `.freebuff/phase2a1/test-main3.log` |
| Current known-defect tests | 39 tests, 23 pass, 16 fail, 0 skipped | `.freebuff/phase2a1/test-known-defects4.log` |
| Typecheck | exit 0 | `.freebuff/phase2a1/typecheck4.log` |
| Build | exit 0 | `.freebuff/phase2a1/build.log` |
| `git diff --check` | exit 0 (CRLF advisory warnings only) | `.freebuff/phase2a1/diff-check.log` |

**Limitation:** the pre-modification baseline was not re-executed immediately before the test-file edits in this phase; the 96/93/3 value is the preserved Phase 2A final result. It is reported as historical baseline, not as a newly executed check. The 94/94 result is the current main suite after the edits.

### Commands run

```bash
npm test
node scripts/run-phase2a1-regressions.mjs
npm run typecheck
npm run build
git diff --check
```

No HTTP verifier was rerun; the preserved development database was not put at risk. The existing server on 8787 was left running.

---

## 6. Application source, migration and data confirmation

| Boundary | Confirmation |
|---|---|
| Application source | **Unchanged.** `find src db/migrations -newermt '2026-11-16 12:35:00'` returned no files. Only test files, one test-only script and this report were authored. |
| Payment adapter/config/checkout/order/event/juice/ticket implementation | **Unchanged.** No `src/**` file was edited. |
| Migrations | **No migration added or applied.** Directory count remains 7. |
| Development database | **Not mutated.** Read-only `PRAGMA integrity_check` returned `ok`; 7 migrations present. |
| Test databases | Isolated temporary SQLite files under the OS temp directory; removed after each suite. |
| Live payments | **None.** All Daraja traffic was mocked; no OAuth, STK Push or Query request was made. |
| Deployment/infrastructure | **None.** |
| Owner outreach | **Unchanged.** |
| Git staging/commit/push | **None.** 0 staged; no commit or push. |

---

## 7. Daraja amount discrepancy — numerical examples

### Tested: KES 337.50 ticket order

Pricing fixture: original KES 250.00; commission split produces an order total of **33,750 minor = KES 337.50**.

| Stage | Value |
|---|---|
| Local order total | 33,750 minor |
| STK request | `Math.round(33,750 / 100) = 338` KES |
| Callback `Amount` | 338 |
| Callback parse | `Math.round(338 × 100) = 33,800` minor |
| Settlement comparison | 33,800 ≠ 33,750 → amount mismatch |
| Observed result | payment marked failed; order `pending_payment`; reconcile exception; 0 tickets |

The test output is exactly `33800 !== 33750` for both the STK reconstruction and the callback parse; the settlement test observed `pending_payment` instead of `ticket_issued`.

### Tested: KES 0.01 (one minor unit)

| Stage | Value |
|---|---|
| Local amount | 1 minor |
| STK request | `Math.round(1 / 100) = 0` KES |
| Callback parse | 0 minor |
| Expected | 1 minor |
| Observed | `0 !== 1` |

A zero-amount STK request is not a valid financial outcome; this is the extreme case of the same granularity defect.

### Tested: KES 1,000.00 whole shillings

| Stage | Value |
|---|---|
| Local amount | 100,000 minor |
| STK request | 1,000 KES |
| Callback parse | 100,000 minor |
| Settlement | Succeeds once; one ticket |

Whole-shilling totals are internally consistent. The defect is specifically fractional-KES payable totals.

### Arithmetic implied by the current code (not separately executed)

| Local minor | KES | STK rounded | Callback minor | Difference |
|---:|---:|---:|---:|---:|
| 33,749 | 337.49 | 337 | 33,700 | −49 |
| 33,750 | 337.50 | 338 | 33,800 | +50 |
| 33,751 | 337.51 | 338 | 33,800 | +49 |

These three examples are derived from `Math.round(amountMinor / 100)`; only 33,750 and 1 were executed as tests. They show that the current policy can both undercharge and overcharge by up to 50 cents.

### Consistency requirement

The same payable amount must be used for:

1. Checkout calculation.
2. STK Push request.
3. Persisted payment record.
4. Provider verification.
5. Settlement.
6. Financial reporting.

Today, (1), (3), (5) and (6) use exact minor units while (2) and the callback parsing use rounded whole KES. (4) has no amount at all.

### Founder decision required

Choose one policy:

- **Whole-KES only:** constrain prices, customisations, discounts and fees so every payable total is a whole number of shillings; round once at the pricing boundary; persist and send that rounded total; document who absorbs any rounding. This is the simplest reconciliation policy but changes menu/price flexibility.
- **Fractional-KES supported:** send the exact decimal amount to Daraja (if the merchant/API contract accepts it), parse the callback exactly, and compare in minor units. This requires confirming Safaricom's accepted amount format and testing it in sandbox.
- **Hybrid:** calculate exact minor units, round only at the provider boundary, persist both the exact and charged amounts, and make the difference an explicit accounting/reconciliation line. This is the most flexible but requires reporting and refund rules.

This report does not select a policy and does not change the implementation. The current code comment (“Daraja takes whole KES”) is an assumption, not a founder-approved rule.

---

## 8. Payment persistence-ordering risk and proposed design

### Confirmed failure

The real checkout route currently does:

```text
createOrder()
  → provider.initiate()        // provider accepts, returns CheckoutRequestID
  → recordInitiated()          // INSERT INTO payments
```

With the payment insert forced to fail, the route returned **500** and the database had **no payment row**. The provider-side request may already exist. Unknown callback → 404; no ticket. The customer can be charged with no local reconciliation key.

### Why this is dangerous

- The provider request ID is the only idempotency/correlation key for Daraja callbacks.
- If it is lost after provider acceptance, the application cannot match a legitimate callback.
- A retry can create a second STK request and a second charge.
- The current route cannot distinguish “provider rejected,” “provider timed out,” “provider accepted but local write failed,” and “provider accepted and callback arrived late.”

### Proposed design (Phase 2B, not implemented here)

1. **Create the local payment attempt before the provider call.** Insert a row with `order_id`, locally generated `attempt_ref`, amount, currency, provider, status `initiating`, and a unique active-attempt constraint. The customer/order identity exists even if the provider call fails.
2. **Pass a stable correlation value.** Use the order/attempt reference in the provider request where supported (`AccountReference`), and persist the provider's `CheckoutRequestID` and `MerchantRequestID` immediately on response.
3. **Make completion atomic and retryable.** Update the attempt from `initiating` to `initiated` (or `failed`/`unknown`) with the provider identifiers. If this write fails, retry it durably; do not return a success page until the local state is durable.
4. **Never auto-retry an uncertain attempt.** A timeout or transport failure after the request was sent is `unknown`, not `failed`. Do not start a second STK Push automatically. Surface “payment status under confirmation” and reconcile.
5. **One active attempt per order.** Reuse an existing `initiating`/`unknown` attempt; reject a second active initiation. Definite provider rejection can allow a new attempt.
6. **Reconciliation path for orphan callbacks.** If a callback arrives for an unknown CheckoutRequestID, create an orphan reconciliation record from the callback metadata (receipt, amount, phone, timestamp) and require manual/operator linkage; never auto-settle. This is the recovery path when the local write was lost.
7. **Persist the provider query result.** `verifyTransaction()` currently returns only paid/not-paid. Store the query outcome and timestamp with the attempt so support can reconstruct the final state.
8. **Add timeouts.** OAuth, STK and Query need bounded `AbortSignal` timeouts. A timeout must produce a safe result, not an uncaught exception.
9. **Test seam.** Inject a `PaymentProvider` and a payment-attempt store into the checkout route (or an app factory) so timeout, rejection, delayed response, duplicate initiation, and post-provider local failure can be tested without monkeypatching `DatabaseSync`.

### Required schema/design changes (not applied)

- Payment attempt status (`initiating`, `initiated`, `unknown`, `failed`, `succeeded`) and a locally generated attempt reference.
- A unique partial index for one active attempt per order.
- A durable provider-response/outbox path or an operator-visible orphan reconciliation queue.
- A stored query result or reconciliation note.

### Test seam blocker

There is no provider-injection seam today. The monkeypatch proves the defect, but stable timeout/retry/reconciliation tests need the seam described above. This report does not modify the implementation to create it.

---

## 9. Outstanding founder decisions

1. **Sale-window boundary:** confirm start-inclusive/end-exclusive and the timezone interpretation (UTC storage vs Africa/Nairobi display). The tests use the documented rule; the founder should approve it explicitly.
2. **Late payments after close:** if a customer initiates before `sale_ends_at` but the confirmed callback arrives after it, should the order settle, be refunded, or go to manual review? The current settlement path does not check the sale window; existing paid tickets remain valid.
3. **Delivery minimum basis:** subtotal only, or subtotal after discounts/customisations? Is the delivery fee included? Are all zones individually configured? Are pickup orders always exempt? The tests assert subtotal-before-discount only where the current data model makes that unambiguous; the rest is policy-blocked.
4. **Daraja fractional-KES policy:** whole-KES payable totals, exact decimals, or a hybrid with an explicit rounding line? Who absorbs the difference, and what is the refund/void rule?
5. **Uncertain payment outcome:** for a timeout or unknown provider state, is the customer told to wait, retry, or contact support? Who owns manual reconciliation and within what SLA?
6. **Duplicate initiation:** confirm one active attempt per order, and whether an existing uncertain attempt can be reused or must be closed before a retry.
7. **Production sandbox guard:** confirm production must require `MPESA_ENV=production`, and confirm callback HTTPS/non-loopback requirements. The test asserts the intended contract; the implementation currently fails it.
8. **Provider query amount:** Daraja's STK Query returns paid/not-paid, not amount. Confirm that callback amount + statement reconciliation is sufficient, or require an additional settlement report.
9. **Juice online payments:** juice orders currently have no payment initiation and remain unpaid/pay-on-collection. Confirm whether the delivery-minimum work should be paired with a juice payment flow or remain order-only.
10. **Daraja sandbox access:** credentials, shortcode type, public HTTPS callback and test MSISDN remain external blockers. No live/sandbox transaction is authorised by this report.

---

## 10. Recommended next implementation sequence

1. **Founder policy decisions** — resolve §9 items 1–4 first; they determine the source changes and prevent inventing rules in code.
2. **WP1 — sale window and delivery minimum** — enforce both inside the existing server-side creation services; add stable rejection codes; keep the red tests as the acceptance gate. No public-page-only fix.
3. **WP2 — Daraja correctness** — implement the chosen amount policy, require production `MPESA_ENV=production`, add OAuth/STK/Query timeouts, and add the payment-attempt/outbox design.
4. **WP2 tests** — run the red suite to 0 failures; keep the main suite green; run typecheck, build and `git diff --check`.
5. **Sandbox matrix** — only after credentials and a public HTTPS callback are approved: success, rejection, timeout, duplicate, amount mismatch, currency mismatch, unknown callback, and late callback. No live money.
6. **Staging/owner acceptance** — isolated DB, real HTTPS, owner walkthrough; live payments remain a separate approval after sandbox evidence.

**Exit condition for Phase 2A.1:** this report, the preserved working tree, and the two test commands. The main suite is green at 94/94; the red suite is 39 tests with 23 pass and 16 known-defect failures and exits 1. No implementation, migration, payment, deployment, owner message, stage, commit or push occurred.

---

## 11. Evidence index

| Artifact | Purpose |
|---|---|
| `.freebuff/phase2a1/test-main3.log` | Current 94/94 main-suite run |
| `.freebuff/phase2a1/test-known-defects4.log` | Current 39-test red run; 23 pass / 16 fail |
| `.freebuff/phase2a1/typecheck4.log` | Typecheck exit 0 |
| `.freebuff/phase2a1/build.log` | Build exit 0 |
| `.freebuff/phase2a1/diff-check.log` | `git diff --check` exit 0; CRLF advisory warnings only |
| `.freebuff/phase2a1/test-main2.log`, `test-known-defects2.log` | Earlier identical-count runs retained for traceability |
| `.freebuff/phase2a/test-final.log` | Historical 96/93/3 Phase 2A baseline |
| `.freebuff/phase2a/git-baseline.txt`, `preflight.txt` | Phase 2A Git/untracked baseline |
| `.freebuff/phase2a/db-integrity.log` | Phase 2A read-only DB integrity evidence |

**Final status:** test-only phase complete. The defects are exposed, not hidden or fixed. Awaiting founder approval before any implementation.
