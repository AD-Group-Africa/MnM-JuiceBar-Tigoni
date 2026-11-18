# Customer Support — Operating Guide

**Audience:** counter staff, shift lead, owner
**Public contact:** +254 705 687 273 · Kabuku, opposite St. Paul's University, Limuru · Tigoni, Limuru
**Status:** manual support only; no helpdesk integration is connected.

---

## 1. Channels

Support currently happens on the phone number and in person. The site publishes
the number and address from `business_settings`, so the owner can change them at
`/staff/juice/settings` without a deploy. There is no live chat, ticketing inbox
or WhatsApp Business integration.

## 2. Common requests

| Request | What to do |
|---|---|
| "Where is my juice order?" | Ask for the reference (`MNM-J-…`) or phone number. Open `/staff/juice/orders`, confirm status, tell them the next step. Never send a screenshot of another customer's order. |
| "I lost my order link" | Send them to the order page and use "reference + phone used at checkout". The system issues a fresh private link if both match. |
| "I lost my ticket / QR" | Ask for the order reference and the phone used. From `/staff/orders`, open the order; the customer can reopen their own link with reference + checkout phone. Do not forward someone else's ticket. |
| "The gate says my ticket was already used" | Check `/staff/orders` and the scan log. A ticket admits once. Escalate to the owner; do not wave the person through or reissue by editing the database. |
| "I was charged but got no ticket" | Treat as an incident (see `14_INCIDENT_HANDLING.md`). Do not mark paid manually. |
| "I want a refund" | See `11_REFUNDS_AND_CANCELLATIONS.md`. |
| "Your menu price is wrong" | Prices are server-computed; check `/staff/juice/products`. Report a genuine mismatch to the owner/AD Group rather than editing the database. |
| "The site is down" | Confirm at `/health`; report to the AD Group operator. See incident handling. |

## 3. Identity checks

Before discussing an order:

1. Ask for the order reference **and** the phone number used at checkout, or the
   private link the customer received.
2. Match the name on the order.
3. Never read out a full customer record to a caller who cannot supply either the
   reference+phone or the link.

Staff can see full customer details in the staff screens; that access is for
fulfilment, not for sharing.

## 4. Response standards (owner to confirm)

The software does not enforce SLAs. Until the owner sets them, use these as
working defaults and keep them internal:

- Juice order query: answer during the same shift.
- Ticket query on an event day: answer before gates open.
- Refund request: acknowledge the same day; completion depends on the refund
  channel.
- Suspected fraud or double charge: escalate to the owner immediately.

Do not promise refund timing, compensation or a "guaranteed" outcome that the
owner has not approved.

## 5. Personal data

- Collect only what the order needs: name, phone, optional email, delivery
  details.
- Do not store card numbers, M-Pesa PINs or ID documents — the system has no
  field for them and staff must never request a PIN.
- Delete export files (CSV) after reconciliation; they contain names and phones.
- A customer asking what data is held: identify their orders by reference+phone,
  explain what is stored, and route deletion/correction requests to the owner.
  There is no self-service deletion screen.

## 6. Escalation contacts

| Issue | First contact | Then |
|---|---|---|
| Site down / errors | AD Group operator | Owner |
| Payment discrepancy | Owner | AD Group operator |
| Suspected account compromise | Owner | AD Group operator (rotate secrets) |
| Data loss after deploy | AD Group operator | Owner (restore from backup) |

Contact details for the AD Group operator are an owner-supplied item
(`[TO BE PROVIDED]`); they must not be invented.
