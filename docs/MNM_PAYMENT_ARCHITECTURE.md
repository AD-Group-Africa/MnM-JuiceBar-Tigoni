# MnM — Shared Payment Architecture

**Date:** 16 November 2026  
**Status:** design for the approved commercial scope. Ticketing has a working simulator and a guarded Daraja adapter; juice payments are **not yet implemented**. No live M-Pesa credentials exist and no live payment has been made.

---

## 1. Approved scope

The founder has approved M-Pesa for **both** divisions from the initial commercial release:

- **MnM Juice Bar** — catalogue, customisable ordering, server-calculated pricing, M-Pesa, order management, pickup/delivery, owner-approved cash, receipts, refunds and reconciliation.
- **MnM Tickets** — event discovery/creation, tiers, M-Pesa, QR issuance, gate verification, duplicate rejection, attendance and organiser reporting.

External organisers must have self-service accounts, but **MnM retains approval, suspension, publication, refund, commission and settlement controls**. Organiser self-service is not implemented in Phase 1.

---

## 2. Core principle: one provider, two financial lifecycles

M-Pesa is a shared payment rail, not a shared order. Juice orders and ticket orders must never be merged into one ledger or one lifecycle.

| Dimension | Juice order | Ticket order |
|---|---|---|
| Business reference | `MNM-J-...` | `MNM-...` |
| Fulfilment trigger | Confirmed payment or authorised cash transaction | Confirmed payment |
| Primary consumer | Kitchen/dispatch | Ticket issuance/gate |
| Refund object | Juice order/item | Ticket/order |
| Reconciliation owner | Juice operations | Ticketing/organiser settlement |
| Settlement | MnM revenue/cash-up | Organiser split + MnM/AD commission |
| Customer receipt | Juice receipt | Ticket + payment receipt |

Separate references are mandatory for support, provider reconciliation, refunds and accounting. A single payment table can hold both, but it must carry the business domain and the owning order type.

---

## 3. Current implementation vs target

| Capability | Current state | Target |
|---|---|---|
| Ticket STK initiation | Daraja adapter exists; requires credentials | Sandbox then production |
| Ticket callback | Amount/ref/merchant checks + provider status query | Live verification |
| Ticket settlement | Atomic paid + issue transaction | Keep |
| Ticket duplicate protection | Implemented | Keep |
| Ticket refunds | Staff start/complete, tickets voided | Provider refund integration + settlement reversal |
| Juice payment initiation | **Not implemented** | Shared provider, juice-specific reference |
| Juice tender recording | **Not implemented** | Cash/M-Pesa tender + receipt |
| Juice refunds | **Not implemented** | Policy-driven refund record |
| Shared reconciliation | `reconcile_exceptions` only | Daily provider/ledger reconciliation |
| Organiser settlement | **Not implemented** | Controlled settlement records |
| eTIMS | Not started | Separate tax workstream |

This document does not claim that any “target” row is live.

---

## 4. Payment lifecycle

```text
CREATED
  │  order exists, amount fixed server-side
  ▼
INITIATING ──provider error──► UNAVAILABLE (retry/another tender)
  │
  ▼
PENDING_PROVIDER
  │        │                 │
  │        │                 └── expiry/timeout ──► EXPIRED / PAYMENT_FAILED
  │        └── callback failure ──────────────────► PAYMENT_FAILED
  ▼
CALLBACK_RECEIVED
  │
  ├── verification unavailable ──► PENDING_VERIFICATION (retry; no fulfilment)
  ├── amount/currency/ref mismatch ──► RECONCILE_EXCEPTION
  ├── provider says failure ──► PAYMENT_FAILED
  └── provider says success
          │
          ▼
     SETTLED (payment)
          │
          ├── juice: record tender, release to kitchen/dispatch per policy
          └── ticket: atomically issue tickets, then TICKET_ISSUED
```

### State meanings

