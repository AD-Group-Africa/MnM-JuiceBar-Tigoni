# Project checklist

Legend: [x] done · [~] implemented but externally blocked or partial · [ ] pending

## Phase 0 — Discovery & foundation
- [x] Environment inspection (Windows, Node 24, 458 MB free disk; no Postgres/Docker → lean stack)
- [x] Public research of MnM brand (verified: slogan #MAGICINEVERYTASTE, "Crafted in Tigoni", phone; unverifiable: logo/colours/menu)
- [x] Stack decision + architecture + data model docs
- [x] Git repo, .env.example, migrations 0001, typecheck green, initial commit

## Phase 1 — Design & core application
- [ ] Design system CSS + responsive layout shell
- [ ] Migrations + seed data + seed logins
- [ ] Session auth + role guards (server-side)
- [ ] Event & inventory management (staff)
- [ ] Storefront: home/events/event page
- [ ] Unit + integration tests for the above

## Phase 2 — Commerce
- [ ] Checkout: order lifecycle, reservations, oversell protection
- [ ] Commission engine wired into orders (snapshots)
- [ ] Payment abstraction: dev simulator + Daraja structure
- [ ] Callback validation, idempotency, failure/timeout/expiry paths

## Phase 3 — Ticketing
- [ ] Ticket issuance after confirmed payment only
- [ ] QR codes (encoded via public verification URL; no PII)
- [ ] Staff scanning console with online validation + audit
- [ ] Guest ticket retrieval via signed links

## Phase 4 — Operations
- [ ] MnM dashboard (orders, revenue, commissions, exports)
- [ ] AD admin console (health, audit, cross-event)
- [ ] Notifications (console adapter; SMS/email providers configurable)

## Phase 5 — Verification & launch prep
- [ ] Full test suite + production build
- [ ] Security review + docs
- [ ] Pilot-readiness assessment + owner decisions list

# Outstanding owner/business decisions
1. Confirm the 35/25/10 commercial interpretation before live sales.
2. Authorisation evidence per real event (organiser permission records).
3. Approved settlement arrangement for funds flow (this platform records, it does not auto-split).
4. Legal/tax/consumer/data-protection review by qualified Kenyan advisers (not certified by us).
5. M-Pesa merchant (Paybill/Till) + Daraja account + public HTTPS callback host.
6. Final product name "MnM Tickets" confirmation + real logo/colours.
