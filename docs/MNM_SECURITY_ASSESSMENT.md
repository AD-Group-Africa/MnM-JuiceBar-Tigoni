# MnM Digital Ecosystem — Security Assessment

**Status:** Local code assessment; no penetration test, live scan or Render configuration review was performed.  
**Date:** 18 November 2026

## 1. Verified controls

| Control | Finding |
|---|---|
| Password storage | Staff passwords are hashed with the project's scrypt-based helper; no plaintext passwords in the inspected schema. |
| Sessions | Random 32-byte session tokens; only SHA-256 hashes stored; `HttpOnly`, `SameSite=Lax`, and `Secure` in production; server-side logout. |
| Authorization | Every staff route re-checks role capability server-side (`manage`, `reports`, `scan`, `admin`). |
| CSRF / origin | State-changing requests use an Origin allow-list; cross-origin and origin-less submissions are tested and refused on protected routes. |
| SQL injection | Inspected queries use bound parameters; no string interpolation of user input found in the reviewed paths. |
| XSS | JSX escapes values by default; CSP restricts scripts/styles to self plus inline (inline is still a residual risk). |
| Headers | `X-Content-Type-Options`, `Referrer-Policy`, HSTS in production and a CSP are set. |
| Payment callback | Daraja callbacks are not trusted directly; the server queries the official STK status endpoint and checks the merchant reference. |
| Payment ordering | Local payment attempt is persisted before provider initiation; one active attempt per order; local failure aborts before provider acceptance. |
| Production payment guards | Dev simulator rejected in production; Daraja sandbox rejected in production; HTTPS public callback required; fractional-KES and sub-KES-1 totals refused. |
| Ticket admission | Signed/tokenized ticket links; redemption is atomic; duplicate/settled states rejected; every scan attempt audited. |
| Juice order privacy | Order pages require a hashed guest token; reference + checkout phone can issue a fresh token; wrong phone gets a generic 404. |
| Customer accounts | Optional phone + password accounts; scrypt hashes; random session tokens stored only as hashes; `HttpOnly`, `SameSite=Lax`, `Secure` in production; order history is limited to orders linked while signed in. |
| Secrets | Environment-variable based; `.env` is not searched or committed; `.env.example` contains placeholders only. |

## 2. Open risks

| Risk | Severity | Detail | Recommended action |
|---|---|---|---|
| No rate limiting | High | Public checkout, order lookup, login and scan endpoints can be brute-forced or abused. | Add edge/WAF rate limits and application-level throttling before launch. |
| No MFA for staff | High | A stolen staff password gives full role capabilities. | Require MFA for owner/manager/admin, especially before live payments. |
| Guest lookup is phone-based | Medium | Anyone who knows an order reference and the checkout phone can reopen that order. This is a deliberate recovery path, but it is not identity verification. | Add SMS OTP if stronger ownership is required; monitor lookup attempts. |
| Customer accounts lack verification | Medium | Phone ownership is not verified and there is no password reset; anyone who registers an unclaimed phone owns that account. | Add SMS/email OTP and recovery before promoting accounts; keep guest checkout. |
| No organiser portal or scoped organiser auth | Medium | Organiser permission is recorded as a reference by staff; organisers cannot log in to their own scope. | Define organiser roles and authorization evidence before onboarding third parties. |
| Single SQLite file | Medium | No row-level tenant isolation beyond application checks; single-instance constraint; disk corruption/loss risk. | Keep one instance, restrict filesystem access, configure snapshots and tested restores. |
| CSP allows inline script/style | Medium | Needed by the current server-rendered pages, but weakens XSS defense. | Move to nonces/hashes and remove `unsafe-inline` where feasible. |
| No WAF / DDoS protection | Medium | Render-level protection not verified. | Put the service behind a WAF/CDN with bot and rate controls. |
| No security monitoring/alerting | Medium | Logs exist but no alert pipeline was found. | Ship auth failures, reconciliation exceptions and 5xx to an alerting service. |
| No penetration test | Medium | No independent adversarial testing. | Commission before handling real money at scale. |
| Error detail in logs | Low | Server logs include stack traces and request details. | Restrict log access and retention; never log secrets or full payment payloads. |
| Session fixation/rotation | Low | Login creates a new random token; old sessions are not explicitly enumerated. | Add session rotation/revocation-all on password change. |
| `clearSessionCookie` lacks `Secure` | Low | Deletion cookie is not marked `Secure`; deletion still works over HTTPS. | Align deletion attributes with the session cookie. |

## 3. Deployment security requirements

- `NODE_ENV=production`.
- Stable high-entropy `APP_SECRET_KEY`; rotate only with a planned invalidation of sessions/guest links.
- `PUBLIC_ORIGINS` exactly the public HTTPS origin(s).
- Persistent disk with restrictive permissions for the SQLite database.
- HTTPS only; HSTS enabled; no direct database exposure.
- Backups encrypted at rest and restore-tested.
- Render environment variables set through the dashboard, never committed.
- Live Daraja credentials only after Safaricom approval; sandbox first.
- No live SMS/WhatsApp/eTIMS/card/banking credentials in the repository.

## 4. Security conclusion

The local code has credible baseline controls for authentication, authorization, CSRF, payment callback verification and order privacy. It is **not** production-hardened: rate limiting, MFA, monitoring, WAF, independent testing and customer identity verification are missing or unverified. These are launch blockers for a high-value public deployment, not cosmetic items.
