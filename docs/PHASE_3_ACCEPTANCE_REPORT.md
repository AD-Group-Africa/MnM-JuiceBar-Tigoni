# Phase 3 Acceptance Report — Production Persistence, Security and Client Readiness

**Date:** 18 November 2026
**Branch:** `main`
**Production:** `https://mnm-juicebar-tigoni.onrender.com`
**Payment mode:** `disabled` (unchanged; ticket sales fail closed)

Status vocabulary used below: **Verified working**, **Implemented, not externally
verified**, **Blocked (owner-controlled)**, **Not implemented**, **Failed**.

---

## 1. Changes made

### 1.1 Production data protection

| Change | Files |
|---|---|
| Boot-time classification of the database location (`persistent-configured`, `ephemeral-risk`, `unverified`, `development`), loud warning with the consequence spelled out, optional fatal mode via `DATABASE_REQUIRE_PERSISTENT=1` | `src/persistence.ts`, `src/server.ts`, `.env.example` |
| `/health` now returns `database` (`ok`/`error`, 503 when unreadable) and a path-free `storage` object | `src/routes/public.tsx` |
| Graceful shutdown checkpoints the WAL and closes the handle before exit | `src/db.ts` (`closeDb`), `src/server.ts` |
| Verified backup: `VACUUM INTO` + `integrity_check` + row-count manifest, never overwrites | `scripts/db-backup.mjs` |
| Guarded restore: integrity + manifest check, safety copy of the current database, `--yes` required, sidecar cleanup | `scripts/db-restore.mjs` |
| npm commands `db:backup`, `db:restore`; `backups/` gitignored | `package.json`, `.gitignore` |
| Lifecycle audit, data-loss matrix, migration/backup/restore/rollback runbook | `docs/PRODUCTION_PERSISTENCE_RUNBOOK.md` |

### 1.2 Deployment discipline

