# Juice Order Fulfilment and Collection — Operating Procedure

**Audience:** MnM counter staff, shift leads, owner
**System:** `/staff/juice` (queue), `/staff/juice/orders/:id` (single order)
**Status:** procedure for the software as built; no commercial terms are implied

---

## 1. Where orders come from

Customers order from the public site (`/menu` → `/cart` → `/checkout` →
`POST /juice/checkout`). They can check out as a guest or signed in. Every order
gets a reference like `MNM-J-8K3F92` and a private link containing an access
token. Staff never need that token; staff screens are behind a staff login.

Payment is **pay on collection or delivery**. The site does not take online
payment for juice. The order page says so explicitly; no card or M-Pesa prompt is
sent. Do not tell a customer their order is "paid" unless cash or M-Pesa was
actually received at the counter and recorded.

## 2. Order lifecycle

| Status | Meaning | Who sets it |
|---|---|---|
| `new` | Received, not yet acknowledged | System on checkout |
| `accepted` | Acknowledged; will be prepared | Staff |
| `preparing` | Being made | Staff |
| `ready_for_pickup` | Ready at the counter | Staff |
| `ready_for_dispatch` | Packed for a rider | Staff |
| `out_for_delivery` | With the rider | Staff |
| `delivered` | Customer received it | Staff |
| `cancelled` | Cancelled before fulfilment | Staff |
| `failed` | Could not be fulfilled | Staff |

The customer's order page shows a five-step journey: Received → Preparing →
Ready → Awaiting collection → Collected (pickup) or Received → Preparing → Ready
→ On the way → Delivered (delivery). Status changes are made from the order
screen; the customer sees them on refresh — there is no push notification.

## 3. Shift routine

**Start of shift**

1. Sign in at `/staff/login` (phone number + password). Sessions expire after 12
   hours.
2. Open `/staff/juice`. Check the queue for `new` orders and any catering
   enquiries (`/staff/juice/catering`).
3. Confirm the menu is current (`/staff/juice/products`) — sold-out items should
   be marked unavailable rather than left orderable.

**During service**

1. Move each new order to `accepted` or `preparing` as work starts; do not leave
   orders in `new` once seen.
2. For pickup, set `ready_for_pickup` when the drink is on the counter and call
   the customer's number.
3. For delivery, assign a rider, then set `ready_for_dispatch` →
   `out_for_delivery` → `delivered`. Delivery zones and fees are configured in
   `/staff/juice/delivery`; the fee is calculated server-side from the zone, never
   from the browser.
4. Collect payment at hand-over (cash or the bar's own M-Pesa till). The platform
   does not record juice payment as settled; if the owner needs that record, the
   order notes are the current place to write it.

**End of shift**

1. Confirm no order is left in `new`.
2. Check `preparing` / `ready_*` orders are genuinely still open, not forgotten.
3. Take a database backup if the service is on persistent storage:
   `npm run db:backup` (see `docs/PRODUCTION_PERSISTENCE_RUNBOOK.md`).

## 4. Collection checklist

- Ask for the order reference or the customer's phone number.
- Match the name and items on `/staff/juice/orders/:id` before handing anything
  over.
- Collect payment if not already paid; state the amount from the order screen.
- Mark the order `delivered` (collected) only after hand-over.
- Never read the customer's private order link aloud or share it; the reference
  plus phone number is the lookup the customer can use themselves.

## 5. Exceptions

| Situation | Action |
|---|---|
| Item unavailable after ordering | Call the customer, agree a substitution or cancel the line via staff notes + order status; do not silently change the price. |
| Wrong phone number | Do not guess. Keep the order open and note the issue; the customer can reopen it with reference + the phone typed at checkout. |
| Customer disputes the total | Totals are recomputed server-side from current prices; show the itemised order screen. Escalate to the owner rather than editing the database. |
| Duplicate order (customer double-tapped) | Cancel one, note "duplicate" in staff notes, confirm the other. |
| Rider cannot find the address | Call the delivery contact on the order; set `out_for_delivery` only when the rider actually leaves. |

## 6. What the system does not do

- No online juice payment, card processing or STK push.
- No automatic SMS/WhatsApp to the customer (`console` notification adapter).
- No live rider GPS tracking.
- No stock decrement per sale — product availability is a manual switch, not
  inventory accounting.

These are product boundaries, not defects. Changing any of them requires an owner
decision and, for payments, a live integration approval.
