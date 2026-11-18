# MnM Digital Ecosystem — Current Release Status

**Status:** Authoritative summary of the repository and local verification
**Date:** 18 November 2026
**Supersedes:** point-in-time status statements in the phase/audit reports listed in section 8

This document records what has actually been run and observed. Earlier phase
reports (`MNM_PHASE_*`, `MNM_P0_*`, `MNM_P1_*`, `MNM_PHASE_2A*`) are historical
records of the runs they describe; their test counts belong to those runs and
are not restated here as current.

## 1. Repository state

| Item | Value |
|---|---|
| Repository | `AD-Group-Africa/MnM-JuiceBar-Tigoni` |
| Branch | `main` |
| Recovery commits | `6d09810` (payment-disabled mode, Render bind default), `9019f03` (regenerated menu illustrations) |
| Pushed from | `c4c74a5` → fast-forward, no force push, no history rewrite, no remote divergence |
| Remote `main` after push | `9019f033a96e980e5a062dfae9a9e8c400862c0a` |
| Working tree | No modified tracked files; optional untracked artifacts only (section 7) |

## 2. Payment mode

Producing tickets requires a payment provider. Until the owner separately
authorises live payment activation, production runs with:

```text
PAYMENT_PROVIDER=disabled
```

Behaviour in this mode, verified by `tests/payment-disabled.test.ts` and
`tests/config.test.ts`:

- The server starts in `NODE_ENV=production` with no payment credentials.
- Ticket checkout returns **HTTP 503** before any order, reservation or payment
  row is written.
- Event pages state that ticket sales are unavailable and render no checkout
  form; event information still displays.
- No payment confirmation, simulated success or ticket is ever produced.
- The Daraja callback route returns 404 for non-Daraja providers, so a callback
  cannot create a payment confirmation while payments are disabled.
- Juice ordering is unaffected: it remains pay-on-collection/delivery and does
  not use the ticket payment provider.

`PAYMENT_DEV_FORCE_STATUS` is a development-simulator control; it is rejected
in production and must stay empty there.

## 3. Verification performed (18 November 2026)

Commands run in the repository root, in this order, on the committed tree:

| Check | Command | Result |
|---|---|---|
| Full suite | `npm test` | 109 tests, 109 pass, 0 fail, 0 skipped (exit 0) |
| Route/HTTP regressions | `node scripts/run-phase2a1-regressions.mjs` | 39 pass, exit 0 |
| Type check | `npm run typecheck` | exit 0 |
| Production build | `npm run build` | exit 0 |
| Dependency audit | `npm audit` | 0 vulnerabilities (after section 5 upgrades) |
| Production startup | `node dist/server.js` with the disabled profile on a fresh database | bound `0.0.0.0:8792`, log `env=production, payments=disabled` |
| Public routes | `GET /health`, `/`, `/menu`, `/events` | all HTTP 200 |
| Fresh database | startup auto-applied migrations `0001`–`0009` | applied cleanly |

Suite composition (files in `tests/`): `money` 8, `orders` 16,
`juice-storefront` 39, `integration.http` 9, `config` 10, `tickets` 6, `qr` 6,
`account` 4, `phase2a-regressions` 5, `payment-disabled` 6.

Behaviour covered by those tests: commission/rounding, order lifecycle, ticket
capacity and concurrency guards, sale windows, refunds and cancellation
queues, Daraja callback amount/currency/idempotency handling, QR issuance and
duplicate redemption, guest order access tokens, customer accounts and session
handling, delivery minimums, origin checks on state-changing requests, and
production configuration guards.

Additional scripted end-to-end run (`node scripts/verify-demo.mjs` against a
development server with the labelled dev simulator, seeded demo database):
**33/33 checks passed**, covering all public pages, staff login and cookie
flags, pickup and delivery orders with server-side repricing and delivery
minimums, the order status machine including refused invalid jumps, role
restrictions for sales/scanner/anonymous, ticket purchase, QR ticket issue,
first-scan admit, duplicate-scan refusal and scan history.

**Payment-disabled production checks, run directly against `dist/server.js`:**
`POST /checkout` returns 503 with `orders`, `payments` and `tickets` all at 0;
an event page returns 200 with the text "Online ticket sales are temporarily
unavailable." and zero forms; a juice pickup order in the same disabled
configuration is created and its confirmation renders "Awaiting collection"
(13 juice orders present from the demo seed, 0 ticket orders).

**Migration compatibility:** a fresh database applied migrations `0001`–`0009`;
an immediate re-run applied 0 (idempotent); a copy of a pre-`0008` database
applied `0008` and `0009` forward with 27 tables intact.

**Not performed:** real-device camera/QR scanning, load or soak testing,
penetration testing, accessibility audit, multi-instance testing, and any
Render-side verification (section 4).

## 4. Render deployment status — blocked

No Render service URL, dashboard session, API key, `render.yaml`, deployment
record or environment export was available from the working environment, and no
Render CLI is installed. The automatic deployment triggered by this push could
therefore **not** be monitored, and the deployed commit cannot be confirmed.

- **Implemented but not externally verified:** payment-disabled startup, bind
  host, health endpoint, migrations, static assets.
