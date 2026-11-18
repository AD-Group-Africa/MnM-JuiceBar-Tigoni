# MnM Digital Ecosystem — Deployment Readiness Assessment

**Status:** Locally buildable and runnable; not production-deployed or Render-verified  
**Date:** 18 November 2026

## 1. Local readiness

| Check | Result |
|---|---|
| `npm ci` / dependency install | Existing dependencies preserved; no new runtime dependency added |
| `npm run typecheck` | Pass (exit 0) |
| `npm run build` | Pass (exit 0) |
| `node dist/server.js` | Starts; `/health` 200 on isolated DB |
| Main tests | 109/109 pass |
| Former defect suite | 39/39 pass |
| Migrations | 9 migrations apply cleanly on a fresh DB |
| Static assets | `public/` served; home/menu render |
| Production guards | Dev simulator, Daraja sandbox, missing credentials, non-HTTPS callback refused |
| Live integrations | Not activated |

## 2. Required production configuration

| Variable | Requirement |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | Provided by the host (Render sets it) |
| `BIND_HOST` | `0.0.0.0` for a hosted container, unless the host overrides |
| `DATABASE_FILE` | Absolute path on a persistent disk, e.g. `/var/data/mnm.sqlite` |
| `APP_SECRET_KEY` | Stable 32+ byte random secret; never commit |
| `PUBLIC_ORIGINS` | Exact HTTPS public origin, comma-separated if multiple |
| `PAYMENT_PROVIDER` | `disabled` until live credentials are approved; `daraja` only with approved credentials; production rejects `dev` |
| `MPESA_ENV` | `production` in production; sandbox is refused |
| `MPESA_SHORTCODE`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_PASSKEY`, `MPESA_CALLBACK_BASE` | Required for Daraja; callback base must be public HTTPS |
| `EMAIL_PROVIDER`, `SMS_PROVIDER` | Leave `console` until live providers are approved |

## 3. Render-specific requirements

- **Service type:** Node Web Service (not a static site).
- **Build command:** `npm ci && npm run build`.
- **Start command:** `npm start` (`node dist/server.js`).
- **Health check:** `/health`.
- **Persistent disk:** required. Mount it and set `DATABASE_FILE` to a file on that disk. Without a disk, the SQLite database is lost on restart/deploy.
- **Instances:** one instance only. Do not scale multiple replicas against the same SQLite file.
- **Migrations:** run automatically on boot. Take a database backup **before** the first deploy containing migrations `0008` and `0009`.
- **Static assets:** served by the app from `public/`; no separate static-site configuration is required.
- **TLS:** Render provides HTTPS; set `PUBLIC_ORIGINS` to that origin.
- **Secrets:** set in the Render dashboard, never in `render.yaml` or the repository.

## 4. Render verification blocker

No verified Render service URL, dashboard access, API key, `render.yaml`, deployment record or environment export was available. The dashboard reached a login page; no authentication was attempted. Therefore:

- The deployed commit is **not verified**.
- Build/start commands on Render are **not verified**.
- Disk mount and `DATABASE_FILE` are **not verified**.
- The deployed schema/data version is **not verified**.
- DNS/TLS/custom domain state is **not verified**.

This is an external access blocker, not a passing deployment check.

As of 18 November 2026 the recovery commits `6d09810` and `9019f03` are
pushed to `main` (remote SHA `9019f033a96e980e5a062dfae9a9e8c400862c0a`).
The service may therefore have rebuilt automatically, but that build, its
environment and its database were still not observable from the working
environment. Do not treat the push as evidence of a successful deployment.

## 5. Pre-deploy checklist (requires owner approval)

1. Owner supplies Render service URL and read-only access/export.
2. Record current deployed commit and environment names.
3. Back up the Render database and verify the backup restores.
4. Confirm persistent disk and `DATABASE_FILE`.
5. Confirm `NODE_ENV`, `PUBLIC_ORIGINS`, `APP_SECRET_KEY` stability and payment provider.
6. Deploy the approved commit to a preview/staging environment first.
7. Run `/health`, `/juice-health`, home, menu, checkout (dev simulator or approved sandbox), staff login and scanner smoke tests.
8. Check response headers, asset content types, console/network errors.
9. Obtain written approval for production deployment.
10. Deploy, repeat smoke tests, and monitor logs/reconciliation exceptions.

## 6. Readiness verdict

**Local artifact: ready for controlled staging.**  
**Production: not ready to deploy without owner access, Render configuration verification, backups, rate limiting/MFA decisions and live-integration approvals.** No deployment was performed.
