# Production Persistence Runbook — MnM Juice Bar / MnM Tickets

**Date:** 18 November 2026
**Applies to:** the Render service `mnm-juicebar-tigoni` and any host running this repository in production.

This document records how the production database lives and dies, what is lost
today, and the exact safe procedure for moving it to persistent storage. It is
written to be followed by a non-developer with terminal access.

---

## 1. How the database actually works

| Concern | Implementation |
|---|---|
| Engine | SQLite via Node's built-in `node:sqlite` (no server, no native addon) |
| Default path | `data/mnm-dev.sqlite` (relative to the process working directory) |
| Configured path | `DATABASE_FILE` environment variable |
| Journal mode | `WAL` with `busy_timeout=8000`, foreign keys ON |
| Schema | 9 forward-only migrations in `db/migrations/`, applied at boot and by `npm run migrate` |
| Migration record | `schema_migrations` table; a migration runs once, inside a transaction |
| Shutdown | `SIGINT`/`SIGTERM` closes the listener, checkpoints the WAL and closes the handle (3s hard limit) |
| Seed data | Migrations 0003/0006/0007 insert the 14-product catalogue and site settings; `db/seed.ts` creates development staff/events and refuses to run with `NODE_ENV=production` |
| Backup | `npm run db:backup` → verified `VACUUM INTO` snapshot + JSON manifest |
| Restore | `npm run db:restore -- --backup <file> --target <db> --yes` |

Startup order is: load and validate config → assess storage → migrate → reconcile
sold counts → listen. A failed migration aborts the boot; it never leaves a
half-applied schema because each migration is transactional.

## 2. Data-loss exposure — current production state

The Render service is on the **Free plan, with no persistent disk**. Render
recreates the application directory on every deploy and restart, and spins the
service down after idle. Therefore:

| Data | Lost on deploy / restart / spin-down? | Restored automatically? |
|---|---|---|
| Juice orders and order lines | **Yes** | No |
| Ticket orders, payments, issued tickets, reservations | **Yes** | No |
| Customer accounts and customer sessions | **Yes** | No |
| Staff accounts (`users`) | **Yes** | No — seed refuses to run in production |
| Staff sessions | **Yes** | No |
| Events and ticket categories | **Yes** | No — the live service currently has 0 events |
| Product catalogue (14 items) | Yes, then re-created by migrations 0003/0006/0007 | Yes |
| Site settings / branding | Yes, then re-created by migrations 0005/0007 | Yes (owner edits are lost) |
| Audit log | **Yes** | No |

**Consequence:** any customer who pays cash on collection, any ticket sold, any
staff account created and any owner setting changed is destroyed by the next
deploy or by Render idling the service. This is not a rendering or health-check
problem; it is a hosting-plan limitation. It must be resolved before the site
handles real orders.

The application now makes this state explicit at boot and at `/health`:

```
[storage] WARNING: database storage is "ephemeral-risk" (…/data/mnm-dev.sqlite).
  - DATABASE_FILE is a relative path inside the application directory.
  - DATABASE_FILE is the development default (data/mnm-dev.sqlite).
  - On a host without a mounted disk this file is discarded on deploy, restart or idle spin-down.
```

Startup options:

| Variable | Effect |
|---|---|
| `DATABASE_FILE` | Database path. Must be an absolute path inside the mounted disk in production. |
| `DATABASE_PERSISTENT_ROOT` | Root that counts as persistent. Default `/var/data` (Render disk mount). |
| `DATABASE_REQUIRE_PERSISTENT=1` | Turns the warning into a boot failure. Use only once the disk is mounted and `DATABASE_FILE` points into it. |

`GET /health` reports the mode without exposing the path:

```json
{"ok":true,"service":"mnm-tickets","database":"ok",
 "storage":{"mode":"ephemeral-risk","persistent":false,"strict":false,"sizeBytes":0}}
```

## 3. Moving to persistent storage (owner action)

Do not change `DATABASE_FILE` until step 2 has produced a verified backup.

1. **Upgrade the Render service** from Free to a paid instance type that supports
   persistent disks (Starter or above). Free instances cannot mount a disk.
2. **Back up whatever exists now.** From a checkout with the production database
   (or via the Render shell once available):
   ```bash
   npm run db:backup -- --source /path/to/current.sqlite --out backups
   ```
   Record the printed byte size, integrity result and row counts. Copy the
   `.sqlite` and `.sqlite.json` files off the host.
