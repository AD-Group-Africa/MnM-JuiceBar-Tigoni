# Render Deployment Recovery — Payment-Disabled Mode

**Status:** Configuration and code prepared; not deployed  
**Date:** 18 November 2026  
**Commit base:** `c4c74a567afa156d66b7db866fef9c83fda534f7`

## 1. Why Render could fail to start

The production configuration contract was stricter than the available integrations:

- `PAYMENT_PROVIDER` is mandatory and previously accepted only `dev` or `daraja`.
- Production rejects `PAYMENT_PROVIDER=dev`.
- `PAYMENT_PROVIDER=daraja` requires all five M-Pesa credentials **and**
  `MPESA_ENV=production`, even if live payments were not approved.
- There was no way to run the public storefront in production with online
  payments deliberately switched off.

A second startup/health risk was the bind address. Development defaulted to
`127.0.0.1`. Render routes traffic to the container's external interface, so a
process bound only to loopback is unreachable even when it starts successfully.

The exact Render build/start logs and environment variables were not available
in this workspace. No service URL, Render API key, dashboard session,
`render.yaml` or deployment record was present. The conclusions below are based
on the committed application contract and local production-mode reproduction.

## 2. New mode: `PAYMENT_PROVIDER=disabled`

`disabled` is an explicit, production-safe setting:

- Startup succeeds without M-Pesa credentials.
- No payment provider is contacted.
- `POST /checkout` returns **503** before creating an order, reservation or
  payment row.
- Public event pages state that online ticket sales are unavailable and do not
  render the ticket checkout form.
- `POST /pay/notify/daraja` returns **404**; it cannot settle anything.
- No ticket is issued and no payment is reported as successful.
- Juice ordering still works; juice orders are pay-on-collection/delivery and do
  not use the ticket payment provider.
- Staff, customer accounts, order access, refunds and scanning remain available
  for existing data.

`disabled` does **not** mean "cash recorded as paid". There is no manual
"mark paid" shortcut in this mode.

## 3. Recommended Render environment

Set these in the Render dashboard (Environment tab). Values in angle brackets
are placeholders and must not be committed.

```text
NODE_ENV=production
BIND_HOST=0.0.0.0
PAYMENT_PROVIDER=disabled
PUBLIC_ORIGINS=https://<your-service>.onrender.com
APP_SECRET_KEY=<64 hex characters from a cryptographically secure generator>
DATABASE_FILE=/var/data/mnm.sqlite
```

Render supplies `PORT`; do not hard-code it. Leave all `MPESA_*` variables
unset while payments are disabled. Do not set `PAYMENT_DEV_FORCE_STATUS`.

Generate the secret locally and paste it only into Render:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep the same `APP_SECRET_KEY` across restarts. Rotating it invalidates staff
sessions and private order links.

## 4. Render service settings

| Setting | Value |
|---|---|
| Runtime | Node |
| Node version | `24` (the app requires Node >= 24 for `node:sqlite`) |
| Build command | `npm ci && npm run build` |
| Start command | `npm start` |
| Health check path | `/health` |
| Persistent disk mount | `/var/data` |
| Database path | `/var/data/mnm.sqlite` |

The app applies pending SQLite migrations at startup. The database directory is
created automatically. A persistent disk is required: without one, the SQLite
file is lost on every deploy or restart, and a multi-instance service must not
share one SQLite file.

If the service already has a disk mounted at another path, set
`DATABASE_FILE` to a file inside that mount instead of changing the mount.

## 5. Deploy sequence (manual approval required)

1. Back up the current Render disk/database, or confirm there is no data to
   preserve.
2. Set the environment variables in section 3.
3. Confirm `PUBLIC_ORIGINS` exactly matches the public HTTPS origin, with no
   trailing slash and no path.
4. Run a production build locally and confirm it passes:
   `npm ci && npm run build && npm test`.
5. Deploy the reviewed commit manually.
6. Inspect startup logs for:
   `[mnm-tickets] listening on http://0.0.0.0:<port> (env=production, payments=disabled)`
7. Open `https://<your-service>.onrender.com/health`; expect HTTP 200 with
   `{"ok":true,"service":"mnm-tickets",...}`.
8. Open `/events`; confirm the payment-disabled notice appears and no ticket
   checkout form is rendered.
9. Confirm `/menu` and juice checkout still render.
10. Do not activate M-Pesa, card, eTIMS, SMS, WhatsApp, banking or DNS changes as
    part of this recovery.

If `/health` works but state-changing forms return 403, `PUBLIC_ORIGINS` does
not match the browser origin. If the service starts but the health check cannot
connect, `BIND_HOST` is still loopback.

## 6. Switching payments on later

Only after written approval and live credentials are configured:

```text
PAYMENT_PROVIDER=daraja
MPESA_ENV=production
MPESA_SHORTCODE=<approved shortcode>
MPESA_CONSUMER_KEY=<approved key>
MPESA_CONSUMER_SECRET=<approved secret>
MPESA_PASSKEY=<approved passkey>
MPESA_CALLBACK_BASE=https://<your-service>.onrender.com
```

Production rejects `MPESA_ENV=sandbox`, missing credentials and non-HTTPS or
loopback callback bases. Do not switch these values as part of this recovery.

## 7. Evidence still required from Render

The following cannot be verified without account access:

- The deployed commit SHA and deploy timestamp.
- The current Render environment variable **names** (never values).
- Build and start logs from the failed deployment.
- The service URL, instance type, disk mount and health-check settings.
- Whether the Render service auto-deploys `main`.

Once those are supplied, compare them with sections 3 and 4. No deployment has
been performed by this change.

## 8. Current state of this recovery (18 November 2026)

Committed locally and pushed to `main` without force and without rewriting
history:

| Commit | Content |
|---|---|
| `6d09810` | `PAYMENT_PROVIDER=disabled`, production `BIND_HOST` default `0.0.0.0`, docs and tests |
| `9019f03` | Regenerated 800×800 menu illustrations and their generator |

Remote `main` after the push: `9019f033a96e980e5a062dfae9a9e8c400862c0a`
(fast-forward from `c4c74a5`).

Verified locally on the committed tree: `npm test` 109/109, regression runner
39/39, typecheck exit 0, build exit 0, and a production startup with the
disabled profile on a fresh database logging
`listening on http://0.0.0.0:8792 (env=production, payments=disabled)` with
`/health`, `/`, `/menu` and `/events` returning HTTP 200.

Still unverified: whether Render rebuilt, which commit is live, the service
environment variable names, the disk mount, `DATABASE_FILE`, the existing
database contents and restart persistence. No Render URL, dashboard session,
API key or `render.yaml` was available.

**Do not change `DATABASE_FILE`** until the current disk contents are inspected
and backed up. If a database already exists on the disk, point
`DATABASE_FILE` at that exact file; migrations run forward automatically at
boot and are the intended upgrade path. Never start the service against a new
empty path while an existing production database holds orders, tickets,
customers or payments.
