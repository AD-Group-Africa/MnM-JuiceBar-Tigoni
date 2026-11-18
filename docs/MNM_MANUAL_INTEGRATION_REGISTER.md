# MnM Digital Ecosystem — Manual Integration Register

**Status:** All live integrations remain **UNACTIVATED**  
**Date:** 18 November 2026

> No live financial transaction, message, tax filing, DNS change or paid subscription was activated during this work. Simulated payments are labelled as simulated. Activation requires an authorised human with the relevant account.

## 1. Register

| ID | Integration | Current state | Code readiness | Required owner action | Activation gate |
|---|---|---|---|---|---|
| INT-01 | M-Pesa Daraja STK Push | Not activated; no credentials | Adapter + callback verification + production guards; mock-tested only | Provide shortcode/till, consumer key/secret, passkey, callback domain; approve Safaricom go-live | Safaricom approval; sandbox test; written production approval |
| INT-02 | Card payments | Not implemented/activated | No card adapter | Choose provider, merchant account, PCI scope | Separate scope + provider onboarding |
| INT-03 | eTIMS | Not implemented/activated | No eTIMS adapter | Register, choose integrator, provide credentials | Tax/accounting approval |
| INT-04 | SMS / customer OTP | Console only; accounts have no OTP verification | Console adapter; no live send | Choose provider, sender ID, API key; approve OTP policy | Provider approval + sender registration |
| INT-05 | WhatsApp | Console only / not implemented | No live WhatsApp adapter | Business account, template approval, API key | Meta/provider approval |
| INT-06 | Email | Console only | Console adapter; no live SMTP | SMTP/API provider, from-domain authentication | DNS/SPF/DKIM/DMARC approval |
| INT-07 | Banking / settlement | Not activated | Order/payment/commission records only | Settlement account, signatories, payout process | Signed revenue-share/settlement terms |
| INT-08 | Domain / DNS / TLS | Not changed | App expects `PUBLIC_ORIGINS` HTTPS origin | Provide domain, DNS access, TLS plan | Owner-approved DNS change window |
| INT-09 | Render hosting | Unverified | Builds/runs locally; no `render.yaml` | Provide service URL/access, disk and env names | Read-only audit, staging, backup, written approval |
| INT-10 | Backups / monitoring | Not configured | Health endpoints and logs exist | Choose backup/monitoring provider and contacts | Restore test + alert test |
| INT-11 | Paid subscriptions | Not activated | None | Budget approval | Owner sign-off |

## 2. M-Pesa activation checklist

### Sandbox
- [ ] Safaricom Daraja app created; shortcode/till confirmed.
- [ ] Consumer key/secret, passkey and callback base stored in the secret manager.
- [ ] `PAYMENT_PROVIDER=daraja`, `MPESA_ENV=sandbox`.
- [ ] Public HTTPS callback reachable and whitelisted.
- [ ] Whole-shilling test total; STK prompt received.
- [ ] Callback verified by STK query; order settles once.
- [ ] Duplicate callback ignored; amount mismatch goes to reconciliation.
- [ ] Refund/cancellation procedure tested with a human operator.

### Production
- [ ] Safaricom production approval and live shortcode.
- [ ] `MPESA_ENV=production`; production credentials.
- [ ] Database backup and rollback plan.
- [ ] Small-value live transaction with owner approval.
- [ ] Settlement/reconciliation checked against the provider statement.
- [ ] Monitoring/alerts for failed callbacks and reconciliation exceptions.
- [ ] Customer support and refund process live.

## 3. Notification activation checklist

- [ ] Provider account and sender identity approved.
- [ ] Credentials stored outside the repository.
- [ ] Templates/content approved.
- [ ] Opt-out and consent rules implemented.
- [ ] Test messages to owner-controlled numbers only.
- [ ] Failure/retry logging and rate limits.

## 4. DNS/hosting activation checklist

- [ ] Owner confirms domain and DNS access.
- [ ] Staging origin verified.
- [ ] `PUBLIC_ORIGINS` updated to the exact HTTPS origin.
- [ ] HSTS/TLS verified.
- [ ] `robots.txt` reviewed; sitemap URL added when domain is final.
- [ ] Rollback DNS record documented.

## 5. Secrets handling

- Never commit credentials or paste them into chat, tickets or documents.
- Use the hosting provider's secret manager or the owner's vault.
- Use separate sandbox and production credentials.
- Rotate any credential that has been exposed.
- `APP_SECRET_KEY` rotation invalidates sessions and guest links; plan it.

## 6. Sign-off

| Integration | Activated by | Date | Evidence |
|---|---|---|---|
| INT-01 | `[TO BE COMPLETED]` | `[TO BE COMPLETED]` | `[TO BE COMPLETED]` |
| INT-02–INT-11 | `[TO BE COMPLETED]` | `[TO BE COMPLETED]` | `[TO BE COMPLETED]` |