| State | Meaning | Customer-facing |
|---|---|---|
| `created` | Order exists; amount server-calculated | Order reference issued |
| `initiating` | STK request in flight | “Check your phone” |
| `pending_provider` | Request accepted; outcome unknown | Pending |
| `pending_verification` | Callback arrived but trusted query unavailable | Pending — do not say paid |
| `succeeded` | Provider and amount verified | Paid |
| `failed` | Provider declined/expired | Not paid |
| `expired` | Reservation/payment window elapsed | Expired |
| `refund_pending` | Staff approved refund; provider action pending | Refund in progress |
| `refunded` | Refund completed | Refunded |
| `reconcile_exception` | Ledger/provider disagreement | Needs support |
| `duplicate` | Repeated callback ignored | No change |

Payment state and order state are related but not identical. A payment can be `succeeded` while the order is `reconcile_exception` (for example, capacity changed before issuance); that must be visible to staff and must not be reported as fulfilled.

---

## 5. Initiation

### Common rules

- Amount is computed server-side from the persisted order; never from the browser.
- Currency is `KES`.
- Phone is normalised to `+2547…`/`+2541…` before provider submission.
- Business reference is unique and stable for the order.
- Provider request ID is unique and persisted before any callback can arrive.
- The UI must display “pending”, not “paid”, until verified settlement.
- A new attempt creates a new payment row; the old attempt remains auditable.

### Ticket STK

Current adapter:

```text
POST https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest
BusinessShortCode, Password(shortcode+passkey+timestamp), Timestamp,
TransactionType=CustomerPayBillOnline, Amount, PartyA, PartyB,
PhoneNumber, CallBackURL, AccountReference=MNM-<orderId>, TransactionDesc
```

The response `CheckoutRequestID` is the idempotency key; `MerchantRequestID` is stored for correlation.

### Juice STK (target)

Use the same adapter with a juice-specific account reference, e.g. `MNMJ-<juiceOrderId>` or `MNM-J-<ref>`. Do not reuse the ticket order reference. The juice payment record must point to the juice order and be distinguishable at reconciliation.

A juice payment may be:
- **M-Pesa before fulfilment** (approved target), or
- **Cash/manual tender** recorded by staff only when the owner approves a cash workflow.

Cash is not a provider callback. It requires an explicit staff-entered tender record, amount, actor and timestamp; it must not be represented as a verified M-Pesa payment.

---

## 6. Callback verification

### Daraja reality

Daraja STK callbacks are not cryptographically signed. The following are **not sufficient alone**:

- checking the amount;
- checking a source IP;
- a secret in a URL;
- trusting `ResultCode=0` in the body.

### Required strategy

1. Parse callback and identify `CheckoutRequestID`/`MerchantRequestID`.
2. Look up the stored payment by `CheckoutRequestID`; unknown references are rejected.
3. Compare stored provider, merchant request and amount/currency.
4. Query **Daraja STK Push Query** for the CheckoutRequestID.
5. Settle only when:
   - the query is reachable;
   - the callback outcome is success;
   - the query result confirms success; and
   - amount, currency, merchant/checkout references match.
6. If the query is unavailable, leave the payment pending and return a retryable response.
7. If callback and query disagree, do not settle; record a reconciliation exception.
8. Duplicates are harmless: already-succeeded orders return idempotently.

This is implemented in Phase 1 for tickets (subject to live verification). It is the required pattern for juice.

### Delayed and out-of-order callbacks

- Callback before local payment row? Reject; provider retries.
- Failure after success? Duplicate path wins; no reversal.
- Success after failure? Only settle if order is still pending and capacity/tender rules permit.
- Repeated callbacks? `duplicate` state; no extra tickets or tender entries.
- Provider query says success but local order expired? Payment remains `succeeded`; order becomes `reconcile_exception`; staff must resolve/refund.

---

## 7. Idempotency and concurrency

| Risk | Control |
|---|---|
| Duplicate STK initiation | One active payment attempt per order; new attempt requires explicit retry |
| Duplicate callback | Unique provider request ID + settled/duplicate short-circuit |
| Concurrent tickets | `BEGIN IMMEDIATE`; capacity derived from valid tickets; ticket issuance in settlement transaction |
| Concurrent juice | Order total persisted before initiation; one tender record per payment |
| Double-submit checkout | **Not yet implemented** — add client idempotency key and server unique constraint |
| Callback replay | Reference lookup + status check + provider query |

