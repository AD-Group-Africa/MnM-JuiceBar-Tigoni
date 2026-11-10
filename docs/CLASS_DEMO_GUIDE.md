# M&M Juice Bar / MnM Tickets — class demonstration guide

**Audience:** Harrison (presenter)
**Purpose:** run the existing application confidently for a 5–7 minute class demo
**Status of this build:** class-demo ready in development mode. It is **not** a commercial launch.

> ## Read this before you present
>
> * **Payments are simulated.** The app runs with `PAYMENT_PROVIDER=dev`. The moment you click *Buy*, a local
>   simulator settles the order and issues a ticket. No M-Pesa prompt is sent, no money moves, no card is charged.
>   The order-status and ticket pages display a yellow banner saying exactly that — point at it and say it out loud.
> * **The menu, prices, events and customers are demonstration data.** Products are seeded samples, product art is
>   labelled `SAMPLE IMAGE`, events are titled `SAMPLE EVENT … (dev seed)`, and customers are `Sample Customer — …`.
> * **No authentic photographs are loaded yet.** The homepage gallery shows deliberate "photographs coming soon"
>   placeholders because the owner has not supplied real photos. Do not describe the placeholder art as real drinks.
> * **There is one dev database file** (`data/mnm-dev.sqlite`). Nothing here touches a production system.

---

## 1. Start the demo (about one minute)

Requirements: **Node.js 24** (`node -v`), and dependencies already installed in this checkout
(`node_modules/` is present). The project uses npm — do **not** switch to pnpm or bun here.

```bash
cd "C:\Users\thrillerpark\Desktop\Flagship Projects\MnM Juice Bar"
npm run dev
```

Expected console output:

```
[config] APP_SECRET_KEY missing — using a throwaway development secret (DEV ONLY).
[mnm-tickets] listening on http://127.0.0.1:8787 (env=development, payments=dev)
```

**Open exactly this URL:** <http://localhost:8787>

> Use **`localhost`**, not `127.0.0.1`. State-changing forms (sign-in, checkout, order updates, scanning) are
> protected by an exact-origin check against `PUBLIC_ORIGINS`, which defaults to `http://localhost:8787`.
> On `127.0.0.1` those forms answer **"Invalid request origin."** — that is the security control working, not a bug.

Before you present, do one **hard refresh** in the browser (`Ctrl + Shift + R`). Development responses are sent with
`Cache-Control: no-store` and stylesheet URLs carry a version stamp, but a tab that has been open since before the
last edits can still hold an older stylesheet.

**Health check (optional, in a second terminal):**

```bash
curl http://localhost:8787/health
# {"ok":true,"service":"mnm-tickets","time":"..."}
```

**To stop:** press `Ctrl + C` in the terminal running `npm run dev`.

---

## 2. Who to sign in as

The local database was seeded with development accounts. These are **dev-only fixtures**, not production credentials.

| Role | Phone | Password | Can reach |
| --- | --- | --- | --- |
| Owner | `+254705687273` | `dev-owner-password` | everything, including `/admin` |
| Manager | `+254700000002` | `dev-manager-password` | dashboard, events, orders |
| Sales staff | `+254700000003` | `dev-staff-password` | dashboard, orders |
| Gate scanner | `+254700000004` | `dev-scanner-password` | **only** `/staff/scan` (sign-in drops them straight there) |
| AD platform admin | `+254700000005` | `dev-admin-password` | everything, including `/admin` |

Sign in at <http://localhost:8787/staff/login>. The footer link **Staff sign-in** also works.

> Sessions are signed with a throwaway secret generated at boot, so **restarting the server signs everyone out**.
> That is expected: log in again after a restart.

---

## 3. The 5–7 minute walkthrough

Keep the browser at desktop width for the first half; it also holds up at 375 px if you want to show mobile.

