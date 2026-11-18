# MnM Digital Ecosystem — Technical Handover and Operations Manual

**Status:** Handover draft  
**Date:** 18 November 2026  
**Audience:** MnM owner/operations lead, AD Group support, authorised developers

## 1. System summary

The ecosystem is one Node.js 24 application:

- Hono HTTP server, server-rendered JSX.
- SQLite database via `node:sqlite`.
- Static assets in `public/`.
- Juice storefront at `/`, `/menu`, `/juice/*`.
- Ticketing at `/events`, `/tickets`, `/order/*`, `/staff/*`.
- Health endpoints: `/health`, `/juice-health`.

It is **not** stateless. The database file must live on a persistent disk.

## 2. Local setup

```bash
npm ci
cp .env.example .env
npm run migrate
npm run seed          # development only; refuses production
npm run seed:demo     # clearly labelled demo data
npm run dev
```

Open `http://127.0.0.1:8787`.

Production build:

```bash
npm run build
npm start
```

## 3. Environment variables

| Variable | Purpose | Production rule |
|---|---|---|
| `NODE_ENV` | Runtime mode | Must be `production` |
| `PORT` | HTTP port | Host may set it |
| `BIND_HOST` | Bind address | `0.0.0.0` on a hosted container |
| `DATABASE_FILE` | SQLite file | Must be on persistent disk |
| `APP_SECRET_KEY` | Session/guest/QR signing | Stable, high entropy, secret |
| `PUBLIC_ORIGINS` | Allowed state-change origins | Exact HTTPS origin |
| `PAYMENT_PROVIDER` | `dev`, `disabled` or `daraja` | `dev` refused in production; `disabled` is the safe production default until live payments are approved |
| `PAYMENT_DEV_FORCE_STATUS` | Dev simulator override | Empty in production |
| `MPESA_ENV` | `sandbox` or `production` | Must be `production` |
| `MPESA_*` | Daraja credentials | Required only for Daraja |
| `EMAIL_PROVIDER`, `SMS_PROVIDER` | Notification adapters | `console` until approved |

Never commit `.env`. Never paste secrets into chat, tickets or documentation.

## 4. Database and migrations

- Migrations are SQL files in `db/migrations/`, applied in filename order at boot.
- Current migrations: `0001` through `0009`.
- Migration `0008` adds the hashed juice order access token; `0009` adds optional customer accounts and order links.
- Take a backup **before** deploying a build with new migrations.
- Test migration on a copy, never directly on production.
- SQLite WAL files (`-wal`, `-shm`) must be included in filesystem backups or the database must be checkpointed first.

## 5. Backup and restore

Recommended minimum:
1. Nightly filesystem snapshot of the disk containing `DATABASE_FILE`.
2. Encrypted off-host copy.
3. Weekly restore test into a staging database.
4. Record backup age and restore result.
5. Before any deploy: manual backup and checksum.

A backup that has never been restored is not verified.

## 6. Staff roles

| Role | Capabilities |
|---|---|
| `owner` | Manage, scan, reports |
| `manager` | Manage, scan, reports |
| `sales_staff` | Reports, scan |
| `scanner` | Scan only |
| `ad_admin` | Admin, manage, scan, reports |
| Customer (optional) | Phone + password account; sees only orders linked while signed in |

Create staff through the owner/admin process. Remove leavers immediately; sessions are server-side and can be destroyed. There is no MFA yet.

## 7. Juice operations

- Products: create/edit, price in KES, availability flag, category, image, sizes/add-ons.
- Orders: view queue, update status, assign staff, print receipt, export CSV.
- Delivery zones: name, fee, minimum order, enabled.
- Reviews: approve/reject with a note.
- Checkout: server reprices every line; client-submitted prices are ignored.
- Order page: requires the private token; reference + checkout phone can reissue a token.

## 8. Ticketing operations

- Create event as draft; record organiser authority reference.
- Publish only when authority is recorded; set sale window.
- Add ticket categories, prices, quantities and per-order limits.
- Sales reserve inventory; paid capacity is reconciled.
- Refund: start, then complete after the money movement is confirmed.
- Cancel event: voids tickets, releases holds, cancels unpaid orders and queues refunds. It does **not** move money.
- Scanning: valid ticket admits once; duplicate/invalid scans are rejected and logged.

## 9. Payment operations

### Development simulator
- `PAYMENT_PROVIDER=dev`.
- Prints a clearly labelled simulated STK line.
- Must never be presented as real money.

### Daraja
- `PAYMENT_PROVIDER=daraja`, `MPESA_ENV=production`.
- All five credentials required.
- Callback base must be public HTTPS.
- Callback is verified by STK query before settlement.
- Fractional-KES totals are refused; price in whole shillings.
- No live activation has been performed.

## 10. Incident runbook

1. Check `/health` and `/juice-health`.
2. Check process/logs and disk space.
3. Check database file and WAL permissions.
4. If payments are affected, stop new collection and preserve logs.
5. If data corruption is suspected, stop writes and restore from the last verified backup.
6. Record incident time, impact, actions and evidence.
7. Notify the owner and, where personal data is affected, follow the agreed breach process.
8. Do not delete logs or “fix” records manually without a written plan.

## 11. Deployment runbook

1. Owner approves the commit and window.
2. Backup database; verify restore.
3. Build and test the exact commit.
4. Deploy to staging; run smoke tests.
5. Confirm environment names/values and persistent disk.
6. Deploy production; run `/health`, home, menu, checkout, staff login and scan smoke tests.
7. Monitor logs, 5xx and reconciliation exceptions.
8. Record deploy time, commit and result.

## 12. Known limitations

- Single SQLite instance; no horizontal scaling.
- Customer accounts exist, but phone ownership is not OTP-verified and there is no password reset.
- No organiser portal.
- No stock quantity, only availability.
- No rate limiting/MFA/WAF.
- No live SMS/WhatsApp/email/eTIMS/card/banking.
- No formal accessibility/load/penetration test.
- Render deployment unverified.
- Owner content/prices/policies pending.

## 13. Handover checklist

- [ ] Repository access and branch protection agreed.
- [ ] Render/DNS/domain ownership transferred or shared.
- [ ] Environment variable names documented; values stored in the owner's secret manager.
- [ ] Database backup and restore demonstrated.
- [ ] Staff accounts and roles confirmed; demo accounts removed/disabled.
- [ ] Owner content/pricing/policies approved.
- [ ] Manual integration register reviewed.
- [ ] Support and escalation contacts exchanged.
- [ ] Final acceptance signed.