Provider request IDs must be unique at the database level. The current `payments.provider_request_id` has a unique constraint; this is preserved.

---

## 8. Refunds

### Ticket refunds

Current staff flow:
1. `startRefund` sets `refund_pending`, marks tickets refunded, releases inventory.
2. `completeRefund` sets `refunded`.
3. Both steps are audited.

Target:
- Provider refund/void request and result recorded.
- Refund amount and commission reversal recorded separately.
- Organiser settlement adjusted.
- Customer notified through a real channel.
- Refund policy (before/after sale close, event cancellation) supplied by owner.

### Juice refunds

Target:
- Staff records reason, amount and tender (cash/M-Pesa).
- M-Pesa refund through provider if supported; otherwise documented manual process.
- Order status and payment ledger reconciled.
- Receipt/credit note issued according to tax advice.

Refund approval is role-controlled; no refund should be possible from an unauthenticated or scanner-only session.

---

## 9. Settlement and reconciliation

### Ticket settlement

- **MnM/AD split** is snapshotted at order creation from the active pricing terms (current 35% markup, 25/10 points).
- **Organiser settlement** is a separate payable, not the same as the customer payment.
- Settlement must be approved by MnM; organisers can request but not self-approve.
- Commission on refunds/cancellations is a written policy decision.
- A settlement record needs: organiser, event, gross sales, refunds, commission, net payable, period, approver, payment reference, status.

### Juice settlement

- Daily cash-up: cash received, M-Pesa receipts, refunds, expenses/float.
- Each order must have a tender record or explicitly remain unpaid.
- Day-close total must reconcile to provider statement and cash count.
- Differences become a reconciliation exception, not an adjustment hidden in code.

### Reconciliation loop

```text
Provider statement / STK query
        │
        ▼
Payment ledger (payments, refunds, settlements)
        │
        ▼
Business ledger (juice orders, ticket orders, organiser splits)
        │
        ▼
Daily exception queue → owner/staff resolution → audit trail
```

Current `reconcile_exceptions` is a start, not a complete reconciliation system.

---

## 10. Audit history

Every material event should be attributable and append-only:

- payment initiated/attempted;
- callback received, verified, rejected or duplicated;
- provider query result;
- settlement/issuance;
- refund start/completion;
- settlement request/approval;
- manual cash tender;
- reconciliation resolution.

The current `audit_log` and `payments` tables support basic events. Future work should add a dedicated payment-event stream with provider payload hashes/redacted bodies, not raw secrets.

---

## 11. External organiser boundary

Organiser self-service is approved but not implemented. When built:

- Organiser accounts are scoped by organiser ID.
- All event/tier/report/settlement queries filter by that ID at the database and API layers.
- MnM roles control approval, suspension, publication, refunds, commission and settlement.
- Organisers cannot read another organiser’s sales, customer data or settlements.
- Publication requires MnM approval and authorisation evidence.
- Settlement requests are reviewed and approved by MnM.
- Commission rules are snapshotted per event/order, not editable by the organiser.

No organiser portal should be approximated by sharing staff accounts.

---

## 12. Production gate

Live payments require all of the following, none of which is currently satisfied:

- [ ] Approved Safaricom merchant/shortcode and passkey.
- [ ] Public HTTPS callback URL.
- [ ] Sandbox STK success, failure, timeout, duplicate and mismatch tests.
- [ ] STK query verification tested against Safaricom.
- [ ] End-to-end ticket purchase → callback → ticket → gate.
- [ ] Juice payment → tender record → fulfilment.
- [ ] Refund and reversal tested in sandbox.
- [ ] Daily reconciliation with provider statement.
- [ ] Monitoring/alerting for callback failures and pending payments.
- [ ] Owner-approved refund/cancellation and cash policies.
- [ ] Production secrets stored outside the repository.
- [ ] Founder authorisation to activate.

Until then, the only enabled mode is the explicitly labelled development simulator.