- Documented the real Render build/start commands against the recommendation and
  the consequence of each difference (`docs/DEPLOYMENT.md`, section "Render
  configuration (actual)").
- No Render environment variable, secret, disk path, plan or payment setting was
  changed in this phase.
- Graceful shutdown already existed; it now also closes the database cleanly.

### 1.3 Security

| Control | Change |
|---|---|
| Rate limiting | Shared fixed-window limiter (`src/ratelimit.ts`): staff login per phone **and** per IP, customer login (10/10 min), customer register (10/h), ticket checkout (30/10 min), juice checkout (60/10 min), order lookup (20/10 min); HTTP 429 + `Retry-After` |
| Headers | `X-Frame-Options: DENY`, COOP `same-origin`, `Permissions-Policy` (camera limited to self for the scanner), CSP gains `base-uri`, `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'` |
| Audit | `src/audit.ts`; staff login success/failure/logout and rate-limit blocks recorded with a pseudonymised IP; customer login recorded. No phone numbers, emails, passwords or tokens stored |
| Existing controls re-verified | scrypt passwords, hashed session tokens, 12 h TTL, `HttpOnly`/`SameSite=Lax`/`Secure` cookies, exact Origin/Referer CSRF checks on every mutation, server-side role checks, fail-closed payments |

### 1.4 Commercial readiness

New operating documents: `docs/commercial/09_JUICE_ORDER_FULFILMENT_AND_COLLECTION.md`,
`10_EVENT_AND_TICKET_ADMINISTRATION.md`, `11_REFUNDS_AND_CANCELLATIONS.md`,
`12_STAFF_OPERATIONS.md`, `13_CUSTOMER_SUPPORT.md`,
`14_INCIDENT_HANDLING.md`, `15_TECHNOLOGY_AND_ASSET_OWNERSHIP.md`.
No prices, agreements, registrations or traction were invented; unagreed items
are marked `[TO BE AGREED]` / owner-supplied.

## 2. Commit hashes

| Commit | Content |
|---|---|
| `e2b003a` | Phase 3 implementation: persistence guard, backup/restore, rate limiting, headers, audit, tests, runbook and commercial docs (29 files, +1861/−14) |
| Previous production commit | `cb9aa3e` (verified live before this phase) |

Pushed to `origin/main` as a fast-forward. No force push, no history rewrite.

## 3. Test evidence

Run on the committed Phase 3 tree, repository root:

| Check | Command | Result |
|---|---|---|
| Full suite | `npm test` | **124 tests, 124 pass, 0 fail** (exit 0) |
| Phase 2A.1 regressions | `node scripts/run-phase2a1-regressions.mjs` | **fail 0** (exit 0) |
| Type check | `npm run typecheck` | exit 0 |
| Production build | `npm run build` | exit 0 |
| Dependency audit | `npm audit --omit=dev` | 0 vulnerabilities |

New tests:

- `tests/persistence.test.ts` — development vs production classification; default
  path and temporary directory flagged ephemeral; `/var/data` confirmed persistent;
  absolute path outside the root reported `unverified`; strict mode throws; non-strict
  warns; **rows survive closing and reopening the database**; **backup → restore
  round-trip preserves the row**; restore refuses without `--yes`.
- `tests/security.test.ts` — framing/CSP/Permissions-Policy/HSTS headers; `/health`
  reports `database: ok` and a path-free storage mode; fixed-window limiter
  allow/block/reset; order lookup returns 429 with `Retry-After`; foreign origin
  still rejected.

Not performed (no hardware or credentials): QR scanning on a physical phone
camera, M-Pesa sandbox calls, SMS/email delivery.

## 4. Production deployment evidence

| Item | Value |
|---|---|
| Deployed commit | `e2b003a` |
| Trigger | Push to `main` (Render auto-deploy) |
| `GET /health` | 200 `{"ok":true,"database":"ok","storage":{"mode":"ephemeral-risk","persistent":false,"strict":false,"sizeBytes":323584}}` |
| Security headers on the live origin | `x-frame-options: DENY`, `cross-origin-opener-policy: same-origin`, `permissions-policy: camera=(self), …`, CSP with `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`, `x-content-type-options: nosniff`, HSTS |
| Routes | `/`, `/menu`, `/events`, `/cart`, `/about`, `/catering`, `/contact`, `/tickets`, `/staff/login`, `/juice-health` → 200; `/juice` → 301 |
| Ticket checkout | `POST /checkout` → **503**, "No order was created and no payment was taken" |
| Event pages | `/events` renders **0** checkout forms |
| Juice order | Created `MNM-J-1351000001`; tokenised order page **200**; same URL without token **403** |

The live rate limit was not exercised deliberately: sending 31+ checkout requests
from one address would consume the budget and could block a real customer for ten
minutes. It is covered by automated tests instead.

## 5. Data persistence evidence

**Verified working**

- The database file survives closing and reopening the handle (WAL checkpoint
  path used at shutdown).
- A verified backup can be restored and still contains its rows.
- Backup and restore refuse unsafe operations (overwrite, missing `--yes`, failed
  integrity/manifest checks).
- The live service correctly self-reports its storage as `ephemeral-risk`.

**Blocked (owner-controlled) — not verified**

- Data surviving a **Render restart or deploy on a mounted disk**. The Free plan
  cannot mount a disk and has no shell, so `DATABASE_FILE` cannot be moved to
  `/var/data` and no restart test can be run without destroying data.
- Therefore the Phase 3 requirement "verify persistence across restart and
  deployment" is **not met on the live service**. It is implemented and locally
  tested, but not deployable until the plan/disk change.

Current live exposure is unchanged and now explicit: orders, tickets, customer and
staff accounts, audit entries and owner settings are discarded on the next deploy,
restart or idle spin-down. The product catalogue and default settings are recreated
by migrations.

## 6. Security findings

| Finding | Severity | Status |
|---|---|---|
| Production database is ephemeral; records are lost on deploy/restart | **Critical (data integrity)** | Detected and reported; fix blocked on paid disk |
| No staff MFA | Medium | Not implemented; compensating controls documented (scrypt, 12 h sessions, throttling, role checks, audit) |
| Rate-limit counters are in-process | Low | Acceptable single instance; must move to shared storage before scaling out |
| Login throttle resets on restart | Low | Documented |
| No scheduled/off-host backups | Medium | Tooling provided; schedule is an owner decision |
| No password reset / forced first-login change / session revocation UI | Medium | Owner/operator process today |
| CSP still allows inline script/style | Low | Existing templates rely on inline cart script and styles; nonce migration not attempted |
| No external uptime monitoring or alerting | Medium | Not implemented |
| Audit log records authentication and financial actions, not every staff read | Low | Deliberate: avoids storing browsing/PII noise |

No credentials were printed, committed or rotated in this phase. `APP_SECRET_KEY`
and the Render environment were left untouched.

## 7. Outstanding risks

1. **Data loss is the top risk.** Until the service has a persistent disk, every
   real order and ticket is temporary. This blocks any live commercial use.
2. The live build command does not compile TypeScript, so a type error would only
   surface at runtime rather than failing the deploy.
3. `npm install` instead of `npm ci` allows drift from the lockfile.
4. Single-instance architecture: SQLite, in-memory rate limits and in-memory
   reservations reconciliation assume one process.
5. No MFA on accounts that can issue refunds and change prices/settings.
6. No monitoring/alerting or scheduled backups.
7. Ticket sales remain unavailable (by design) until a payment integration is
   approved and fully verified.

## 8. Owner actions required

1. **Upgrade the Render instance** to a plan supporting a persistent disk, mount
   it at `/var/data`, set `DATABASE_FILE=/var/data/mnm.sqlite`, and verify
   `/health` shows `"persistent": true` plus a restart retaining a test order.
   Do this only after taking a backup of whatever exists.
2. **Decide the backup policy**: who runs `npm run db:backup`, how often, and where
   off-host copies live. A Render cron job or external scheduler is recommended.
3. **Approve or reject MFA** for manager/owner accounts; if rejected, record the
   accepted residual risk.
4. **Change the Render build/start commands** to `npm ci --include=dev && npm run build`
   and `npm start` so a broken build cannot deploy.
5. **Provide real staff accounts** (no development seed in production) and remove
   any shared credentials.
6. **Approve monitoring/alerting** (uptime check on `/health`, log alerts).
7. **Decide the refund policy and authority matrix** — the software records
   refunds but moves no money.
8. **Review the commercial drafts and ownership split** (`09`–`15`); nothing is an
   agreement until signed.
9. **Keep payments disabled** until Daraja credentials, callback verification and
   an end-to-end sandbox test are separately approved.

## 9. Conclusion

Phase 3 delivered the persistence safeguards, backup/restore tooling, request
hardening, audit entries and operating documentation, and deployed them to the
live service with all checks passing. It did **not** make the live database
durable: that requires a hosting-plan change only the owner can authorize, and the
restart-persistence criterion therefore remains open. MnM is not declared fully
production-ready.
