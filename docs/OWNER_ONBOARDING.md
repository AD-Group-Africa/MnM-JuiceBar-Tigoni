# Owner Onboarding — MnM Tickets

## Welcome, MnM Juice Bar owner

This document guides you through getting operational with the MnM Tickets platform, developed by Afrika Digitalis (AD Group). It explains what is already built, what decisions rest with you, and what still needs external arrangement before live sales can begin.

## What is already built and ready for your use

| Feature | Status |
|---|---|
| **Storefront**: mobile-friendly event browsing, event details, ticket categories with prices, checkout with dev payment simulator | ✅ Fully implemented and tested |
| **Staff dashboard**: event CRUD, inventory management, orders, refunds, CSV exports, scan console | ✅ Fully implemented and tested |
| **AD admin console**: platform health, cross-event totals, audit trail, reconciliation exceptions | ✅ Fully implemented and tested |
| **Commission engine**: 35% markup (25% MnM + 10% AD) snapshot per order, integer minor units, deterministic rounding | ✅ Fully implemented and tested (see PRICING_AND_COMMISSIONS.md) |
| **Ticket issuance**: unique digital tickets with QR codes, online verification, redemption audit | ✅ Fully implemented and tested (29 tests pass) |
| **Payments**: development simulator (clearly labelled, never presented as real) + Daraja adapter structure | ⚠️ Structure complete; live use BLOCKED (see below) |
| **Authentication**: role-based access (owner, manager, sales_staff, scanner, ad_admin) with origin checks | ✅ Fully implemented and tested |
| **Full test suite**: 36 tests pass (29 unit/integration + 7 HTTP end-to-end) | ✅ All green |

## Decisions that require your confirmation

### 1. Commercial arrangement confirmation

The proposed commercial model (mandatory, per the master prompt):

| Component | Formula | Example (KSh 1,000 ticket) |
|---|---|---|
| Original ticket price (organiser/supplier allocation) | P | KSh 1,000 |
| MnM gross commission | 25% × P | KSh 250 |
| Afrika Digitalis platform commission | 10% × P | KSh 100 |
| **Customer selling price** | **P + 25% × P + 10% × P = 135% × P** | **KSh 1,350** |

**Question**: Do you confirm this 35% markup split (25 pp MnM, 10 pp AD) as the operating terms for live resale?

- [ ] Confirmed — proceed with these terms
- [ ] Different interpretation needed — discuss before launch
- [ ] Not confirmed — live resale postponed until resolved

### 2. Organiser authorisation per event

Before any event can be published for resale, the platform requires documented evidence of permission:

- Event organiser identity and contact details (already captured in the `events` table).
- Evidence of permission to resell or distribute tickets (organisation reference, contract number, or email chain — stored in `authorization_ref`).
- Approved ticket categories and original prices.
- Approved resale prices or markup terms.
- Ticket transfer and refund conditions.
- Event date, venue, cancellation policy and inventory allocation.

**Question**: For each event you wish to offer on the platform, can you provide the authorisation reference (contract number, email, or similar evidence)?

### 3. Settlement arrangement for funds

The platform records commissions and totals but does **not** automatically split funds between MnM, organisers, and Afrika Digitalis. The agreed flow is:

- Customer pays KSh S (customer selling price) via M-Pesa or other method.
- Funds are received by MnM Juice Bar (as the reseller).
- MnM and AD commissions are tracked in the database for reconciliation.
- Actual settlement (transfer of organiser share, AD platform fee) is an **offline workflow** agreed between the parties.

**Question**: Has an approved settlement arrangement been established with your finance team and/or Afrika Digitalis for how and when commissions are transferred offline? If not, this must be documented before live sales.

### 4. M-Pesa merchant arrangements

For live M-Pesa Daraja integration:

- MPESA_SHORTCODE (Paybill/Till number)
- MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET (OAuth credentials)
- MPESA_PASSKEY (Daraja passkey for the shortcode)
- MPESA_CALLBACK_BASE (public HTTPS URL where Daraja will POST callbacks)
- MPESA_ENV (sandbox or production)