3. **Add a disk** in Render → the service → Disks: mount path `/var/data`,
   size as agreed with the owner (1 GB is ample for this workload).
4. **Set `DATABASE_FILE=/var/data/mnm.sqlite`** in Render → Environment.
   Leave `DATABASE_PERSISTENT_ROOT=/var/data` (or unset; it defaults to that).
5. **Deploy.** Startup applies migrations to the new path and logs
   `storage=persistent-configured`.
6. **Restore pre-existing data if step 2 produced a backup:** stop the service,
   then run the restore command against `/var/data/mnm.sqlite` (section 5),
   then start the service.
7. **Verify.** `GET /health` must show `"persistent": true`. Place one real test
   juice order, restart the service from the Render dashboard, and confirm the
   order is still listed in `/staff` (or via its order link).
8. Only then consider `DATABASE_REQUIRE_PERSISTENT=1`.

If the service already has a disk mounted elsewhere, point `DATABASE_FILE`
inside that mount instead of adding another disk. Never point it at a new empty
file while an existing database holds orders, tickets or accounts.

## 4. Backup procedure

```bash
# default source: $DATABASE_FILE or data/mnm-dev.sqlite
npm run db:backup

# explicit
npm run db:backup -- --source /var/data/mnm.sqlite --out backups
```

The command:

1. opens the live database read/write (busy timeout 8s),
2. runs `VACUUM INTO 'backups/mnm-YYYYMMDD-HHMMSS.sqlite'` — a consistent
   single-file snapshot that includes committed WAL frames,
3. opens the snapshot read-only and requires `PRAGMA integrity_check = ok`,
4. records row counts for orders, payments, tickets, juice orders, customers,
   users, events, products and the audit log in a `.json` manifest,
5. exits non-zero on any failure and never overwrites an existing backup.

`backups/` is gitignored. Copy each snapshot off the host (owner-controlled
storage). **No scheduled backup exists yet** — that is an outstanding owner
decision (Render cron job or an external scheduled task). Until then, run this
before every deploy that matters and at the end of each trading day.

## 5. Restore procedure

```bash
# 1. Stop the service (Render dashboard → Suspend, or stop the process locally).
# 2. Verify and restore:
npm run db:restore -- \
  --backup backups/mnm-20261118-143000.sqlite \
  --target /var/data/mnm.sqlite \
  --yes
# 3. Start the service and check /health.
```

The restore command refuses to run without `--yes`, refuses a backup that fails
`integrity_check` or whose row counts disagree with its manifest, copies the
current target to `backups/pre-restore-<timestamp>.sqlite` first, and removes
stale `-wal`/`-shm` sidecars after the swap.

## 6. Rollback

| Scenario | Action |
|---|---|
| Bad application deploy, database unchanged | Redeploy the previous Render deploy (dashboard → Deploys → previous → Redeploy). SQLite schema is forward-only and already migrated. |
| Bad data change | Restore the most recent verified backup (section 5). |
| Migration fails at boot | The migration transaction rolls back and the service exits. Fix forward with a new migration; do not delete `schema_migrations` rows or edit applied SQL. |
| Need to undo a migration | No down-migrations exist. Write a new forward migration that reverses the change. |

Never restore an older database *after* a newer schema migration has run unless
the backup itself predates that migration; SQLite tolerates extra tables but the
application expects the current schema. Restore a database backup taken at the
same or a newer schema version, then let `migrate` advance it.

## 7. Current verification status

| Claim | Status | Evidence |
|---|---|---|
| Startup detects ephemeral production storage and warns | Verified locally | `tests/persistence.test.ts`; boot log |
| Strict mode refuses to boot on ephemeral storage | Verified locally | `tests/persistence.test.ts` |
| Committed rows survive close/reopen of the database | Verified locally | `tests/persistence.test.ts` |
| Backup produces a verified, restorable snapshot | Verified locally | `tests/persistence.test.ts` (backup → restore → row present) |
| Restore refuses missing `--yes` and bad backups | Verified locally | `tests/persistence.test.ts` |
| Data survives a **Render restart on a mounted disk** | **Not verified** | Requires the owner to upgrade the plan and mount `/var/data` |
| Scheduled off-host backups | **Not implemented** | Owner decision |
