# M&M Juice Bar Tigoni — Demo Notes & Known Limitations

Prepared for the November 11, 2026 presentation.

## What is real

- **Business identity** — M&M Juice Bar, Kabuku, Limuru (opposite St. Paul's University).
  Phone, address, Instagram and Facebook details are the owner's actual contact points.
- **Menu catalogue** — 18 drinks and snacks across 5 categories, with pricing in KES.
- **Order flow** — browse → cart → checkout → order reference, with pickup and delivery options.
- **Ticketing system** — event listing, ticket purchase, QR generation, QR verification, scan audit trail.
- **Staff dashboards** — orders, products, reviews, delivery zones, catering enquiries.
- **Test suite** — 74 of 74 automated tests pass (money, orders, QR, tickets, HTTP, storefront).
- **TypeScript typecheck** — clean under strict mode.

## What is simulated

- **Payments** — the payment adapter is set to `dev`, a clearly-labelled simulator.
  No real M-Pesa, no real card processing, no real money moves. Real Daraja integration
  requires merchant credentials that are not configured.

## Known limitations to disclose

- **Persistence on free hosting** — the deployed demo runs on a free tier where the local
  SQLite database file resets on restart. Menu, prices, and settings regenerate from
  migrations on each boot; test orders created during the demo are lost on restart.
  This is a hosting-tier constraint, not an application design choice.
- **Menu items** — the 18 products are seed data drawn from a realistic sample.
  The owner should confirm the final live menu before going to real customers.

## Recommended demo script (5–8 minutes)

1. **Home page** — hero, categories, featured drinks.
2. **Menu** — pick a category (Fresh Juices), click a product, see detail.
3. **Order flow** — add to cart, go to cart, enter test name + phone, choose pickup, submit.
   Capture the order reference.
4. **Payment simulation** — complete the simulated payment; order shows as paid.
5. **Events & tickets** — /events, pick an event, buy a ticket (simulated), land on ticket page.
6. **QR** — show QR on ticket. Open verify URL, show "valid". Re-scan to prove "already redeemed".
7. **Staff view** — log in (seed credentials from `npm run seed`), show dashboard, orders, products.

## Before launch (owner actions)

- [ ] Confirm live menu items, prices, availability.
- [ ] Obtain M-Pesa Daraja merchant credentials OR accept ongoing simulation.
- [ ] Provide final logo asset and hero photography.
- [ ] Configure M&MJuiceBar.co.ke domain at the hosting provider.
- [ ] Add a persistent disk (Render Starter + Disk) to retain order history.