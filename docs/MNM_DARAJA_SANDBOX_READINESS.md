# MnM — Daraja Sandbox Readiness

**Date:** 16 November 2026  
**Status:** Adapter structure present; **sandbox verification not started**; **live payments not activated**.  
**Decision:** Founder approved sandbox preparation only. No credential, public callback endpoint, real-money transaction or production provider change is authorised by this document.

---

## 1. Executive status

| Item | Status | Evidence |
|---|---|---|
| Daraja adapter exists | Yes | `src/payments/daraja.ts` |
| OAuth token acquisition | Implemented, not executed against Safaricom | Source inspection |
| STK Push initiation | Implemented, not executed | Source inspection |
| Official STK Push Query verification | Implemented, not executed | Source inspection |
| Callback route | Guarded and wired | `src/app.tsx`, `src/payments/notify.ts` |
| Local callback regression tests | Passing | `tests/orders.test.ts` |
| Sandbox credentials | **Missing** | No merchant arrangement available to this workspace |
| Public HTTPS callback URL | **Missing** | No deployment/public endpoint authorised |
| Sandbox transaction evidence | **None** | No live call made |
| Live M-Pesa | **Blocked** | Must not be activated |
| Whole-KES amount integrity | **Blocker found** | Adapter rounds to whole KES; settlement compares exact cents |
| Juice M-Pesa | **Not implemented** | Juice orders are unpaid/manual in v1 |
| Production sandbox guard | **Missing** | Production can select `MPESA_ENV=sandbox` |

**Correct description:** “Daraja adapter and local callback guards are implemented and locally tested; sandbox integration is prepared but has not been executed.”

---

## 2. What is implemented

### 2.1 Provider selection and fail-closed configuration

`src/config.ts` requires an explicit `PAYMENT_PROVIDER`:

