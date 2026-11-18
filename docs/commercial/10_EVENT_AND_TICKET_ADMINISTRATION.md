# Event and Ticket Administration — Operating Procedure

**Audience:** MnM owner, sales manager, AD platform admin
**System:** `/staff/events`, `/staff/orders`, `/staff/scan`, `/verify/:code`
**Status:** procedure for the software as built. Ticket sales are currently
**disabled in production** because no payment integration has been approved.

---

## 1. Roles and what they can do

| Role | Capabilities in code |
|---|---|
| `ad_admin` | Admin, manage, scan, reports |
| `owner` | Manage, scan, reports |
| `manager` | Manage, scan, reports |
| `sales_staff` | Reports, scan |
| `scanner` | Scan only |

Authorisation is enforced server-side on each request (`requireCapability`), not
by hiding buttons. A scanner who signs in is redirected to `/staff/scan` because
they have no reporting clearance.

## 2. Creating an event

1. Sign in and open `/staff/events`.
2. Create the event: title, slug, description, venue name and area, start time,
   organiser name and contact, sale window.
3. Add at least one ticket category: name, **original price set by the
   organiser**, and quantity. The customer price is calculated from the active
   pricing terms (launch terms: 35% markup split 25% MnM / 10% AD — subject to the
   owner-confirmed agreement; see `MNM_PAYMENT_ARCHITECTURE.md`).
4. The event starts in draft. It only appears publicly after **Publish**, and only
   inside its sale window.
5. The authorisation fields (`authorization_ref`, `authorized_by_user`,
   `authorized_at`) record that MnM is authorised to sell for that organiser.
   Do not publish an event without a real authorisation on file.

## 3. Selling

- Public pages: `/events` (list), `/events/:slug` (detail), `/tickets` (product
  explainer).
- With `PAYMENT_PROVIDER=disabled`, the event page states that online ticket sales
  are temporarily unavailable and renders **no** checkout form. `POST /checkout`
  returns 503 before creating anything. Do not work around this with manual
  orders.
- When Daraja is approved and configured, checkout creates an order + reservation,
  initiates STK push, and issues a QR ticket only after a **verified** provider
  confirmation. The callback handler queries Safaricom's transaction status; it
  does not trust the callback body alone.
- Reservations expire; unsold inventory returns automatically.
- Maximum tickets per order is enforced per category (`max_per_order`).

## 4. Monitoring sales

- `/staff` — dashboard.
- `/staff/orders` — order list with lifecycle and amounts.
- `/staff/orders.csv` — export for reconciliation (staff-only; contains customer
  names and phones, so handle as personal data).
- `/admin` — platform admin view (AD Group role only).

## 5. At the gate

1. Open `/staff/scan` on a phone or tablet, sign in with a scanner account.
2. Scan the customer's QR (`/verify/:code` is the read-only verification URL).
3. The scanner shows valid / already redeemed / not found. Each scan attempt is
   written to `scan_log` with the staff user and result.
4. A ticket is admitted **once**. A second scan is reported as already used — do
   not override it without the owner's explicit instruction.
5. If the camera is unavailable, the manual code entry on the same screen is the
   fallback.

## 6. Changing an event

| Change | Effect | Caution |
|---|---|---|
| Publish | Event becomes publicly visible inside its sale window | Confirm organiser authorisation first |
| Restock a category | Increases `quantity` | Never reduce quantity below tickets already sold |
| Cancel event | Pending orders cancelled, reservations released, issued tickets voided, paid orders moved to refund-pending | Irreversible from the UI; requires manual refunds |
| Edit copy/venue | Reflected on the public page | Customers may already hold tickets showing the old details — notify them |

There is no "bulk email all ticket holders" feature. Notifications use the
`console` adapter only. Contacting buyers is a manual, owner-approved step using
the order export.

## 7. Data and privacy

- Order pages are protected by a per-order token; a reference alone is not
  enough (`/order/:ref?t=...`).
- Ticket QR payloads are signed with `APP_SECRET_KEY`; rotating that secret
  invalidates outstanding links and QR codes.
- Customer names, phones and emails are personal data. Export only when needed,
  store off shared drives, and delete exports after reconciliation.
- The audit log records staff actions (refunds, event cancellation, scans, staff
  login) without storing passwords or full contact details.

## 8. Current limitations

- Online ticket sales disabled until payment integration is approved and verified.
- No organiser self-service portal; MnM staff operate every event.
- No seated/assigned seating, no tier upgrades/downgrades, no transfers.
- No automated refunds to M-Pesa (see `11_REFUNDS_AND_CANCELLATIONS.md`).
- Live events list is currently empty in production; events created on the
  ephemeral Render database are lost on redeploy until a persistent disk is
  mounted.
