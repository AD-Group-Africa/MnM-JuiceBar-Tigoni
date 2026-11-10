# Ticket Security — MnM Tickets

## Threat model

The platform is designed for **authorised ticket resale only**. Security controls assume the operator (MnM staff or AD admin) is trusted, but protect against fraud, tampering, and unauthorised access from external parties.

## Core guarantees

| Guarantee | How it's enforced |
|---|---|
| **One ticket, one code** | `ticket_code` is a cryptographically random URL-safe string (generated in `src/ids.ts`). Each code maps to exactly one row in the `tickets` table. |
| **No PII in QR** | The QR payload contains only `ticket_code` and a verification URL — no personal data, payment details or secrets. |
| **Online verification required** | Staff must use the `/verify` or `/staff/scan` endpoint; QR codes are never trusted offline. |
| **Duplicate redemption impossible** | The `UPDATE tickets SET status='redeemed' WHERE id=? AND status='valid'` is atomic; once `redeemed`, the row cannot be updated again. |
| **Every scan is audited** | `scan_log` records `ticket_code, result, reason, created_at, scanner_id` on every verification attempt. |
| **Refunded/cancelled tickets rejected** | Orders lifecycle transitions enforce that refunded/cancelled tickets have `status ≠ 'valid'` in the DB. |
| **Tamper detection** | QR decoder processes the URL-safe code; if the code maps to no row or a non-valid row, the ticket is rejected. |

## Attack surface and mitigations

| Threat | Mitigation |
|---|---|
| QR code screenshot replay | Online verification checks DB status at scan time; each redemption atomically changes status. |
| Duplicate scan from two staff | `scan_log` + atomic `WHERE status='valid'` guard ensures only the first scan succeeds; subsequent attempts return "DO NOT ADMIT". |
| Code tampering (altering QR pixel data) | QR decoder extracts the structured `ticket_code`; the code itself is verified against the DB, not the pixel pattern. |
| Session hijacking (scanner staff) | Session cookies have `SameSite=Lax`; origin checks on `POST /staff/scan` reject cross-origin requests. |
| Provider callback replay | Payment callbacks are idempotent: the `provider_request_id` is UNIQUE; duplicate notifications map to the original row and are marked `duplicate`. |
| Commission double-counting | Commissions are snapshotted per-order at payment time (`order_items.*, orders.*_minor`); later `pricing_terms` changes never retroactively affect paid orders. |
| SQL injection | All queries use parameterized statements via `db.ts` helpers; no raw string interpolation in SQL. |
| XSS in rendered pages | Hono JSX auto-escapes; user-generated content (event names, organizer contacts) is rendered through the `String()` utility which escapes `&` `<` `>` `"` `'`. |

## QR code design

- **Encoding**: URL-safe base62 `ticket_code` (12 chars, e.g. `8K3F92-QW1XCD`) via `src/ids.ts` → QR version auto-selected to fit the payload.
- **No secrets in QR**: The QR only encodes the verification URL + code. The backend resolves the ticket status.
- **Verification flow**: Staff visits `/verify/<code>` or uses `/staff/scan` → POST with `{code}` → backend checks `tickets` table → atomically updates status if valid → writes to `scan_log` → returns admit/deny decision.

## Safe error handling

- 404 is returned for unknown ticket codes (no information leaked about whether the code exists).
- Generic "invalid ticket" messages for scanned codes that are redeemed, refunded, cancelled, or belong to a closed event.
- Stack traces never exposed to end users (Hono `onError` handler logs detail internally, returns generic response).
- Payment callback errors are logged internally; the HTTP response is `ResultCode: 0` or `1` only.

## Audit logging (sensitive actions)

Every sensitive operation writes to `audit_log`:
- Event publishing/cancellation/pausing
- Pricing term changes
- Refund initiation and completion
- Ticket category creation/modification
- Admin user actions

Each entry: `actor_user, action, entity, entity_id, detail (JSON), created_at`.

## Dependency checks

- No external QR code generation library is used — the encoder is hand-written (verified against ISO/IEC 18004 tables) with zero runtime dependencies.
- All money calculations use integer minor units (`src/money.ts`); no floating point anywhere near monetary values.