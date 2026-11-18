# Staff Operations — Accounts, Roles and Daily Routine

**System entry:** `https://mnm-juicebar-tigoni.onrender.com/staff/login`
**Audience:** owner, managers, counter staff, gate scanners

---

## 1. Accounts

- Staff sign in with the **phone number on file** and a password. Spaces and
  local formats are normalised, so `+254 705 687 273`, `0705687273` and
  `+254705687273` all reach the same account.
- Passwords are stored as scrypt hashes with per-user salts; the platform never
  stores or displays a plaintext password.
- Sessions are server-side, stored as SHA-256 hashes of opaque tokens, and expire
  after **12 hours**. The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in
  production.
- Eight failed attempts for one phone from one IP within 10 minutes blocks that
  combination; all attempts from one IP are additionally capped. Blocks are
  in-memory, so they reset when the service restarts.
- There is **no self-service password reset**. The owner resets a password by
  running the account tooling/seed procedure on the server or by asking the AD
  Group operator. Never share a password over WhatsApp in plain text.

Creation of real staff accounts in production is an owner action. The development
seed (`npm run seed`) refuses to run with `NODE_ENV=production` precisely so
demo credentials cannot leak into the live system.

## 2. Roles

| Role | Use it for | Can |
|---|---|---|
| `owner` | MnM proprietor | Manage events/products/settings, scan, reports |
| `manager` | Shift lead | Same management surface as owner |
| `sales_staff` | Counter | Reports and scanning; no settings or refunds |
| `scanner` | Gate only | Scan tickets; redirected to `/staff/scan` after login |
| `ad_admin` | AD Group operator | Platform admin plus all capabilities |

Give the narrowest role that does the job. A gate volunteer should be `scanner`,
not `manager`. Role changes are made in the database/account tooling by the owner
or AD Group operator; there is no role-editing screen.

## 3. Screens

| Screen | Purpose |
|---|---|
| `/staff` | Dashboard |
| `/staff/juice` | Juice order queue |
| `/staff/juice/orders` | All juice orders, filters |
| `/staff/juice/orders/:id` | One order: status, assign, receipt |
| `/staff/juice/products` | Menu and availability (owner/manager) |
| `/staff/juice/delivery` | Delivery zones and fees |
| `/staff/juice/reviews` | Moderate customer reviews |
| `/staff/juice/catering` | Catering enquiries and status |
| `/staff/juice/settings` | Site copy, contact details, hours |
| `/staff/events` | Events, publishing, restock, ticket categories |
| `/staff/orders` | Ticket orders, refunds, CSV export |
| `/staff/scan` | QR gate scanner |
| `/admin` | Platform admin (AD Group) |

## 4. Opening and closing

**Opening**

1. Sign in; check the dashboard and juice queue.
2. Confirm the menu is accurate (unavailable items switched off).
3. Confirm delivery zones/fees are correct for the day.
4. Test the scanner once with a known ticket if an event is running.

**Closing**

1. Clear or hand over open orders; no order should sit in `new`.
2. Reconcile cash/M-Pesa collected against order screens.
3. Record any refund in the staff flow (see `11_REFUNDS_AND_CANCELLATIONS.md`).
4. Sign out on shared devices (session also expires after 12h).
5. If persistent storage is in place, take a backup (`npm run db:backup`).

## 5. Device and credential hygiene

- Use one named account per person; never a shared "staff" login. Audit entries
  are only meaningful if they identify a person.
- Do not save the password in a browser on a shared counter device.
- Do not photograph the staff screens or the owner's credentials.
- Report a lost device or suspected password exposure to the owner immediately so
  the password can be changed and sessions invalidated.
- Rotating `APP_SECRET_KEY` signs everyone out and invalidates outstanding guest
  order links and ticket QRs — do it only with the owner's approval.

## 6. Known gaps (owner decisions)

- **No MFA.** Compensating controls today: 12-hour sessions, per-IP and per-phone
  login throttling, scrypt password hashing, server-side role checks, audit
  logging. A second factor is recommended before multiple staff accounts hold
  refund/settings access on the public internet.
- No forced password change on first login.
- No session list or "sign out everywhere" button.
- Rate limits are per process; a multi-instance deployment would need shared
  counters.
- Login attempts are capped in memory, so a service restart clears the counter.
