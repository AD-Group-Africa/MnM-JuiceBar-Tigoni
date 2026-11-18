# DRAFT — Project Proposal: MnM Digital Ecosystem

**Prepared by:** Afrika Digitalis (AD Group)  
**Prepared for:** MnM Juice Bar  
**Status:** Draft for review — not an offer, not signed, no prices or commitments agreed  
**Date:** 18 November 2026

> This document is a working draft. All commercial figures, dates, ownership terms, service levels and signatures are marked `[TO BE AGREED]`. Nothing here is a binding commitment by either party.

## 1. Purpose

MnM Juice Bar requires a dependable digital ecosystem covering:

1. A customer-facing juice bar website with catalogue, cart, pickup/delivery checkout and order status.
2. A ticketing platform for authorised event sales, QR admission, refunds and reconciliation.
3. Operational controls for staff, owner reporting and audit trails.
4. A clear path to activate M-Pesa and other manual integrations without compromising existing data.

The objective is a commercially usable platform, not a cosmetic website.

## 2. Proposed scope

### Juice Bar website
- Storefront, product catalogue, product detail, cart.
- Pickup and delivery checkout with server-side pricing, zones and minimum-order enforcement.
- Customer order confirmation, private order link and order lookup.
- Staff product, availability, order, delivery-zone and review management.
- Responsive customer experience.
- SEO basics and security headers.

### MnM Tickets
- Event discovery and event detail.
- Ticket categories, capacity, per-order limits and sale windows.
- Transaction-safe purchasing with reservations and paid-capacity reconciliation.
- QR ticket issuance and gate validation; duplicate admission rejection.
- Cancellation/refund workflow and audit trail.
- Staff reporting and CSV exports.
- Organiser authority recorded before publishing.

### Handover
- Technical documentation, operations manual and integration register.
- Test evidence and known-limitations register.
- Commercial drafts for legal/commercial review.

## 3. Out of scope unless separately agreed

- Live M-Pesa activation, card acquiring, eTIMS, SMS/WhatsApp/email delivery, banking/settlement accounts and DNS changes.
- Customer accounts with verified identity (requires an SMS/email verification decision).
- Organiser self-service portal.
- Multi-instance/high-availability redesign.
- Payment reconciliation with a bank statement feed.
- Native mobile apps.
- Full accessibility certification, penetration test or load test.
- Content writing, photography, menu pricing and policy/legal text.

## 4. Delivery approach

1. Preservation and audit of the existing repository and data.
2. Controlled implementation of approved defects and gaps.
3. Automated and manual verification on isolated databases.
4. Staging deployment with owner acceptance.
5. Manual integration activation by authorised humans.
6. Production cutover and handover.

## 5. Acceptance principles

- No fabricated functionality or test results.
- No production deployment without written owner approval.
- No live financial transaction until the owner and provider approve it.
- Acceptance is against agreed criteria and recorded evidence, not verbal assurance.
- Owner content, prices and policies must be approved before launch.

## 6. Commercials

| Item | Value |
|---|---|
| Project fee | `[TO BE AGREED]` |
| Payment schedule | `[TO BE AGREED]` |
| Maintenance/support | `[TO BE AGREED]` |
| Revenue-share/settlement terms | `[TO BE AGREED]` |
| Timeline | `[TO BE AGREED]` |
| Validity of proposal | `[TO BE AGREED]` |

## 7. Assumptions

- The owner provides timely access to Render/DNS/domain and any existing business accounts.
- The owner approves content, prices, zones, policies and refund rules.
- A single Node process with a persistent SQLite disk is acceptable for launch volume.
- Live integrations remain off until separately authorised.
- Legal review of the agreement drafts is the responsibility of the parties.

## 8. Next steps

1. Owner reviews this proposal and the defect/decision registers.
2. Parties agree scope, fees, timeline and support terms.
3. Owner supplies the outstanding decisions and access listed in `MNM_OUTSTANDING_OWNER_DECISIONS.md`.
4. AD Group prepares a staging deployment for acceptance.
