# DRAFT — Intellectual Property, Data Ownership and Retention

**Status:** Discussion draft. Not an agreement, not a legal opinion. Every
commercial term below is a proposal for the parties to negotiate.
**Date:** 18 November 2026
**Parties (proposed):** MnM Juice Bar (Client/Operator) and Afrika Digitalis /
AD Group (Supplier)

## 1. Purpose

The other drafts refer to intellectual property, data ownership and retention
as `[TO BE AGREED]`. This document proposes how to split those topics so the
split can be reviewed deliberately rather than inferred from the code.

## 2. What exists today

Three categories of material are present in the repository:

1. **MnM-specific deliverables** — the juice storefront and its content model,
   the ticketing flows built for MnM events, MnM branding, menus, prices,
   illustrations and the operating documentation written for this client.
2. **AD Group reusable components** — the platform patterns the Supplier
   applies to more than one client: commission and money handling, payment
   provider abstraction and callback verification, QR ticket issuance and scan
   console, session/auth helpers, migration and test harness, documentation
   templates.
3. **Third-party material** — open-source dependencies (Hono, the Node SQLite
   driver, TypeScript tooling) under their own licences, and provider APIs
   (Safaricom Daraja and others) under the providers' terms.

The repository does not currently mark which files belong to which category.
That marking is a proposed pre-handover task (section 6).

## 3. Proposed IP position (for negotiation)

| Item | Proposal |
|---|---|
| MnM-specific deliverables | Assign to the Client on final payment, subject to section 4 |
| AD Group reusable components | Remain Supplier property; Client receives a perpetual, non-exclusive licence to use them as part of the delivered system |
| Brand assets supplied by the Client | Client retains ownership; Supplier uses them only to deliver and support the system |
| Third-party dependencies | Governed by their own licences; no ownership is transferred |
| Documentation written for this engagement | Client may use, copy and share internally; public publication requires agreement |
| Domain, hosting and provider accounts | Client-owned accounts in the Client's name, wherever the provider allows it |

Any transfer is proposed to occur only on final payment and written acceptance,
and only for the MnM-specific category.

## 4. Proposed licence terms for reusable components

- Perpetual, worldwide, royalty-free for running this system.
- Includes modification and maintenance by the Client or a third party.
- Excludes resale, sublicensing or redistribution of the reusable components as
  a standalone product.
- Survives termination of the support agreement.

Exact wording, warranties and liability remain `[TO BE AGREED]`.

## 5. Data ownership, privacy and retention (proposal)

**Ownership.** The Client owns its business data: products, prices, events,
orders, tickets, customers, staff accounts, reviews, enquiries and settlement
records. The Supplier holds it only to operate and support the system.

**Access.** The Supplier accesses production data only for support, with the
Client's approval, least privilege and an audit trail. Access ends when the
engagement ends.

**Location.** The deployment target is a single hosted instance with a
persistent disk. The specific hosting region, and whether data leaves Kenya,
is `[TO BE AGREED]` and matters for Kenya Data Protection Act 2019 compliance.

**Personal data.** The system stores customer names, phone numbers, optional
email, delivery details, hashed passwords and order history. Staff accounts
hold names, roles and hashed passwords. Ticket scans record redemption events.
The Client is the data controller and must publish a privacy notice covering
purpose, lawful basis, retention and data-subject contact.

**Retention (proposal).**

| Data | Proposed retention | Rationale |
|---|---|---|
| Orders, payments, refunds, settlement records | 7 years | Tax and accounting evidence |
| Tickets and scan logs | 2 years after the event | Dispute and fraud review |
| Customer accounts and order history | Until deletion request, then anonymised | Data minimisation |
| Delivery addresses and phone numbers | 2 years after last order | Fulfilment and disputes |
| Reviews and enquiries | Until withdrawn or 3 years | Business record |
| Application and access logs | 90 days | Security investigation |
| Database backups | 30 days rolling | Recovery window |

Final periods are `[TO BE AGREED]` with the Client's accountant.

**Deletion and export.** On request, the Client can receive an export of its
data (the database file plus CSV exports) and can request deletion of personal
data that is not under a legal retention obligation. A documented export and
deletion procedure is proposed as a pre-handover deliverable.

**Breach handling.** The Supplier notifies the Client without undue delay after
confirming a breach affecting Client data; the Client handles regulator and
data-subject notification. Notification windows are `[TO BE AGREED]`.

**No analytics or third-party tracking** is embedded in the current build.
Notification adapters default to console output, so no customer data is sent to
an SMS, WhatsApp or email provider until one is approved and configured.

## 6. Proposed pre-handover tasks

1. Add a file-level map of MnM-specific versus reusable code, and a licence
   header or manifest for the reusable set.
2. Publish a privacy notice and retention schedule consistent with section 5.
3. Document the data export and deletion procedure and test it once.
4. Confirm hosting region and cross-border data position.
5. Confirm account ownership for hosting, domain, payments and messaging.
6. Record the agreed retention periods in the operations manual.

## 7. Explicit non-commitments

This draft does not create an assignment, a licence, a retention obligation or
a data-processing agreement. Nothing here overrides the executed agreements, if
any exist. Prices, fees and revenue shares are deliberately absent and are
covered — still as proposals — in documents 05 and 06.
