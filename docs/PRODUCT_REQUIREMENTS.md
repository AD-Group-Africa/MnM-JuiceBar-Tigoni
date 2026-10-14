# MnM Tickets — Product Requirements (v0.1)

**Product:** MnM Tickets — digital ticket vending and authorised event resale.
**Operator:** MnM Juice Bar, Kabuku (opposite St. Paul's University, near Jumuia), Limuru, Kenya. Public contact verified from the business's own profiles: +254 705 687 273.
**Platform by:** Afrika Digitalis (AD Group).

## Verified public brand (research 2026-10-14)

- Instagram https://www.instagram.com/mnm_juicebar/ — "Smoothie and Juicebar" & coffee; slogan **#MAGICINEVERYTASTE**; "Crafted in Tigoni"; "opp jumuia (St paul uni)"; contact 0705 687 273. 459 followers at time of access.
- Facebook https://www.facebook.com/p/MnM-smoothie-and-Juicebar-61575533087170/ — same description/slogan/Tigoni wording/phone; page title includes Limuru.
- TikTok @mnm_juice.bar exists but was **not readable** anonymously (bot challenge) — treat as inaccessible.
- No independent directory listing verified for the phone number (absence of evidence, not evidence of absence).
- Logo/colours/menu/reviews **not verifiable** from public page content — the platform therefore ships a neutral, replaceable visual identity (no invented logo, no stock photos presented as the shop).

## Roles

| Role | Can do |
|---|---|
| Visitor | browse on-sale events, view categories/prices, buy, view own tickets via signed link |
| scanner | scan/verify/redeem tickets at the gate (nothing else) |
| sales_staff | scanning + operational reports |
| manager | event/inventory management, orders, refunds initiation, terms changes (audit-logged) |
| owner | everything a manager can, on MnM side |
| ad_admin | platform admin: health, merchants, audit, cross-event ops (restricted PII access) |

## Commercial model

35% markup on original price — 25 pp MnM, 10 pp AD — implemented centrally in `src/money.ts`, snapshot per order, integer minor units, deterministic rounding. See PRICING_AND_COMMISSIONS.md. **Confirmation from the owner outstanding before live resale.**

## Delivery scope v0.1

1. Mobile-first storefront: home, events list, event detail, checkout (guest first), payment status, tickets page, my-tickets link, support contact.
2. Staff: dashboard, event CRUD, category/inventory management, orders, scan console, reports/exports.
3. AD admin: health, audit, platform totals.
4. Payments: dev simulator **plus a completed Daraja STK-push adapter structure** (live BLOCKED pending credentials/merchant setup).
5. Notifications: confirmation + payment + ticket channels with clear dev-adapter labelling.

## Non-goals (v0.1)

- Multi-organiser self-service onboarding; automated settlement/split payouts (manual reconciliation documented offline); offline QR scanning.
