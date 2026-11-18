# DRAFT — Website Development Agreement

**Between:** `[MNM LEGAL ENTITY / OWNER]` (“Client”)  
**And:** `[AD GROUP LEGAL ENTITY]` (“Supplier”)  
**Effective date:** `[TO BE AGREED]`  
**Status:** Template draft for legal review — not signed, no commercial terms agreed

> This is a drafting aid, not legal advice. The parties must have it reviewed by qualified counsel and complete every `[TO BE AGREED]` field before signature.

## 1. Definitions

- **Website** — the MnM Juice Bar customer storefront, catalogue, cart, checkout, order-status and related staff functions described in Schedule A.
- **Deliverables** — the software, documentation, test evidence and handover materials listed in Schedule A.
- **Acceptance Criteria** — the criteria in Schedule B.
- **Live Integrations** — M-Pesa, card, eTIMS, SMS, WhatsApp, email, banking and DNS services that require third-party approval.
- **Confidential Information** — non-public business, customer, credential and technical information.

## 2. Scope

The Supplier will deliver the Website and related documentation in accordance with Schedule A. Work outside Schedule A requires a written change request under clause 8.

The Supplier will preserve existing data and working functionality unless a change is expressly approved in writing.

## 3. Client responsibilities

The Client will:
- provide timely access to domains, hosting, accounts and decision-makers;
- approve content, prices, delivery zones, policies and refund rules;
- ensure it has authority to publish all event and business content;
- not ask the Supplier to activate a live financial integration without provider approval;
- maintain backups and account ownership as agreed.

## 4. Acceptance

The Supplier will provide test evidence and a staging URL. The Client will review within `[TO BE AGREED]` days and either accept, or list specific failures against the Acceptance Criteria. The Supplier will correct confirmed failures and resubmit. Acceptance is not deemed by silence unless expressly agreed in writing.

## 5. Fees and payment

| Item | Amount | Due |
|---|---|---|
| Development fee | `[TO BE AGREED]` | `[TO BE AGREED]` |
| Staging/handover | `[TO BE AGREED]` | `[TO BE AGREED]` |
| Expenses | `[TO BE AGREED]` | `[TO BE AGREED]` |

Late-payment interest, taxes and currency are `[TO BE AGREED]`.

## 6. Intellectual property

Ownership of the custom code, documentation, brand assets, domain, data and third-party licences is `[TO BE AGREED]`. The Supplier retains ownership of its pre-existing tools, libraries and know-how. No ownership transfer occurs until `[TO BE AGREED]`.

## 7. Data protection and confidentiality

Each party will protect confidential information and personal data using reasonable technical and organisational measures. The Client is responsible for the lawful basis for customer data and for privacy notices. Data location, retention, deletion and breach notification are `[TO BE AGREED]`.

## 8. Change control

A change request must state the change, reason, impact on scope, fee and timeline. No additional work is authorised until both parties approve it in writing.

## 9. Warranties and exclusions

The Supplier warrants that the Deliverables will materially conform to Schedule A for `[TO BE AGREED]` days after acceptance. The Supplier does not warrant third-party services, live payment approval, network availability or content supplied by the Client. All other warranties are `[TO BE AGREED]` to the extent permitted by law.

## 10. Limitation of liability

Liability caps, exclusions of indirect loss and carve-outs for fraud, wilful misconduct, data breach and unpaid fees are `[TO BE AGREED]`.

## 11. Term and termination

Term, termination for convenience, termination for breach, wind-down, data export and payment for work performed are `[TO BE AGREED]`.

## 12. Dispute resolution and governing law

Governing law, venue, escalation and mediation/arbitration are `[TO BE AGREED]`.

## 13. General

Notices, assignment, entire agreement, severability, force majeure and counterparts are `[TO BE AGREED]`.

## Schedule A — Deliverables

- Juice storefront and checkout.
- Staff product/order/delivery-zone management.
- Responsive customer pages.
- Security headers and robots rules.
- Test evidence and technical documentation.
- Handover and operations manual.

## Schedule B — Acceptance Criteria

1. `npm test` passes on the agreed commit.
2. Typecheck and build pass.
3. Staging home, menu, checkout, staff login and order-status flows pass the agreed smoke tests.
4. No P0 defect remains open except items expressly accepted by the Client.
5. Live integrations are clearly disabled and documented.

## Signatures

Client: `[NAME]` `[TITLE]` `[SIGNATURE]` `[DATE]`  
Supplier: `[NAME]` `[TITLE]` `[SIGNATURE]` `[DATE]`
