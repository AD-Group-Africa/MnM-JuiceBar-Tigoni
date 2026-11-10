# Security and Privacy — MnM Tickets

## Server-side security

| Control | Implementation |
|---|---|
| **Authentication** | Scrypt-hashed passwords + session tokens (SHA-256 opaque, stored as `token_hash` in `sessions` table). `getSessionUser()` validates the token against the DB on every request. |
| **Authorisation** | Role-based access checked server-side via `roleAllows(u.role, capability)`. Frontend button visibility is auxiliary — every mutating endpoint re-checks the role and origin. |
| **CSRF protection** | Origin check on every state-changing request via `stateChangeOriginAllowed(c, config.publicOrigins)`. SameSite=Lax on session cookies; `POST /staff/login` and `POST /pay/notify/daraja` are the only mutation endpoints with origin guards. |
| **Input validation** | All incoming data is validated via Hono's `c.req.parseBody()` with explicit schemas; raw strings are never interpolated into SQL (parameterized queries via `db.ts`). |
| **Output encoding** | Hono JSX auto-escapes all interpolated values (`String()` utility escapes `&`, `<`, `>`, `"`, `'`). No `dangerouslySetHTML` anywhere in the staff or customer facing code. |
| **SQL injection prevention** | All queries use the `db.ts` helper layer with bound parameters (`run(\"SELECT * FROM events WHERE id=?\", [id])`). No `concat` or string interpolation in any SQL statement. |
| **Secure session configuration** | Session cookies are `HttpOnly`, `SameSite=Lax`, and issued over HTTPS in production. The secret is `APP_SECRET_KEY` from env (32-byte random, generated at first run). |
| **Error handling without leaks** | Hono `onError` handler: `console.error` detail internally; responses return `{error, code}` generic JSON or generic text. Stack traces are suppressed under `production` env headers. |
| **Payment callback validation** | Daraja callback handler validates `MerchantRequestID`, `CheckoutRequestID`, exact amount/currency match, and `ResultCode`. Duplicate notifications map to the existing row via UNIQUE `provider_request_id`. |
| **Rate limiting** | Application-level rate limiter on `POST /staff/login`, `POST /checkout`, and `GET /verify/*` (10 req/min per IP). Configurable via middleware. |
| **Secret and env protection** | `.env` is gitignored; no secrets committed. `APP_SECRET_KEY` must be rotated if ever exposed. Production uses a secrets manager; dev uses the `.env` file only. |

## Customer data privacy

| Data category | Retention | Access | Notes |
|---|---|---|---|
| **Contact phone/email** | Kept for ticket delivery + support | Staff with `manage` role or higher; ad_admin cannot see individual customer phones | Used only for order communication and support. |
| **Order history (per customer)** | Indefinite (linked to signed guest token or account) | Customer themselves (via signed link); staff with `reports` role | Never exposed to other customers. |
| **Ticket codes** | Indefinite (linked to orders) | Staff with any role; ad_admin can count but not list individual codes | Used for verification and audit. |
| **Scan logs** | Indefinite (audit trail) | `ad_admin` only; `manager` can view scans for their events only | Every verification attempt is recorded: scanner, timestamp, result, reason. |
| **Audit log** | Indefinite (compliance) | `ad_admin` only | Sensitive actions: publishing, pricing changes, refunds, term edits. |
| **Payment provider data** | Per-order record (receipt number, request ID) | `ad_admin` only (financial reconciliation) | Never exposed on the customer or staff dashboards. |

## Data minimisation principles

- **No unnecessary PII**: Customer names and phones are stored only because they are needed for ticket delivery and support. No IDs, national numbers, or financial data beyond what payments require.
- **Guest checkout option**: A signed guest token (opaque, SHA-256 hashed in DB) allows order retrieval without requiring an account. The token grants access only to the specific order it was issued for.
- **Session isolation**: Each user's session is isolated by token hash; there is no global "admin" session that bypasses role checks.
- **Data access by role**:
  - Visitor: own tickets via signed link only; no staff data.
  - Scanner: can scan/verify; cannot access orders, customers, or financial data.
  - Sales staff: can manage events/orders/refunds for assigned events; cannot access AD platform data.
  - Manager: everything sales_staff can + own event/inventory management.
  - Owner: everything manager can + MnM-side financial visibility.
  - ad_admin: platform health, cross-event totals, audit trail; restricted from individual customer PII unless operationally required.

## Kenyan data protection considerations

- The platform processes personal data (phone, name) for Kenyan users. Under the Kenya Data Protection Act 2019, the following obligations are flagged for qualified adviser review:
  - Lawful basis for processing (ticket delivery + support = legitimate interest + contractual).
  - Data retention policy (order data retained indefinitely; flagged for review).
  - User rights (access, correction, deletion) — implemented via guest token revocation and staff-initiated data purge.
  - breach notification procedure — not implemented in v0.1; documented as a future requirement.
- The privacy policy page (accessible from the storefront footer) discloses what data is collected, why, and how long it is retained.
- Consent is obtained at the point of purchase (customer acknowledges the 35% markup is applied by the reseller, not the organiser).

## Security headers (always set)

| Header | Value (production) |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `same-origin` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `Content-Security-Policy` | `default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'` |

## Dependency checks

- No third-party auth provider (Auth0, Clerk, etc.) — custom implementation with zero runtime dependencies beyond Node.js built-ins.
- No Redis or external caching — all state in SQLite/PostgreSQL.
- No password reset email flow in v0.1; staff accounts are provisioned by ad_admin or the owner.
- The QR code encoder uses hand-crafted ISO/IEC 18004 tables (verified) — no external library that could introduce supply-chain risk.