**Question**: Do you have an active M-Pesa Daraja merchant account and approved callback URL? If yes, credentials can be added to `.env` and the Daraja adapter will be activated. If no, the platform will operate in dev-simulator mode only.

### 5. Final product name and branding

- Working name: "MnM Tickets" (subject to your confirmation).
- Branding assets (logo, colours, photography): currently neutral and replaceable (logo/colours not verifiable from public socials). You may supply actual MnM Juice Bar logo/colours, or continue with the replaceable asset system.

**Question**: Confirm the product name and whether you wish to supply actual branding assets.

## What still needs external arrangement (blocked for live)

| Blocked item | Required before live | Current state |
|---|---|---|
| **M-Pesa Daraja live credentials** | MPESA_SHORTCODE, CONSUMER_KEY, CONSUMER_SECRET, PASSKEY, CALLBACK_BASE | Structure complete; live BLOCKED — dev simulator only |
| **Legal/compliance review** | Data protection, consumer protection, tax, ticketing obligations by qualified Kenyan advisers | Flagged in docs; not certified |
| **Organiser authorisation evidence** | Per-event authorisation_ref records | Must be recorded before each event publish |
| **Settlement arrangement** | Offline fund-split agreement with MnM/AD/organisers | Documented as offline workflow only |
| **Product name & branding confirmation** | Official name + logo/colours | Using placeholder until confirmed |

## Getting started: minimal setup steps

If you have M-Pesa credentials:

1. Add credentials to `.env` (see `.env.example`).
2. Run `npm run seed` to initialise the dev DB with sample data.
3. Run `npm run dev` to start the server at `http://localhost:8787`.
4. Log in as staff at `http://localhost:8787/staff/login` with the seeded development accounts below (these exist only in the local dev database created by `npm run seed`):

   | Role | Phone | Password |
   | --- | --- | --- |
   | Owner | `+254705687273` | `dev-owner-password` |
   | Manager | `+254700000002` | `dev-manager-password` |
   | Sales staff | `+254700000003` | `dev-staff-password` |
   | Gate scanner | `+254700000004` | `dev-scanner-password` |
   | AD platform admin | `+254700000005` | `dev-admin-password` |

   Use `http://localhost:8787` (not `127.0.0.1`): the origin allow-list is `PUBLIC_ORIGINS`, which defaults to `http://localhost:8787`, so sign-in and other state-changing forms are rejected from any other host.
5. Create your first event via `/staff/events` → fill form → publish.
6. Set pricing terms via the pricing table (or use the seed default: 3500 markup, 2500 MnM, 1000 AD points).
7. Test the customer journey: browse → checkout → dev simulator callback → ticket issued → verify with `/verify/<code>` → scan with `/staff/scan`.

If you do NOT have M-Pesa credentials yet:

1. Run `npm run seed` for sample data.
2. Use the dev simulator — every payment page clearly labels it as simulated.
3. Focus on event creation, ticket issuance, staff scanning, and commission verification.
4. M-Pesa integration can be added later when credentials are available.

## Communication and support

- **Platform contact (Afrika Digitalis)**: technical issues, deployment, dependency updates.
- **Business contact (MnM Juice Bar)**: event decisions, organiser authorisation, commercial terms, settlement.
- **Support ticket**: for reported issues, use the platform's internal logging (ad_admin console → audit trail).

## Next five actions

1. ✅ Confirm the 35/25/10 commercial interpretation (above).
2. [ ] Provide authorisation evidence per event to be offered.
3. [ ] Confirm or establish the settlement arrangement for funds.
4. [ ] Arrange M-Pesa Daraja merchant account or accept dev-simulator-only mode.
5. [ ] Supply or confirm branding (logo/colours) or continue with replaceable assets.

---

*This document is a living record. Update it whenever a decision is made or a new requirement emerges. The platform will not enable public sales until the outstanding items above are resolved to the owner's satisfaction.*