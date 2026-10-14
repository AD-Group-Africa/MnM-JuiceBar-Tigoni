# Architecture — MnM Tickets

Built by Afrika Digitalis (AD Group) for MnM Juice Bar, Kabuku/Limuru. Product: authorised event-ticket vending and resale.

## Stack and why

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 24, TypeScript (strict, `noUncheckedIndexedAccess`) | available on the build machine; server and browser share a type discipline |
| HTTP | **Hono** (~40 kB, zero-dep fetch handler) | small, typed, JSX-capable server rendering; the whole install is 7 packages (~30 MB) |
| Storage | `node:sqlite` (built-in, WAL) in development | the build machine has no PostgreSQL and Docker daemon disabled; SQLite gives real transactions (BEGIN IMMEDIATE) with zero native deps. **Production target is PostgreSQL** — migrations are plain versioned SQL; port deltas are documented in docs/DATA_MODEL.md |
| Views | Hono JSX server-rendered pages + one small progressive JS file + handcrafted CSS design system | mobile-first, extremely fast on ordinary Kenyan Android phones; no SPA bundle, no framework lock-in |
| Tests | `node --import tsx --test` (built-in runner) | no heavy test framework; keeps the install tiny (build machine had only ~460 MB free) |
| Auth | Custom scrypt passwords + opaque session tokens (SHA-256 stored) + SameSite=Lax cookies + origin checks on mutations | no external auth dependency; least-privilege role checks server-side |

## Module map

```
src/
  server.ts        Hono app assembly, middleware, static assets, error handling
  config.ts        env validation (startup; throws on production misconfig)
  db.ts            node:sqlite layer, migrations, tx() helper (BEGIN IMMEDIATE)
  money.ts         COMMISSION ENGINE (single source of truth)
  auth.ts          scrypt passwords, sessions, signed guest tokens, role guards, origin check
  ids.ts           CSRF order tokens, random codes, order refs, ticket codes
  payments/
    index.ts       provider abstraction + initiation/callback/idempotent settle logic
    daraja.ts      Safaricom Daraja STK-push adapter (structure complete; live use BLOCKED)
    dev.ts         clearly-labelled development simulator
  notify.ts        notification interfaces + console dev adapter (records attempts)
  views/           JSX layout & page components (customer + staff)
  routes/          public.ts, checkout.ts, staff.ts, admin.ts, scan.ts
db/migrations/     versioned SQL (applied in filename order, transactionally)
db/seed.ts         development-only seed (guarded: refuses to run with NODE_ENV=production)
data/              runtime SQLite files (git-ignored)
```

## Request flows

**Purchase:** `POST /checkout` → create order (DRAFT→PENDING_PAYMENT) + reservation rows (expires in ~15 min) inside one `BEGIN IMMEDIATE` transaction with conditional sold-count guard → payment initiation (dev sim or Daraja STK) → provider callback → validate amount/currency/order → idempotent settlement (succeeded exactly once) → tickets issued == qty purchased (TICKET_ISSUED) → notifications queued (adapter-dependent).

**Scanning:** staff session → `POST /staff/scan` (origin-checked) → backend verifies ticket status, event date window, duplicate redemption → atomic `UPDATE tickets SET status='redeemed' WHERE id=? AND status='valid'` → every attempt written to `scan_log` with scanner id, timestamp, reason.

## Handbook contracts

- Errors are structured JSON `{error, code}`; stack traces no longer leak under production headers.
- Secrets only via env (.env in dev, secret store in prod). Never committed.
- `pricing_terms` changes are new rows; live orders never mutate.
- Inventory oversell is prevented by checking sold+active reservations against quantity inside the same immediate transaction that inserts the reservation.
