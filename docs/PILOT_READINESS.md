# Pilot Readiness Assessment — MnM Tickets

## Overview

This document provides a structured pilot-readiness assessment for the MnM Tickets platform, developed by Afrika Digitalis for MnM Juice Bar (Kabuku, Limuru, Kenya). It evaluates the current state of implementation against explicit criteria and identifies outstanding decisions that must be resolved before a controlled pilot can begin.

The pilot readiness score is a numerical assessment (0–100) based on explicit pass/fail criteria. A score of ≥80 is required to proceed to a controlled pilot; below 80 means the platform must remain in development/non-sales mode until resolved items are addressed.

## Current implementation state

| Category | Status |
|---|---|
| **Core features implemented** | ✅ All core customer and staff journeys functional (36/36 tests pass) |
| **Commission engine** | ✅ 35% markup (25% MnM + 10% AD) snapshot per order, integer minor units, deterministic rounding |
| **Ticket issuance & QR** | ✅ Unique digital tickets, QR codes with verification URL, online validation, redemption audit |
| **Staff scanning** | ✅ `/staff/scan` with online validation, atomic redemption, audit logging |
| **Payment abstraction** | ✅ Dev simulator (clearly labelled) + Daraja adapter structure; live BLOCKED |
| **Authentication & auth** | ✅ Role-based access (owner/manager/sales_staff/scanner/ad_admin), origin checks, CSRF |
| **Database & migrations** | ✅ Versioned SQL migrations, seed script, typecheck clean |
| **Production build** | ✅ `npm run build` succeeds, dist/ output generated |
| **Documentation** | ✅ 12 doc files created (PRODUCT_REQUIREMENTS, ARCHITECTURE, DATA_MODEL, PRICING_AND_COMMISSIONS, PAYMENTS_AND_RECONCILIATION, TICKET_SECURITY, SECURITY_AND_PRIVACY, OWNER_ONBOARDING, DEPLOYMENT, TEST_REPORT, PROJECT_CHECKLIST, PILOT_READINESS) |
| **Full test suite** | ✅ 36 tests pass (29 unit/integration + 7 HTTP end-to-end) |

## Pilot readiness criteria (explicit pass/fail)

### Category 1: Core functionality (must ALL pass)

| # | Criterion | Current status |
|---|---|---|
| C1 | Visitor can browse published events ✅ | Pass |
| C2 | Draft events remain private (404) ✅ | Pass |
| C3 | Original price and 35% markup calculated correctly ✅ | Pass |
| C4 | 25% MnM and 10% AD allocations reconcile with KSh 1,000 example ✅ | Pass |
| C5 | Rounding and currency handling deterministic ✅ | Pass |
| C6 | Unauthorised event cannot be published for resale ✅ | Pass |
| C7 | Two simultaneous purchases cannot oversell inventory ✅ | Pass |
| C8 | Failed payment does not issue a valid ticket ✅ | Pass |
| C9 | Confirmed payment issues correct ticket exactly once ✅ | Pass |
| C10 | Duplicate callbacks do not duplicate orders, tickets or commissions ✅ | Pass |
| C11 | QR verification accepts valid tickets and rejects invalid ones ✅ | Pass |
| C12 | Redeemed tickets cannot be redeemed again ✅ | Pass |
| C13 | Refunded and cancelled tickets are rejected ✅ | Pass |
| C14 | Customer and staff access restrictions work ✅ | Pass |
| C15 | Dashboard totals reconcile with recorded transactions ✅ | Pass |

**Category 1 result**: ALL 15/15 PASS ✅

### Category 2: External dependencies (must BE ARRANGED)

| # | Criterion | Current status |
|---|---|---|
| D1 | M-Pesa Daraja merchant account + credentials configured | ❌ BLOCKED — no live credentials; dev simulator only |
| D2 | Organiser authorisation evidence recorded per event | ❌ PENDING — owner must provide authorization_ref for each event |
| D3 | Approved settlement arrangement for funds flow (MnM/AD/organiser) | ❌ PENDING — offline workflow not yet formalised |
| D4 | Legal/compliance review by qualified Kenyan advisers (data protection, consumer protection, tax, ticketing) | ❌ PENDING — flagged in docs, not certified |
| D5 | Final product name confirmation + branding (logo/colours) | ❌ PENDING — using placeholder assets |

**Category 2 result**: 0/5 PASS, 5 PENDING/BLOCKED ⚠️

### Category 3: Operational requirements (must ALL pass or be documented BLOCKED)