- **Blocked by owner-controlled access:** deployed commit, service env names,
  disk mount, database path, logs and restart persistence.
- **Not performed:** any Render deployment action by the agent.

The exact configuration to apply is in `docs/RENDER_DEPLOYMENT_RECOVERY.md`.

## 5. Dependency findings and remediation

Two moderate advisories were reported against direct dependencies. Both had
non-breaking fixes within the existing major versions, so both were applied and
the full suite re-run afterwards.

| Package | Before | Advisory paths | Fix applied |
|---|---|---|---|
| `hono` | 4.13.13 | GHSA-4m76-xfj5-7975 (mount path bypass), GHSA-h7mg-cq63-vhpq (RegExpRouter wildcard skip), GHSA-3gg2-335m-rxc6 (css helper tag injection), GHSA-46wx-v44x-9hh2 (`csrf()` and `text/ping`), GHSA-4h7h-rv7c-7m2v (`validator('form')` multipart skip) | 4.13.19 |
| `@hono/node-server` | 2.1.5 | GHSA-qv5m-9pm6-hqp3 (ECONNRESET during WebSocket upgrade crashes process), GHSA-jpvv-r467-5p4w (backslash path separators bypass proxy path rules) | 2.1.9 |

Relevant to this app: the proxy path-separator and `csrf()` advisories touch
patterns this codebase relies on (origin checks, path-routed pages), so the
upgrade is treated as a production-relevant fix rather than housekeeping.
`npm audit` now reports 0 vulnerabilities.

## 6. Security posture (unchanged by the recovery)

Verified controls: scrypt password hashing, hashed session tokens with
`HttpOnly`/`SameSite=Lax`/`Secure`-in-production cookies, server-side role
checks on every staff route, origin allow-list on state-changing requests,
parameterised SQL, JSX auto-escaping, CSP/HSTS/`X-Content-Type-Options`, and
callback verification through the provider query rather than trusting the
request body.

Open risks, unchanged and not fixed here: **no rate limiting**, **no MFA for
staff**, single SQLite instance with no configured backup/monitoring. These are
launch-hardening items, not regressions.

## 7. Repository cleanup status

- `.freebuff/` is now ignored (local runtime and evidence artifacts, 4.4 MB).
  The pre-existing tracked `.freebuff/project-id` remains tracked.
- Menu illustrations in `public/menu/` were regenerated to 800×800 text-free
  SVGs and committed with their generator `scripts/generate-menu-art.mjs`.
- Historical phase/audit reports, commercial drafts and demo screenshots remain
  untracked on purpose: they describe past runs, quote counts from those runs,
  or reference local evidence that is not in the repository. They are working
  artifacts for the owner, not release documentation.
- Release-essential documents are the tracked `docs/` set linked from
  `README.md`, plus `RENDER_DEPLOYMENT_RECOVERY.md`, `RELEASE_STATUS.md`,
  `MNM_FINAL_HANDOVER_REPORT.md`, `MNM_DEPLOYMENT_READINESS.md`,
  `MNM_MANUAL_INTEGRATION_REGISTER.md`, `MNM_SECURITY_ASSESSMENT.md` and the
  `docs/commercial/` set.

## 8. Document classification

| Class | Documents |
|---|---|
| Current status | this file, `RENDER_DEPLOYMENT_RECOVERY.md`, `MNM_DEPLOYMENT_READINESS.md` |
| Handover and operations | `MNM_FINAL_HANDOVER_REPORT.md`, `commercial/07_TECHNICAL_HANDOVER_AND_OPERATIONS_MANUAL.md` |
| Security and integration | `MNM_SECURITY_ASSESSMENT.md`, `MNM_MANUAL_INTEGRATION_REGISTER.md`, `MNM_PAYMENT_ARCHITECTURE.md`, `MNM_DARAJA_SANDBOX_READINESS.md` |
| Commercial (proposals, not agreements) | `commercial/01`–`06` drafts, `commercial/08_IP_DATA_OWNERSHIP_AND_RETENTION.md` |
| Historical run records (may quote superseded counts) | `MNM_PHASE_*`, `MNM_P0_*`, `MNM_P1_*`, `MNM_PHASE_2A*`, `MNM_COMPLETION_*`, `MNM_TECHNICAL_AUDIT.md`, `MNM_EXECUTIVE_STATUS_REPORT.md` |
| Demo/owner communication drafts | `OWNER-*`, `MNM_OWNER_*`, `DEMO-VERIFICATION.md`, `OWNER-PRESENTATION.html` |

## 9. Remaining owner actions

1. Provide the Render service URL, or a read-only account/API key, so the
   deployment, disk mount, `DATABASE_FILE` and logs can be verified.
2. Confirm whether customer, order, event or ticket data already exists on the
   Render disk, and back it up before any path change.
3. Set the production environment described in `RENDER_DEPLOYMENT_RECOVERY.md`.
4. Approve rate limiting, MFA, backup/monitoring and a database backup policy
   before live sales.
5. Approve live integrations (M-Pesa, cards, eTIMS, SMS, WhatsApp, banking,
   DNS) individually; none are activated by this work.
6. Review the commercial drafts and replace `[TO BE AGREED]` fields before any
   is treated as an agreement.
