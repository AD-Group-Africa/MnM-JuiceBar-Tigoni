# Juice — Checkout & Staff Workflow Verification (Sprint 2)

Date: 2026-10-17 · All results from `tests/juice-storefront.test.ts` against an isolated temp
SQLite database with deterministic fixtures (migrations → seeded owner + scanner users, one
product, one delivery zone, pending reviews). No real M-Pesa traffic; no production data.

## Defects found and fixed (each blocked a whole workflow)

1. **`createJuiceOrder` ran a broken placeholder INSERT** (`VALUES (?,?,?,?,...,...,?,...,?)` with
   literal `...`) before the real statement — every juice order creation threw and returned
   "Could not create order". Checkout could never succeed. Placeholder statement removed.
2. **Order INSERT had 19 placeholders for 20 columns** — still fatal after (1). Fixed to 20.
3. **Audit row used `actor_user = 0`** for guest orders; `audit_log.actor_user` is a nullable FK to
   `users`, and user 0 does not exist → FOREIGN KEY failure on every guest checkout. Now `NULL`.
4. **No quantity/price-extra validation** — `qty: -2`, `qty: 0` or negative client-supplied
   `sizePriceMinor` flowed into money maths. `createJuiceOrder` now rejects non-integer/out-of-range
   quantities (1–99), >50 line items, and negative/non-integer size or add-on price extras; the
   checkout route no longer coerces garbage qty to 1 (`Number(i.qty) || 1` — it now passes raw values
   through so the server rejects them).
5. **Delivery orders accepted a missing/malformed/disabled zone with fee 0** (`deliveryZoneId` of
   `0`/`NaN` skipped the zone lookup). Delivery now *requires* a real, enabled zone or the order
   is refused.
6. **Delivery-zone staff forms coerced invalid fees to 0** (`Number("abc") || 0`). Both zone POSTs
   now validate name (required, ≤80), fee/min-order (KES pattern, stored ×100 as minor units) and
   sort order, and reject with a 400 error list. Zone edit of an unknown id returns 404.
7. **Review moderation accepted any status string** (`body.status as ...` cast) — an invalid action
   would have been written to the DB. The route now allows only `approved`/`rejected` and validates
   the review id; `moderateReview` still enforces "rejection requires a note".

## Verified workflows (all automated, all pass)

### Public checkout (`POST /juice/checkout`)
- Valid pickup order → 302 to `/juice/order/<ref>`; order persisted with `status='new'`,
  `payment_status=NULL`, exact minor-unit totals; confirmation page renders the reference.
- Valid delivery order → delivery fee from the enabled zone added; `total = subtotal + fee` exactly.
- Unavailable product, empty cart, missing name/phone → 400 with user-safe messages, no order row.
- Invalid quantities (`0`, `-2`, `abc`) and negative size extras → 400, **no order row created**.
- Unknown product id → 400 "Unknown product in cart."; page contains no SQL/DB internals.
- Disabled zone → 400 "Selected delivery zone is not available."; unknown zone id → 400;
  malformed zone id (`abc`) → 400. No `NaN` totals anywhere.
- Repeated identical submissions → two orders with **unique** references (the v1 data model has no
  idempotency key — see limitations).
- **No order is ever marked paid without provider verification**: every created order has
  `payment_status IS NULL`; a final test asserts no juice order in the DB carries a payment status.

### Order detail & receipt (staff)
- Detail page renders ref, customer, line items; DB shows integer minor-unit money
  (unit × qty = line total = subtotal = total for pickup).
- Receipt renders formatted money (unit `KSh 17.50`, subtotal `KSh 35.00`, fee `KSh 50.00`,
  total `KSh 85.00`), the order reference, and the working back-link (literal `{order.id}`
  href bug fixed).
- Missing order → 404 on detail and receipt. No session → 302 to staff login (both routes).
  Scanner role (no `reports` capability) → redirected; records outside authorised scope stay
  unreachable.

### Review moderation (staff)
- Approve → 302, persisted `approved`, audit row `review.approved`.
- Reject without note → 400 "Rejection requires a note.", state unchanged.
- Reject with note → status + note persisted; the note renders on the rejected-filter page.
- Invalid action / invalid id / missing review → 400 with clear messages.
- Unauthenticated and scanner requests → 403, state unchanged.
- Repeating an approval → idempotent, no corruption. Moderated reviews render in the staff UI
  under the correct filter.

### Delivery zones (staff)
- Create valid zone → fee 75 → `fee_minor` 7500; min order 400 → 40000; `enabled=1`. Persisted
  rows verified by direct DB query, not by HTTP status alone.
- Invalid fee/name/malformed values → 400, zone not modified.
- Edit updates fee and toggles `enabled`; disabled zone is refused at checkout.
- Zone list renders in the staff UI; the enabled zone's fee flows into real checkout totals.

## Payment-testing limitations (explicit)

- The juice checkout has **no payment-initiation endpoint** yet — orders are created unpaid and the
  customer is told to expect contact/payment confirmation. Daraja STK Push wiring for juice orders
  is future work; therefore "payment initiation failure" and "uncertain payment outcome" scenarios
  **could not be exercised** and are reported as blocked, not passed.
- What *was* verified: nothing in the juice code path can mark an order paid — `payment_status` is
  only ever read, never written, and the settlement path belongs to the ticketing payments module
  (provider callbacks with idempotency). A regression test asserts `payment_status IS NULL` for all
  juice orders after the full checkout journey.
- All payment behaviour tested here uses the project's dev simulator only; no live M-Pesa
  credentials were used or are claimed.

## Remaining gaps

- No idempotency key on checkout (double-submit creates two orders; refs are unique).
- Minimum-order values are stored per zone but not yet enforced as a hard checkout rule (the data
  model treats them as informational; enforcement is a product decision).
- Order status *transitions* (staff status POSTs) are covered by the module but were not part of
  this sprint's required scenarios.