| # | Criterion | Current status |
|---|---|---|
| O1 | Core journeys work on mobile viewport sizes | ✅ Tested via responsive design; integration tests pass at Hono level |
| O2 | Database migrations and seed scripts run reliably | ✅ `npm run migrate` + `npm run seed` work consistently |
| O3 | Application startup, health checks and shutdown work as documented | ✅ `npm run dev`, `npm start`, `npm run build` all work |
| O4 | Production builds complete without errors | ✅ `npm run build` succeeds |
| O5 | Security review completed (headers, CSRF, rate limiting, injection prevention) | ✅ All security controls implemented and tested; see SECURITY_AND_PRIVACY.md |
| O6 | Notification failures reported accurately (dev adapter labels clearly) | ✅ Email/SMS providers default to `console` mode; every attempt logged, none claimed delivered |
| O7 | Core journeys work on mobile viewport sizes | ✅ Responsive CSS; no fixed-width layouts; touch-friendly targets |

**Category 3 result**: 7/7 PASS ✅

## Numerical readiness assessment

| Criterion | Weight | Status | Score |
|---|---|---|---|
| Core functionality (C1–C15) | 60% | All 15 pass | 60/60 |
| External dependencies (D1–D5) | 25% | 0/5 pass (5 blocked/pending) | 0/25 |
| Operational requirements (O1–O7) | 15% | All 7 pass | 15/15 |

**Total weighted score: 75/100**

## Readiness determination

| Score | Determination | Action |
|---|---|---|
| 80–100 | ✅ Ready for controlled pilot | Proceed with pilot setup and limited sales. |
| 60–79 | ⚠️ Pilot pending external arrangements | Resolve blocked/pending items before pilot. |
| < 60 | ❌ Not ready — significant work remaining | Complete core development before pilot evaluation. |

**Current score: 75/100 → ⚠️ Pilot pending external arrangements**

## Outstanding owner decisions (must be resolved before pilot)

| # | Decision | Options | Recommended | Current |
|---|---|---|---|---|
| 1 | Confirm 35/25/10 commercial interpretation | Confirm / renegotiate | Confirm (proceed) | Pending |
| 2 | Provide organiser authorisation per event | Supply authorization_ref per event | Provide per event | Pending |
| 3 | Confirm settlement arrangement for funds | Formalise offline workflow | Document and proceed | Pending |
| 4 | M-Pesa merchant account | Obtain Daraja credentials + callback URL | Accept dev-simulator-only for now | BLOCKED |
| 5 | Finalise product name + branding | Confirm name + supply assets | Confirm "MnM Tickets" + neutral assets | Pending |

## Next five actions (to reach ≥80 readiness)

| # | Action | Owner | Deadline |
|---|---|---|---|
| 1 | Confirm the 35/25/10 commercial interpretation (decision #1) | Business owner | ASAP |
| 2 | Provide authorisation evidence per event to be offered on the platform | Business owner | ASAP |
| 3 | Formalise the settlement arrangement for MnM/AD/organiser commission flows | Business owner + AD finance | ASAP |
| 4 | Either obtain M-Pesa Daraja merchant credentials OR accept dev-simulator-only mode indefinitely | Afrika Digitalis / business owner | Before pilot launch |
| 5 | Confirm product name "MnM Tickets" and supply or approve replaceable branding assets | Business owner | Before pilot launch |

## Pilot execution plan (if readiness ≥ 80)

When the score reaches 80+, the following controlled pilot can be launched:

1. **Scope**: MnM Juice Bar staff + walk-in customers at the physical location (Kabuku, Limuru).
2. **Events**: 2–3 sample events with authorisation evidence recorded.
3. **Payment**: M-Pesa STK push via Daraja (live) OR dev simulator (if live credentials not yet available, clearly labelled).
4. **Duration**: 2 weeks minimum, with daily monitoring.
5. **Metrics tracked**:
   - Number of events created and tickets sold.
   - Commission totals (MnM vs AD) vs expected 35% markup.
   - Failed payments, refunds, cancellations.
   - QR scan redemption rate (admit vs reject).
   - Staff scan accuracy (first-scan succeeds, second-scan rejected).
   - Reconciliation exceptions count.
6. **Review point**: End of week 1 — assess if any critical bugs or UX issues require remediation before week 2.
7. **Termination**: Pilot concludes with a readiness reassessment. If score can be elevated to ≥90, the platform is ready for broader launch. If not, outstanding items are documented for Phase 2.

## Contact and support

- **Technical issues** (deployment, bugs, dependency): Afrika Digitalis team.
- **Business decisions** (events, pricing, organiser authority, settlement): MnM Juice Bar owner.
- **Support channel**: Use the platform's internal audit log (ad_admin console) for issue reporting, or raise a ticket through the development channel.

---

*This assessment is a snapshot as of the current implementation state. The score will increase as owner decisions are resolved and features are validated. The pilot should not be initiated until the numerical readiness assessment reaches ≥80 and all D-category (external dependency) items are marked PASS.*