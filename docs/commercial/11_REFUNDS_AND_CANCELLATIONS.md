# Refunds and Cancellations — Operating Procedure

**Audience:** MnM owner and managers with `manage` capability
**System:** `/staff/orders` (refund actions), `/staff/events` (event cancellation)
**Status:** the software records refunds; it does not move money.

---

## 1. What the system actually does

Ticket refunds are a **two-step, staff-controlled record**:

1. **Start refund** (`POST /staff/orders/refund`) — allowed only for orders in
   `paid` or `ticket_issued`. The order moves to `refund_pending`, its tickets are
   marked `refunded` (so they can no longer be admitted) and the action is written
   to `audit_log`.
2. **Complete refund** (`POST /staff/orders/refund/complete`) — allowed only from
   `refund_pending`. The order moves to `refunded`, remaining tickets are closed,
   sold counts are reconciled and the completion is audit-logged.

**No money moves through the platform.** There is no M-Pesa reversal API call, no
card refund and no bank instruction. Staff must return the money through the same
channel the customer paid (for example a manual M-Pesa send to the payer's number)
and only then mark the refund complete. Marking it complete is an assertion that
the refund happened offline; it is not proof.

With `PAYMENT_PROVIDER=disabled` there are no paid ticket orders at all, so there
is nothing to refund until a payment integration is approved.

## 2. Before starting a refund

1. Confirm the order reference and the customer's identity (name + phone).
2. Open `/staff/orders` and check the lifecycle.
3. Establish **why**: event cancelled, duplicate payment, wrong quantity, customer
   request, or a reconciliation exception (`reconcile_exceptions`).
4. Confirm the amount from the order record, not from memory or the customer's
   screenshot. Amounts are stored in minor units and rendered as KES.
5. Check whether the ticket has already been scanned. A redeemed ticket is a
   service already delivered; refunding it is an owner decision, not a counter
   decision.

## 3. Refund decision authority (owner to confirm)

The software does not encode who may approve what. Until the owner issues a
written policy, use this conservative default and record the approver in the
order notes:

| Case | Suggested default |
|---|---|
| Event cancelled by MnM/organiser | Full refund of the amount actually paid |
| Duplicate payment for one order | Refund the duplicate in full |
| Customer changes mind, ticket not used | Owner decision; platform fee/commission treatment is not defined |
| Ticket already redeemed | Owner decision only |
| Payment confirmed but no ticket issued (system fault) | Refund in full or issue the ticket; escalate as an incident |

Do not invent a refund window, cancellation fee or "no refunds" rule in customer
conversations. `[TO BE AGREED]` in the commercial drafts means exactly that.

## 4. Procedure

1. Agree the refund with the customer and record the reason in staff notes.
2. Execute the offline refund in the presence of a second staff member where
   possible; keep the M-Pesa/bank confirmation code.
3. Start the refund in `/staff/orders`.
4. Complete the refund in `/staff/orders` once the money has left.
5. Tell the customer when the refund was sent and the reference.
6. Reconcile at end of day: offline confirmation codes must match the orders
   marked `refunded`.

If step 3 happened but the money was not sent, the order correctly sits in
`refund_pending` — do not "fix" it by marking complete. Investigate and finish
the payment.

## 5. Event cancellation

Cancelling an event from `/staff/events`:

- cancels pending/failed/expired orders and releases their reservations;
- moves paid and ticket-issued orders to `refund_pending`;
- marks their tickets `cancelled` so the gate refuses them;
- reconciles sold counts and writes an `event.cancel` audit entry with counts.

It **does not** refund anyone. Each affected order must be refunded manually per
section 4. The cancellation result screen reports how many orders are queued.
Cancellation is not reversible from the UI.

## 6. Refunding juice orders

Juice orders are pay-on-collection. If a customer paid cash or by the bar's own
M-Pesa and the order is cancelled, refund it directly — the platform holds no
juice payment record. Cancel the order (`cancelled`) so the kitchen stops work,
and note the refund in staff notes.

## 7. Records and audit

- `audit_log` records `order.refund_started`, `order.refund_completed` and
  `event.cancel` with the staff user id and timestamp.
- Payments table rows are append-only; never edit or delete a payment record.
- Reconciliation exceptions should be resolved through the staff flow, not by
  direct SQL, unless the owner authorises a documented repair with a backup first.

## 8. Outstanding

- No automatic provider refund.
- No customer-initiated cancellation/refund request screen.
- No written refund policy approved by the owner (`[TO BE AGREED]`).
- No accounting export dedicated to refunds (order CSV only).