| Time | Do this | Expected result | Say this |
| --- | --- | --- | --- |
| 0:00 | Open `http://localhost:8787` | Homepage: headline, hero fallback, "What we do" photo placeholders, menu categories | "Storefront and ticketing share one brand and one codebase." |
| 0:40 | Click **Menu** (`/menu`) | 16 available products in 7 categories (19 seeded in total), each with sample art and a **SAMPLE IMAGE** tag | "Illustrations are placeholders; the pipeline for real photos is built." |
| 0:55 | Click **Add to order** on two cards | Button flashes "Added!", **Your order** counter increments | "Cart state persists across pages." |
| 1:10 | Click **Your order** | Cart with both items, size, quantity stepper, delivery/pickup toggle, delivery zones with fees | "Totals are recalculated on the server at checkout." |
| 1:30 | Choose **Delivery** *without* picking a zone, then **Proceed to checkout** | Checkout page; trying to submit shows the zone field as required | "Client and server both refuse a delivery order with no zone." |
| 1:45 | Switch back to **Pickup**, fill name + phone, click **Place order** | Confirmation page with an order reference (`MNM-J-…`), status "New — awaiting confirmation" | "The order is written to the database; staff see it immediately." |
| 2:30 | Open `http://localhost:8787/staff` and sign in with the **owner** account | Dashboard: paid orders, revenue, pending, sales-by-event with the MnM/AD split | "One dashboard for juice orders and ticket sales." |
| 2:50 | **Orders** → open the newest juice order → set status to *Accepted* → **Update status** | Status changes; the next-status dropdown moves to *Being prepared* | "Order lifecycle is enforced server-side." |
| 3:15 | Click **Events & Tickets** (`/events`) → open **Limuru Pool Party** | Event page with venue, organiser, and the transparent price breakdown (organiser price + MnM commission + platform fee) | "Fees are shown per ticket before purchase." |
| 3:40 | Fill name + phone, quantity 1, click **Buy** | Order status page: **"Asante! Your tickets are ready"**, with the yellow *Development payment simulator* banner | "This is the simulator; a live M-Pesa prompt is not being sent." |
| 4:05 | Click **View tickets** | Ticket card with QR code and a code such as `FGQ5K4-JPAZSK`, status `valid` | "The QR encodes a verification URL, not personal data." |
| 4:40 | Open `/staff/scan`, enter that code, submit | Green **ADMIT** with event, venue, start time and audit entry | "Redemption is server-side and audited." |
| 5:00 | Click **Scan next ticket**, enter the **same** code again | Red **DO NOT ADMIT — this ticket was already used** | "One ticket, one entry. Duplicate scans are rejected." |
| 5:25 | Return to the dashboard | Revenue and commission figures ticked up by the demo ticket | "Commission split is computed from the order, not typed in." |
| 5:50 | Finish | — | "Real payments, real photos, organiser agreements and legal review are the remaining launch gates." |

### Optional extras if you have time

* **Catering enquiry:** `/catering` → fill the form → confirmation with an enquiry reference (`MNM-C-…`), then find it
  at the top of *Staff → Catering* with status filters and an inline status update.
* **Mobile:** narrow the window to ~375 px. The cart table drops the add-ons and line-total columns (the summary below
  keeps every total), and the event grid becomes a single column.
* **Ticket verification without redeeming:** open `/verify/<code>/view` (read-only "VALID TICKET" page).

---

## 4. Demonstrating the simulated payment paths honestly

| Behaviour | How to show it |
| --- | --- |
| **Success** (default) | `PAYMENT_PROVIDER` unset → `dev`. Every purchase settles instantly and says so. |
| **Failure** | Start a second, temporary instance with the simulator forced to decline — see below. |

Failure-mode run (uses the same local database; creates one failed order and **no** tickets):

```bash
# in a second terminal, with the main server still running
PAYMENT_DEV_FORCE_STATUS=failure PORT=8788 PUBLIC_ORIGINS=http://localhost:8788 npm run start
```

Open <http://localhost:8788/events>, buy a ticket, and the status page shows `payment_failed` with
"This order is payment failed." Confirm in the staff dashboard that **paid orders did not increase** and the ticket
count did not increase. Stop it afterwards:

```bash
# find and stop the listener on 8788 (do not touch 8787)
netstat -ano | grep ":8788" | grep LISTENING
taskkill //PID <that-pid> //F
```

Do **not** set `PAYMENT_PROVIDER=daraja` for the class demo: there are no live Safaricom credentials in this checkout,
and `NODE_ENV=production` + `daraja` without credentials refuses to boot by design.

---

