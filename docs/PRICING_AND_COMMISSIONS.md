# Pricing & Commissions — MnM Tickets

Status: implemented and unit-tested (`tests/money.test.ts`). Terms are **proposed**, and require owner confirmation before live sales (see PILOT_READINESS).

## The model

`P` = original ticket price (integer minor units; KES cent = 1/100). Launch terms:

| Component | Formula | P = KSh 1,000 |
|---|---|---:|
| Original price | P | KSh 1,000 |
| MnM gross commission | M = 25% of P | KSh 250 |
| Afrika Digitalis platform fee | A = 10% of P | KSh 100 |
| Customer selling price | S = P + M + A (= 135% of P) | KSh 1,350 |

Key semantics: the 25% and 10% are **percentage points of the original price**, not shares of the markup pool. `mnm_points + ad_points = markup_points` is enforced structurally (`pricing_terms` CHECK, engine assertion).

## Rules implemented (summary of what is enforced where)

- All money in **integer minor units**; floating point never touches money (`src/money.ts`).
- Rounding: **deterministic round-half-up per ticket component**; `S` is derived by exact summation `P+M+A`, so the identity always holds with no reconciliation pennies.
- Rates live in the `pricing_terms` table (audit-logged, single active row). Orders store a **transaction-time snapshot** (`order_items.unit_*`, `orders.*_minor`) — later term changes never affect existing orders.
- Client code cannot alter original prices or rate points; they are entered only via authenticated staff routes with role checks, and every change is written to `audit_log`.
- Duplicate payment callbacks are idempotent (payments keyed on provider request id; see PAYMENTS_AND_RECONCILIATION.md) — commissions can never be counted twice.
- Refunds: refund spreads customer refund = S per ticket; commission reversal is recorded on the order (MnM −M, AD −A) with explicit exceptional cases handled in the dashboards.

## Engineering

- Engine: `src/money.ts` — `priceSplit(p)`, `priceSplitForQty(p, qty)`, `roundPoints`, `formatMinor`.
- Terms table: `pricing_terms`; active row applies to new orders only.
- Unit price breakdown is displayed to customers on the event page (what you pay) and to staff (who earns what).
