# MnM Tickets

Digital ticket vending & authorised event-resale platform. **Operated by MnM Juice Bar** (Kabuku, Limuru, Kenya) — platform by **Afrika Digitalis (AD Group)**.

Mobile-first, server-rendered, lean stack (7 npm packages). Node 24 · TypeScript · Hono · node:sqlite · node:test.

## Quick start

```bash
npm install           # ~30 MB
npm run migrate       # apply db/migrations
npm run seed          # development demo data (refuses to run in production)
npm run dev           # http://localhost:8787
npm test              # unit + integration suites (node:test)
npm run typecheck     # tsc --noEmit
```

Dev seed logins (development only; see `db/seed.ts`, never enabled in production): owner/manager/staff/scanner/ad_admin accounts printed by the seed script.

## Where things live

- `src/` — application (see `docs/ARCHITECTURE.md` for the module map)
- `db/migrations/` — versioned SQL schema
- `docs/` — product, pricing, payments, security, deployment, test report, pilot readiness
- `.env.example` — configuration contract (never commit `.env`)

## Status snapshot

Detailed status lives in `docs/TEST_REPORT.md` and `docs/PILOT_READINESS.md`. Live M-Pesa payments are **BLOCKED** pending owner-confirmed merchant arrangements and Daraja credentials; everything else runs locally end-to-end with a clearly-labelled payment simulator.