- `dev` — local simulator only, forbidden in production.
- `daraja` — live/sandbox M-Pesa adapter.
- Missing/unknown values fail startup.
- `PAYMENT_PROVIDER=daraja` requires `MPESA_SHORTCODE`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_PASSKEY`, `MPESA_CALLBACK_BASE`.
- `MPESA_ENV` is `sandbox` or `production`.
- `PAYMENT_DEV_FORCE_STATUS` is only valid with `dev`.

### 2.2 OAuth

`DarajaProvider.accessToken()`:

- Calls `/oauth/v1/generate?grant_type=client_credentials`.
- Uses HTTP Basic with consumer key/secret.
- Caches the token until 60 seconds before `expires_in`.
- Cache is process-local and not shared across instances.

Not executed against Safaricom.

### 2.3 STK Push

Current request:

```text
POST {base}/mpesa/stkpush/v1/processrequest
BusinessShortCode = MPESA_SHORTCODE
Password = base64(shortcode + passkey + timestamp)
Timestamp = local server time YYYYMMDDHHmmss
TransactionType = CustomerPayBillOnline
Amount = round(order total minor / 100)          <-- blocker
PartyA = phone without +
PartyB = MPESA_SHORTCODE
PhoneNumber = phone without +
CallBackURL = MPESA_CALLBACK_BASE + /pay/notify/daraja
AccountReference = MNM-<orderId>
TransactionDesc = "Event ticket"
```

The response `CheckoutRequestID` is persisted as `payments.provider_request_id`; `MerchantRequestID` is stored for correlation.

### 2.4 Callback route

`POST /pay/notify/daraja`:

1. Returns 404 unless `PAYMENT_PROVIDER=daraja` (the simulator never exposes a public callback).
2. Parses the Safaricom JSON body.
3. Looks up the stored payment by `CheckoutRequestID`.
4. Calls the official STK Push Query for that ID.
5. Refuses to settle if the query is unreachable (503, retryable).
6. Refuses a success callback contradicted by the query (502).
7. Refuses a failure callback contradicted by a paid query (409).
8. Passes `verified: true` to `handleCallback` only after the query.
9. `handleCallback` checks provider identity, merchant reference, amount/currency, duplicate state and settles exactly once.

The callback itself is not treated as cryptographically authenticated. This is correct: Daraja callbacks are not signed.

### 2.5 Local regression evidence

`tests/orders.test.ts` covers:

- Daraja callback without verification → 401, order remains `pending_payment`, 0 tickets.
- Wrong merchant reference → 409, no tickets.
- Verified + matching reference → `ticket_issued`, 1 ticket.

This is local logic only. It is **not** a sandbox transaction.

---

## 3. Required sandbox configuration

No secret values belong in this document, Git, chat, screenshots, logs or client code.

| Variable | Required value/meaning | Notes |
|---|---|---|
| `NODE_ENV` | `development` for local sandbox preparation | `production` forbids `dev`; do not use for sandbox prep |
| `PAYMENT_PROVIDER` | `daraja` | Explicit; no fallback |
| `MPESA_ENV` | `sandbox` | Production must be separately guarded |
| `MPESA_SHORTCODE` | Sandbox shortcode/ PayBill number | Must match the passkey and merchant configuration |
| `MPESA_CONSUMER_KEY` | Sandbox app consumer key | Secret; secure store/env only |
| `MPESA_CONSUMER_SECRET` | Sandbox app consumer secret | Secret; secure store/env only |
| `MPESA_PASSKEY` | Sandbox STK passkey | Secret; tied to shortcode |
| `MPESA_CALLBACK_BASE` | Public HTTPS origin, no trailing slash | Code appends `/pay/notify/daraja`; must be reachable by Safaricom |
| `APP_SECRET_KEY` | 32+ byte random secret | Not a Daraja credential but required by the app |
| `PUBLIC_ORIGINS` | Exact sandbox app origin(s) | Origin/Referer checks |
| `DATABASE_FILE` | Isolated sandbox database | Never the live development DB |
| `PORT` / `BIND_HOST` | Isolated local port / bind | Use a non-production port |
| `NOTIFY_FROM` | Optional sender label | Notifications remain console-only |

**Do not** put these in `.env.example`, source, tests, documentation, screenshots or chat. Use the local `.env` (untracked) or an approved secret store. The `Sites → Secrets` path is for a hosted deployment and is not authorised in Phase 2A.

### 3.1 Merchant settings to confirm before any call

These cannot be inferred from the code and must come from the merchant/Safaricom onboarding:

1. **Shortcode type:** PayBill or Buy Goods/Till. The adapter hardcodes `CustomerPayBillOnline` and `PartyB=shortcode`. A Buy Goods merchant needs the correct transaction type and party fields; do not assume the current payload is valid.
2. **Passkey:** tied to the shortcode/environment.
3. **Callback URL:** publicly reachable HTTPS; Safaricom must accept it. Localhost is not a callback URL.
4. **Allowed source/test MSISDN:** sandbox test numbers and any IP allow-list requirements.
5. **Settlement account:** where funds land; separate from the technical integration.
6. **Reversal/refund capability:** confirm whether the merchant can reverse STK payments and under what conditions.
7. **Rate limits/timeouts:** provider-side limits for OAuth, STK and Query.
8. **Production go-live process:** Safaricom approval, shortcode switch, callback registration.

---

## 4. STK Push lifecycle — actual code path

| Step | Code | Current status |
|---|---|---|
| 1. Customer submits checkout | `POST /checkout` | Implemented |
| 2. Server resolves amount from persisted order | `createOrder` → `order.total_minor` | Implemented |
| 3. Server creates reference | `AccountReference=MNM-<orderId>` | Implemented; ticket-specific |
| 4. Server initiates STK | `provider.initiate(...)` | Implemented; not executed |
| 5. Provider returns IDs | `CheckoutRequestID`, `MerchantRequestID` | Parsed; not executed |
| 6. Customer receives prompt | Safaricom | Not tested |
| 7. Provider sends callback | `/pay/notify/daraja` | Not tested live |
| 8. Server verifies via STK Push Query | `verifyTransaction` | Not tested live |
| 9. Transaction settles once | `settleOrderPaid` | Locally tested |
| 10. Business workflow triggers | Ticket issuance | Locally tested |

### 4.1 Initiation ordering defect

`src/routes/checkout.tsx` calls `provider.initiate(...)` **before** `recordInitiated(...)`.

If Safaricom accepts the STK request and the local insert fails (database error, process stop, network response lost), the application has no payment row for the `CheckoutRequestID`. The callback is then rejected as an unknown reference, while the customer may have paid.

**Required before sandbox:** persist an `initiating` attempt with a local correlation key first, then update it with provider IDs; mark failure/retry explicitly. Never let a provider success exist without a local row.

### 4.2 Whole-KES amount defect

`src/payments/daraja.ts` sends:

```ts
Amount: Math.round(amountMinor / 100)
```

`handleCallback` compares:

```ts
input.amountMinor !== order.total_minor
```

The callback parser converts `Amount * 100`. For a KES 337.50 order:

```text
order.total_minor = 33,750
STK Amount = 338 KES
callback Amount = 338 → 33,800 minor
33,800 !== 33,750 → amount mismatch; order not settled
```

This is systemic for any ticket total ending in 50 cents. It is not fixed by the existing local tests, which use whole-KES examples.

**Decision required:** choose one explicit policy:

- round the order total to whole KES at creation for Daraja, with a visible rounding line and accounting treatment;
- restrict prices to whole-KES totals (fragile);
- compare in whole KES and record the rounding difference explicitly;
- confirm a merchant configuration that supports cents (do not assume).

No silent rounding is acceptable.

### 4.3 Other initiation observations

- `fetch` calls have **no timeout/AbortSignal**; a hung OAuth/STK/Query call can hold a checkout/callback request indefinitely.
- OAuth failure throws; `checkout.tsx` does not catch it around `provider.initiate`, so the request may become a generic 500 with no payment attempt row.
- The `TransactionDesc` is hardcoded to `"Event ticket"`. A juice integration must not reuse it and must use a distinct reference/ledger.
- `AccountReference=MNM-<orderId>` is ticket-specific but could collide with a future juice `MNM-<id>` namespace. Use product-prefixed references (`MNMT-...`, `MNMJ-...`).
- The shortcode is used as both `BusinessShortCode` and `PartyB`; confirm this matches the merchant type.
- Amount is rounded, not validated as positive/whole before the call.

---

## 5. Callback and verification limitations

### 5.1 What is protected

- Unknown `CheckoutRequestID` → rejected.
- Provider identity mismatch → 409.
- Unverified Daraja callback → 401.
- Merchant reference mismatch (when both supplied/stored) → 409 + reconcile exception.
- Amount/currency mismatch → payment failed; order not settled; reconcile exception.
- Duplicate succeeded/duplicate payment → 200 “duplicate ignored”; no extra tickets.
- Failure after success → duplicate path wins; no downgrade.
- Query unreachable → 503; no settlement.
- Query says paid but callback says failure → 409.
- Settlement is transactional and idempotent.
- Audit records are written for provider mismatch, unverified, merchant mismatch, amount mismatch, unsettled payment and settlement.

### 5.2 Residual limitations

1. **Query only checks paid/not paid.** It does not verify the queried amount, currency, merchant ID, phone or receipt. The amount check relies on the callback body. A forged callback with a known CheckoutRequestID, matching merchant reference and correct amount would pass the query gate. The query confirms *a* payment, not every field.
2. **Merchant reference is optional in the callback handler.** If the callback omits `MerchantRequestID`, the comparison is skipped. Require it for Daraja.
3. **No source IP allow-list.** The query mitigates this; an allow-list is defence in depth, not a substitute.
4. **No request timeout.** OAuth/Query can hang.
5. **No replay timestamp/nonce.** Duplicate handling is state-based; acceptable but should be combined with audit.
6. **No query-result persistence.** Only a detail string is logged. Reconciliation needs the raw status, amount, merchant ID and timestamp (safe fields only).
7. **Failure/expiry handling is coarse.** A failed callback sets the order to `payment_failed` if still pending; it does not release the reservation immediately or schedule a retry.
8. **Late success after local expiry** becomes `succeeded` payment + `reconcile_exception`; no refund/fulfilment decision or customer notice.
9. **No per-order payment-attempt limit.** Multiple STK attempts are possible if a retry route is added; enforce one active attempt.
10. **Callback response semantics** must be confirmed with Safaricom (which HTTP codes trigger retries).

The callback body must never be described as cryptographically authenticated. The query is the authentication/verification step.

---

## 6. Sandbox test matrix

Use an isolated database and sandbox credentials only. Record the exact state after each case. No real money.

| # | Case | Expected order state | Expected payment state | Ticket/inventory | Audit/exception |
|---|---|---|---|---|---|
| 1 | Successful STK Push | `ticket_issued` | `succeeded`; receipt stored | Exactly qty tickets; reservation converted; capacity correct | `payment.callback.settled` |
| 2 | Failed STK Push | `payment_failed` | `failed` | 0 tickets; reservation released/expired | `payment.callback.failed` |
| 3 | Customer cancels prompt | `payment_failed` | `failed` | 0 tickets | Failure audit |
| 4 | Timeout/no callback | `pending_payment` then `expired` per policy | `initiated`/`pending` | Reservation released | Expiry audit |
| 5 | Query unavailable | `pending_payment` | `pending` | 0 tickets | 503; retry expected |
| 6 | Delayed callback after success | `ticket_issued` | `duplicate` | No extra tickets | `payment.callback.duplicate` |
| 7 | Duplicate callback | `ticket_issued` | `duplicate` | No extra tickets | Duplicate audit |
| 8 | Invalid merchant reference | `pending_payment` | `initiated`/`pending` | 0 tickets | `merchant_mismatch` + exception |
| 9 | Amount mismatch | `pending_payment` | `failed` | 0 tickets | `amount_mismatch` + exception |
| 10 | Wrong provider identity | `pending_payment` | unchanged | 0 tickets | `provider_mismatch` |
| 11 | Duplicate checkout request | Existing order returned; no second charge | One settled payment | No duplicate tickets | Idempotency audit |
| 12 | Payment success after local timeout | `reconcile_exception` or policy-defined refund | `succeeded` | 0 or qty per policy; never silent | `unsettleable` + exception |
| 13 | Payment success, local settlement failure | `reconcile_exception` | `succeeded` | 0 tickets | `unsettleable` + exception |
| 14 | Interrupted processing / restart | Recoverable; no duplicate | One settled payment | Exactly qty once | Recovery audit |

Additional cases:

- Whole-KES rounding: price ending in 50 cents; expected policy outcome.
- OAuth failure.
- STK initiation timeout.
- Callback before local payment row (unknown reference).
- Callback with missing `MerchantRequestID`.
- Query paid but callback failure.
- Query failure but callback success.
- Refund/reversal (if supported).
- Two concurrent callbacks.
- Two orders with the same amount; ensure references do not cross-settle.

For every case, capture: request/response IDs, order ref, payment id, result codes, amount, ticket count, audit rows and reconcile exceptions. Do not capture secrets, full phone numbers or raw credentials in reports.

---

## 7. Blockers

### External / founder-owned

1. **Sandbox merchant credentials** — consumer key/secret, shortcode, passkey.
2. **Public HTTPS callback base** — no deployment or public endpoint is authorised.
3. **Merchant type confirmation** — PayBill vs Buy Goods; transaction type and party fields.
4. **Safaricom sandbox test MSISDN** and any IP/allow-list instructions.
5. **Refund/reversal capability** confirmation.
6. **Commercial settlement** and who bears rounding differences.
7. **Production go-live approval** — separate from sandbox.

### Engineering-owned (must close before sandbox execution)

1. Whole-KES amount policy and implementation.
2. Initiation-before-persistence ordering.
3. Production `MPESA_ENV` guard.
4. Fetch timeouts/retries.
5. Required `MerchantRequestID`.
6. Query-result persistence and reconciliation fields.
7. Payment attempt idempotency/retry.
8. Juice/ticket reference separation if juice is added.
9. Test matrix automation and evidence capture.

### Blocked now

- No sandbox transaction can be executed.
- No public callback can be registered.
- No live payment can be verified.
- No claim of Daraja readiness beyond local structure is valid.

---

## 8. Safe activation procedure

This is a procedure, not an authorisation. Do not execute steps requiring credentials or a public endpoint until the founder approves.

### Stage 0 — local preparation

1. Confirm all engineering blockers in §7 are closed.
2. Use an isolated database copy; never the development DB.
3. Add only non-secret placeholders to `.env.example`; keep real values in `.env`/secret store.
4. Add timeouts and structured, secret-free logs.
5. Run the full local suite and the callback regression tests.

### Stage 1 — sandbox configuration

1. Obtain credentials through an approved secure channel; never paste them into chat.
2. Set `PAYMENT_PROVIDER=daraja`, `MPESA_ENV=sandbox`.
3. Set a public HTTPS callback base (approved staging/tunnel only).
4. Register/confirm the callback URL with Safaricom if required.
5. Start on an isolated port/database.
6. Verify startup fails when any required value is missing (negative test).
7. Confirm no production hostname or production shortcode is in use.

### Stage 2 — one controlled transaction

1. Use an approved sandbox test MSISDN.
2. Create one order; record order total, STK amount and CheckoutRequestID.
3. Confirm the prompt; complete/cancel per test case.
4. Verify the callback and Query result; confirm exactly one settlement.
5. Reconcile payment, order, ticket, capacity and audit rows.
6. Repeat for failure/cancel/timeout/duplicate cases.
7. Stop and investigate on any amount mismatch or duplicate.

### Stage 3 — evidence review

1. Record results in a dated sandbox evidence log (no secrets).
2. Confirm every matrix case has an expected/actual result.
3. Obtain founder/engineering sign-off.
4. Do **not** switch production or take real money in the same change.

### Stage 4 — production (separate approval)

1. Founder authorises production credentials, callback URL and go-live window.
2. Rotate sandbox → production secrets in the approved secret store.
3. Run one controlled real transaction with a named test customer and a refund plan.
4. Reconcile end to end.
5. Enable public traffic only after reconciliation and rollback rehearsal.

---

## 9. Rollback / safe state

- Keep `PAYMENT_PROVIDER=dev` (or no public traffic) until sandbox evidence is accepted.
- If a live callback is suspect, disable the public listener or revert to the prior config; do not delete payment/audit rows.
- Preserve the database and logs for reconciliation.
- Never “fix” a paid-but-unfulfilled order by issuing tickets manually without an audited reconciliation record.
- Rotate credentials if exposed; revoke sessions and signed links as appropriate.

---

## 10. Evidence status and limitations

| Claim | Status |
|---|---|
| Adapter code present | Verified by source inspection |
| Local callback guards pass | Verified by test suite |
| OAuth/STK/Query executed against Safaricom | **Not verified** |
| Sandbox transaction | **None** |
| Live M-Pesa | **Blocked** |
| Public callback registered | **No** |
| Whole-KES reconciliation | **Blocker found** |
| Juice M-Pesa | **Not implemented** |
| Production guard | **Missing** |

No sandbox transaction was performed. No live credentials were requested in chat, logged, committed or stored in this document.