## 5. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Invalid request origin.` on sign-in or checkout | You are on `127.0.0.1` (or another host/port) | Use `http://localhost:8787` |
| "Wrong phone or password." | Typo, or the account is a test-fixture account (`+254700000020` / `ownerpw` exists only in the automated test database) | Use the table in §2 |
| Page looks unstyled / old design | Stale browser cache | `Ctrl + Shift + R` |
| `EADDRINUSE :8787` | A previous server is still running | Close the other terminal, or `netstat -ano | grep ":8787"` then `taskkill //PID <pid> //F` |
| Every staff page bounces to sign-in | Server was restarted (sessions are in-memory) | Sign in again |
| Cart appears empty after opening `/cart` directly | The cart lives in `sessionStorage`; a pasted `/cart` URL with no items and no stored cart is genuinely empty | Add an item from the menu, then use **Your order** |
| Checkout says "Please choose a delivery zone" | Delivery selected; zone required | Select a zone or switch to Pickup |
| Database locked / slow | Something else has the SQLite file open | Stop extra servers (e.g. the 8788 failure-mode instance) |

---

## 6. Protect the demo data

Back up the local database **before** presenting (a consistent snapshot; verified against this database):

```bash
node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('data/mnm-dev.sqlite').exec(\"VACUUM INTO 'data/mnm-backup.sqlite'\")"
```

Restore only if something goes badly wrong, and only with the server stopped:

```bash
# 1. stop the server (Ctrl+C)
# 2. keep the broken copy, then put the backup in place
mv data/mnm-dev.sqlite data/mnm-dev.broken.sqlite
mv data/mnm-backup.sqlite data/mnm-dev.sqlite
# 3. remove the stale write-ahead log so the restored file is what gets read
rm -f data/mnm-dev.sqlite-wal data/mnm-dev.sqlite-shm
npm run dev
```

That restores everything **as of the backup** — anything created afterwards is lost. Never run this mid-demo.
Do **not** run `npm run seed` or delete the `data/` folder to "clean up": the seeded dataset is the demo.

The database currently contains the seeded demo dataset plus a handful of verification runs made while preparing this
guide (`Sample Customer — Demo Run`, `Demo Two`, `Catering Check`, one `Origin Check` order, and one issued ticket that
is already redeemed). They are harmless and clearly labelled; leave them.

---

## 7. Known limitations to state if asked

1. **Payments are simulated** (`PAYMENT_PROVIDER=dev`). Daraja STK Push is implemented behind the same provider
   interface but has never been run against Safaricom sandbox from this checkout — no credentials, shortcode,
   passcode or public callback URL are configured.
2. **No authentic photography.** Product art is a generated sample illustration; the homepage gallery and hero use
   branded placeholders until the owner supplies photos (`npm run images` regenerates the sample art if needed).
3. **Notifications are not delivered.** Email/SMS adapters are `console` only: they log an attempt and record it, and
   the UI does not claim delivery.
4. **Ordering is pickup/delivery with payment on collection** for juice orders — the juice storefront never marks an
   order paid without a verified provider callback.
5. **Single-node SQLite.** Fine for a laptop demo; not a multi-instance production database.
6. **No image upload.** Product photos are files under `public/menu/` referenced from `product_images.storage_path`;
   adding photos currently means placing files and updating those rows.

---

## 8. Not part of the demo — commercial launch blockers

These are deliberately **not** solved by this build and should be described as outstanding work:

* Live Daraja/M-Pesa credentials, shortcode, passkey, public HTTPS callback URL, and a tested reconciliation run.
* Written organiser authorisation to sell tickets, and approved refund/cancellation/transfer rules.
* Approved settlement terms for the MnM commission / Afrika Digitalis platform fee (the code computes a split; that is
  not a signed agreement).
* Final brand assets (logo, fonts, photography) and confirmation of the public trading name.
* Terms of service, privacy notice, and Kenyan consumer/tax/data-protection review.
* Production hosting, backups, monitoring, rate limiting at the edge, and an incident procedure.

See `docs/PILOT_READINESS.md`, `docs/SECURITY_AND_PRIVACY.md` and `docs/PAYMENTS_AND_RECONCILIATION.md` for the fuller
list.
