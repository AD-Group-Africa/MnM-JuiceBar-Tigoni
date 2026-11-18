# Incident Handling — Runbook

**Audience:** owner, AD Group operator
**Scope:** production service at `https://mnm-juicebar-tigoni.onrender.com`

---

## 1. Severity

| Level | Example | Response target |
|---|---|---|
| S1 | Site down; checkout failing for all; data loss | Immediate; owner informed |
| S2 | One flow broken (scanner, order page); payments wrong | Same day |
| S3 | Cosmetic, single-customer issue, documentation error | Next working day |

## 2. Detect

- `/health` — `ok`, `database`, and `storage.mode`. A 503 means the database is
  unreadable; Render's health check will also restart a failing instance.
- Render dashboard → Logs — startup line:
  `[mnm-tickets] listening on … (env=production, payments=disabled, storage=…)`
  and any `[storage] WARNING`, `[error]`, `[security] rate limit hit`.
- Customer or staff report.

## 3. First response (10 minutes)

1. Confirm scope: is it the whole site, one route, or one customer? Try `/health`
   and the affected page.
2. Check the most recent deploy. Render → Deploys shows the commit and result.
3. **Do not** change `DATABASE_FILE`, delete the database, rotate `APP_SECRET_KEY`
   or enable payments as a troubleshooting step.
4. If a deploy caused it, redeploy the previous successful deploy.
5. Record: time, symptom, affected routes, last deploy, action taken.

## 4. Specific incidents

### 4.1 Site will not start

Read the first error in the logs.

| Log | Cause | Action |
|---|---|---|
| `[config] PAYMENT_PROVIDER=dev is not allowed in production` | Wrong provider value | Set `disabled` (or approved `daraja`); never use `dev` in production |
| `[config] Unknown PAYMENT_PROVIDER` | Typo/missing value | Set one of `dev`/`daraja`/`disabled`; production accepts only the latter two |
| `[config] APP_SECRET_KEY is missing or a placeholder` | Secret unset or too short | Set a 32-byte+ random hex secret in Render; do not commit it |
| `migration … failed` | Schema conflict | Do not delete `schema_migrations`; inspect, fix forward with a new migration, restore from backup if data was affected |
| `[storage] DATABASE_REQUIRE_PERSISTENT=1 …` | Strict persistence enabled without a disk | Mount the disk / fix `DATABASE_FILE`, or unset the strict flag with the owner's approval |

### 4.2 Orders or tickets disappeared after a deploy

Expected on the Free plan: the database is ephemeral (see
`docs/PRODUCTION_PERSISTENCE_RUNBOOK.md`). Check `/health` `storage.persistent`.
If `false`, data cannot be recovered — it was never on a durable disk. Escalate to
the owner and prioritise the disk migration. Do not tell the customer their order
is safe until a durable database exists.

### 4.3 Suspected credential compromise

1. Owner changes the affected staff password.
2. Rotate `APP_SECRET_KEY` only with owner approval — this signs everyone out and
   invalidates guest order links and ticket QRs.
3. Review `audit_log` for `auth.login`, `auth.login_failed`, `auth.rate_limited`,
   `order.refund_*`, `event.cancel`.
4. Check Render environment variables for unexpected changes.
5. If the Render account itself is suspect, rotate the Render password/2FA and
   any linked GitHub access — owner action.

### 4.4 Payment discrepancy (when Daraja is enabled)

1. Do not mark anything paid manually.
2. Compare the `payments` row, the provider's transaction status and the order
   lifecycle. The callback handler already queries the provider and refuses
   contradictory callbacks.
3. Unresolved cases belong in `reconcile_exceptions`; never delete payment rows.
4. Escalate to the owner and the AD Group operator.

### 4.5 Abuse / traffic spike

`[security] rate limit hit` lines indicate throttling (login, checkout, order
lookup). If legitimate customers are affected on a shared mobile network, the
owner may raise the limits in code — a deliberate, reviewed change, not a live
edit.

## 5. Communication

- Tell affected customers the order/ticket reference and the next action, not
  internal error text.
- Do not claim a refund, restoration or fix until it has happened.
- Keep one owner-facing timeline; include what was verified, not what was assumed.

## 6. Recovery and follow-up

1. Confirm `/health` is 200 with `database: ok` and expected `storage.mode`.
2. Place a test juice order and open its order page; for ticketing, confirm
   checkout still fails closed when payments are disabled.
3. Take a backup if persistent storage exists.
4. Write a short post-incident note: cause, impact, fix, prevention.
5. If data was lost, state plainly what is unrecoverable.

## 7. Current gaps

- No external uptime monitor or alerting is connected.
- No on-call rotation; response depends on the owner/operator being reachable.
- No scheduled backups; see the persistence runbook.
- Render Free instances sleep when idle, so the first request after idle is slow
  and can look like an outage.
