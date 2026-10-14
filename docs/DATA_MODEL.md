# Data model

Authoritative schema: `db/migrations/*.sql` (applied in filename order). DDL summary below; see ARCHITECTURE.md for flows.

## Core entities

- **pricing_terms** — versioned commercial configuration; single `active=1` row; `mnm_points + ad_points = markup_points` enforced by CHECK. Attach at order time; never mutate past orders.
- **users / sessions** — staff accounts (`owner`, `manager`, `sales_staff`, `scanner`, `ad_admin`), sessions store only SHA-256 of tokens with expiry.
- **events** — draft→on_sale→paused→completed/cancelled; requires authorization_ref + authorized_by/authorized_at before publish (enforced in code and covered by a test).
- **ticket_categories** — per event; `original_price` (minor units), `quantity`, `sold_count`.

## Transactions & fulfilment

- **reservations** — active reservations decrement availability until expiry (~15 min); converted on payment success.
- **orders** — lifecycle `draft → pending_payment → paid → ticket_issued`, plus `payment_failed, expired, cancelled, refund_pending, refunded, reconcile_exception`; stores the full pricing snapshot (terms id, original/mnm/ad/total minor, currency). Guest access keyed by signed token; DB stores only its hash.
- **order_items** — per-category qty with unit-level price snapshot.
- **payments** — append-only: one row initiated per attempt; provider request id is a UNIQUE idempotency key; duplicate callbacks map back to the original row and are marked `duplicate`.
- **tickets** — one row per ticket bought; `ticket_code` random (URL-safe; no PII); status `valid/redeemed/refunded/cancelled/void`; `redeemed_at/by`.
- **scan_log** — every verification attempt (accepted OR rejected) with scanner, reason, timestamp.
- **notifications** — delivery attempts with status; dev adapter logs them clearly.
- **audit_log** — sensitive admin actions (publishing, pricing changes, refunds, term edits).
- **reconcile_exceptions** — payments needing manual review (mismatched amounts, outcomes pending provider state).

## SQLite → Postgres port deltas (documented; small)

- `AUTOINCREMENT` → `GENERATED ALWAYS AS IDENTITY`; `INTEGER PRIMARY KEY AUTOINCREMENT` maps cleanly.
- `strftime('%Y-%m-%dT%H:%M:%fZ','now')` defaults → `now()`.
- `BEGIN IMMEDIATE` → standard `BEGIN` (or `SELECT ... FOR UPDATE` on the hot rows); the conditional sold-count guard is written as an UPDATE ... WHERE guard that works on both.
- CHECK constraints, unique partial index, strict lifecycles: identical.
