/**
 * Phase 2A regression coverage — sale windows and delivery minimums.
 *
 * Active tests cover behaviour that is enforced today and must not regress:
 *   - public listing/event detail only expose events inside the sale window;
 *   - a delivery order exactly at the zone minimum is accepted;
 *   - pickup is not subject to a delivery minimum;
 *   - closing a sale window does not invalidate already-issued tickets.
 *
 * Known-defect specifications live in tests/phase2a1/ and are run separately by
 * scripts/run-phase2a1-regressions.mjs. They are intentionally not skipped here:
 * the main suite must not present missing enforcement as covered.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.APP_SECRET_KEY = "test-secret-please-ignore-0123456789abcdef";
process.env.PAYMENT_PROVIDER = "dev";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mnm-phase2a-"));
process.env.DATABASE_FILE = path.join(tmp, "phase2a.sqlite");

const { migrate, run, queryOne } = await import("../src/db.ts");
const { createOrder } = await import("../src/orders.ts");
const { createJuiceOrder } = await import("../src/juice.ts");
const { recordInitiated, handleCallback } = await import("../src/payments/index.ts");
const { verifyTicket } = await import("../src/tickets.ts");
const { onSaleEvents } = await import("../src/routes/public.tsx");
const { createApp } = await import("../src/app.tsx");
const { loadConfig } = await import("../src/config.ts");

const BASE = "http://localhost:8787";
const NOW = Date.now();
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

let openEventId = 0;
let openCategoryId = 0;
let productId = 0;
let zoneId = 0;

function insertEvent(slug: string, saleStart: string | null, saleEnd: string | null): number {
  return Number(run(
    `INSERT INTO events(slug,title,venue_name,venue_area,starts_at,organizer_name,organizer_contact,
                        authorization_ref,authorized_by_user,authorized_at,sale_starts_at,sale_ends_at,status,created_by)
     VALUES (?,?,'Test Hall','Limuru',?,'Test Organiser','+254700000000','AUTH-PHASE2A',1,?,?,?,'on_sale',1)`,
    [slug, `Event ${slug}`, iso(7 * 86_400_000), iso(0), saleStart, saleEnd],
  ).lastInsertRowid);
}

function insertCategory(eventId: number, priceMinor = 100_000): number {
  return Number(run(
    "INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (?,?,?,?)",
    [eventId, `Tier ${eventId}-${Date.now()}-${Math.random().toString(36).slice(2)}`, priceMinor, 10],
  ).lastInsertRowid);
}

before(async () => {
  migrate(process.env.DATABASE_FILE!);
  run("INSERT INTO pricing_terms(label,markup_points,mnm_points,ad_points,currency,active) VALUES ('phase2a',3500,2500,1000,'KES',1)");
  run("INSERT INTO users(full_name,phone,role,password_hash) VALUES ('Phase 2A Owner','+254700000040','owner','scrypt$aa$bb')");

  // All timestamps are explicit UTC ISO strings, matching what the staff form
  // persists via new Date(...).toISOString().
  openEventId = insertEvent("phase2a-open", iso(-60 * 60_000), iso(60 * 60_000));
  insertEvent("phase2a-future", iso(60 * 60_000), iso(120 * 60_000));
  insertEvent("phase2a-closed", iso(-120 * 60_000), iso(-60 * 60_000));
  openCategoryId = insertCategory(openEventId);

  const category = Number(run("INSERT INTO product_categories(name) VALUES ('Phase 2A Category')").lastInsertRowid);
  productId = Number(run(
    `INSERT INTO products(category_id, sku, name, description, price_minor, available)
     VALUES (?, 'P2A-MIN', 'Phase 2A Juice', 'Minimum-order test', 15000, 1)`,
    [category],
  ).lastInsertRowid);
  zoneId = Number(run(
    "INSERT INTO delivery_zones(name, description, fee_minor, min_order_minor, enabled, sort_order) VALUES ('Phase 2A Zone','Test',5000,30000,1,1)",
  ).lastInsertRowid);
});

after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

const config = loadConfig(process.env);
const app = createApp(config);

test("sale window: public listing exposes only the currently open event", () => {
  const slugs = onSaleEvents().map((e) => e.slug);
  assert.ok(slugs.includes("phase2a-open"), "open event must be listed");
  assert.ok(!slugs.includes("phase2a-future"), "not-yet-open event must not be listed");
  assert.ok(!slugs.includes("phase2a-closed"), "closed event must not be listed");
});

test("sale window: closed and not-yet-open event pages return 404", async () => {
  for (const slug of ["phase2a-future", "phase2a-closed"]) {
    const res = await app.request(new URL(`/events/${slug}`, BASE).toString());
    assert.equal(res.status, 404, `${slug} must not be purchasable through the public page`);
  }
  const open = await app.request(new URL("/events/phase2a-open", BASE).toString());
  assert.equal(open.status, 200, "the open event page must still render");
});

test("sale window: closing the window does not invalidate an already-issued ticket", () => {
  const res = createOrder({ categoryId: openCategoryId, qty: 1, customerName: "Paid Buyer", customerPhone: "0712345678" });
  assert.equal(res.ok, true, res.msg);
  const order = queryOne("SELECT order_ref, total_minor, currency FROM orders WHERE id=?", [res.orderId!])!;
  const prid = `PHASE2A-CLOSE-${res.orderId}`;
  recordInitiated(res.orderId!, "dev", prid, Number(order.total_minor), String(order.currency), "+254712345678");
  const cb = handleCallback({
    provider: "dev",
    providerRequestId: prid,
    outcome: "succeeded",
    amountMinor: Number(order.total_minor),
    currency: String(order.currency),
  });
  assert.equal(cb.ok, true, cb.detail);

  run("UPDATE events SET sale_ends_at=? WHERE id=?", [iso(-60_000), openEventId]);
  const ticket = queryOne("SELECT ticket_code FROM tickets WHERE order_id=? LIMIT 1", [res.orderId!])!;
  const verification = verifyTicket(String(ticket.ticket_code));
  assert.equal(verification.ok, true, "issued tickets survive a sale-window close");
});

test("delivery minimum: an order exactly at the minimum is accepted with the zone fee", () => {
  const res = createJuiceOrder({
    items: [{ productId, qty: 2 }],
    type: "delivery",
    deliveryZoneId: zoneId,
    customerName: "At Minimum",
    customerPhone: "+254722222222",
    deliveryAddress: "Test Street",
  });
  assert.equal(res.ok, true, res.msg);
  const row = queryOne("SELECT subtotal_minor, delivery_fee_minor, total_minor FROM juice_orders WHERE id=?", [res.orderId!])!;
  assert.equal(Number(row.subtotal_minor), 30_000);
  assert.equal(Number(row.delivery_fee_minor), 5_000);
  assert.equal(Number(row.total_minor), 35_000);
});

test("delivery minimum: pickup below the delivery minimum remains allowed", () => {
  const res = createJuiceOrder({
    items: [{ productId, qty: 1 }],
    type: "pickup",
    customerName: "Pickup Customer",
    customerPhone: "+254733333333",
  });
  assert.equal(res.ok, true, res.msg);
  const row = queryOne("SELECT delivery_fee_minor, total_minor FROM juice_orders WHERE id=?", [res.orderId!])!;
  assert.equal(Number(row.delivery_fee_minor), 0);
  assert.equal(Number(row.total_minor), 15_000);
});
