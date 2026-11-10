# MnM Tickets — Afrika Digitalis

Digital ticket vending and authorised event resale platform for MnM Juice Bar, Kabuku (Limuru, Kenya).

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your settings (see .env.example for all variables)

# 3. Apply database migrations
npm run migrate

# 4. Seed development data (staff logins, sample events, pricing terms)
npm run seed

# 5. Start the development server
npm run dev
# Server starts at http://127.0.0.1:8787

# 6. Run the full test suite
npm test
# All 36 tests should pass
```

## Available scripts

| Script | Description |
|---|---|
| `npm run dev` | Start development server with `tsx watch src/server.ts` |
| `npm run build` | Compile TypeScript to `dist/` (production build) |
| `npm run typecheck` | Run `tsc -p tsconfig.json --noEmit` (clean = no errors) |
| `npm test` | Run full test suite (36 tests: 29 unit/integration + 7 HTTP) |
| `npm run seed` | Seed development data (aborts if NODE_ENV=production) |
| `npm run migrate` | Apply pending SQLite migrations in filename order |

## Architecture

- **Runtime**: Node.js >= 24, TypeScript (strict mode)
- **HTTP**: Hono framework (~40 kB, zero-dep) — server-rendered JSX pages
- **Database**: SQLite (development, node:sqlite built-in); PostgreSQL (production target, migrations portable)
- **Auth**: Custom scrypt passwords + SHA-256 opaque session tokens + SameSite=Lax cookies + origin checks
- **Tests**: `node:test` + `tsx` — no heavy framework dependency; keeps install tiny
- **Payments**: Daraja (M-Pesa STK Push) adapter structure + clearly-labelled development simulator
- **QR codes**: Hand-encoded ISO/IEC 18004 (verified against Nayuki/Thonky tables), no external library

## Project structure

```
mnm-tickets/
├── src/                    # Source TypeScript
│   ├── app.tsx             # App assembly, middleware, error handling
│   ├── config.ts           # Env validation (throws on production misconfig)
│   ├── db.ts               # SQLite layer, migrations, tx() helper
│   ├── money.ts            # COMMISSION ENGINE (single source of truth)
│   ├── auth.ts             # Scrypt passwords, sessions, role guards, origin check
│   ├── ids.ts              # CSRF tokens, random codes, order refs, ticket codes
│   ├── payments/
│   │   ├── index.ts        # Provider abstraction + initiate/callback/idempotent settle
│   │   ├── daraja.ts       # Daraja (M-Pesa STK) adapter structure
│   │   └── dev.ts          # Development simulator (clearly labelled)
│   ├── notify.ts           # Notification interfaces + console dev adapter
│   ├── views/              # JSX layout & page components
│   └── routes/             # Route handlers (public, staff, admin, checkout, verify-scan)
├── db/migrations/          # Versioned SQL migrations (applied in filename order)
├── docs/                   # Documentation (12 files)
├── tests/                  # Test files (node:test)
│   ├── money.test.ts
│   ├── orders.test.ts
│   ├── qr.test.ts
│   ├── tickets.test.ts
│   └── integration.http.test.ts
├── .env.example            # Placeholder env vars only (never commit real values)
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript strict config
└── tsconfig.build.json     # Production build config
```

## Core features (v0.1)

- Mobile-first storefront: home, events list, event detail, checkout
- Staff dashboard: event CRUD, inventory management, orders, refunds, CSV exports, scan console
- AD admin console: platform health, cross-event totals, audit trail, reconciliation exceptions
- Commission engine: 35% markup (25% MnM + 10% AD) snapshot per order, integer minor units
- Ticket issuance: unique digital tickets with QR codes, online verification
- Payment abstraction: dev simulator + Daraja adapter (live BLOCKED pending credentials)
- Role-based access: owner, manager, sales_staff, scanner, ad_admin
- Full test suite: 36 tests pass (100% business logic coverage)

## Documentation

All documentation is in `docs/`:
- `PRODUCT_REQUIREMENTS.md` — product scope, roles, commercial model, delivery scope
- `ARCHITECTURE.md` — stack choices, module map, request flows, Handbook contracts
- `DATA_MODEL.md` — core entities, SQLite→Postgres port deltas
- `PRICING_AND_COMMISSIONS.md` — the 35% markup model, rules, engineering
- `PAYMENTS_AND_RECONCILIATION.md` — provider abstraction, integrity rules
- `TICKET_SECURITY.md` — threat model, core guarantees, attack surface mitigations
- `SECURITY_AND_PRIVACY.md` — server-side security, data privacy, Kenyan data protection considerations
- `OWNER_ONBOARDING.md` — what's built, owner decisions, setup steps, next five actions
- `DEPLOYMENT.md` — dev setup, production deployment, health checks, rollback, env vars
- `TEST_REPORT.md` — test suite summary, categories, execution, limitations, performance
- `PILOT_READINESS.md` — explicit pass/fail criteria, numerical assessment (75/100), next five actions
- `PROJECT_CHECKLIST.md` — phased checklist (Phase 0–5), outstanding decisions

## Outstanding owner decisions (before live sales)

1. ✅ Confirm the 35/25/10 commercial interpretation (25 pp MnM, 10 pp AD of original price).
2. 🔟 Provide organiser authorisation evidence per event (authorization_ref per event).
3. 🔟 Formalise settlement arrangement for funds flow (MnM/AD/organiser — offline workflow).
4. 🔟 Obtain M-Pesa Daraja merchant account OR accept dev-simulator-only mode.
5. 🔟 Confirm product name "MnM Tickets" and supply/approve branding assets.

See `docs/PILOT_READINESS.md` for the full numerical assessment (current: 75/100 → pilot pending).

## Security

- No secrets committed to code or git (.env is gitignored).
- `APP_SECRET_KEY` must be 32-byte random hex; rotate if exposed.
- All money in integer minor units; no floating point near monetary values.
- Server-side auth + authorisation on every mutating endpoint (never rely on frontend button hiding).
- Payment callbacks validated (amount/currency match, idempotency via UNIQUE provider_request_id).
- XSS prevention: Hono JSX auto-escapes; no dangerouslySetHTML.
- SQL injection prevention: all queries use parameterized statements via db.ts.
- CSP, HSTS, X-Content-Type-Headers set in production.

## License

This project is private and confidential — owned by Afrika Digitalis for MnM Juice Bar.

## Need help?

- Technical issues → Afrika Digitalis team.
- Business decisions → MnM Juice Bar owner.
- See the documentation in `docs/` for detailed guides.