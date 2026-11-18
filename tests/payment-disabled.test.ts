/**
 * Payment-disabled production behaviour.
 *
 * Starts the real Hono app with NODE_ENV=production and PAYMENT_PROVIDER=disabled.
 * No provider network calls are made and no payment success can be fabricated.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mnm-disabled-"));
const databaseFile = path.join(tmp, "disabled.sqlite");
const baseOrigin = "https://tickets.example.test";
process.env.DATABASE_FILE = databaseFile;

const { migrate, run, queryOne } = await import("../src/db.ts");
const { createApp } = await import("../src/app.tsx");
const { loadConfig } = await import("../src/config.ts");
const { availableFor } = await import("../src/routes/public.tsx");

const config = loadConfig({
  NODE_ENV: "production",
  PAYMENT_PROVIDER: "disabled",
  APP_SECRET_KEY: "disabled-mode-secret-0123456789abcdef",
  DATABASE_FILE: databaseFile,
  PUBLIC_ORIGINS: baseOrigin,
});

before(() => {
  migrate(config.databaseFile);
  run("INSERT INTO pricing_terms(label,markup_points,mnm_points,ad_points,currency,active) VALUES ('t',3500,2500,1000,'KES',1)");
  run("INSERT INTO users(full_name,phone,role,password_hash) VALUES ('Owner','+254700000099','owner','test-only')");
  run(
    `INSERT INTO events(slug,title,venue_name,venue_area,starts_at,organizer_name,organizer_contact,authorization_ref,authorized_by_user,authorized_at,sale_starts_at,sale_ends_at,status,created_by)
     VALUES ('disabled-ev','Disabled Payment Event','Hall','Limuru',datetime('now','+7 days'),'O','+254700000000','AUTH-D',1,datetime('now'),datetime('now'),datetime('now','+5 days'),'on_sale',1)`,
  );
  run("INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (1,'Regular',100000,2)");
});

after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

const app = createApp(config);

async function request(pathname: string, init?: RequestInit): Promise<Response> {
  return app.request(new URL(pathname, baseOrigin).toString(), init);
}

test("production payment-disabled configuration starts without Daraja credentials", () => {
  assert.equal(config.env, "production");
  assert.equal(config.paymentProvider, "disabled");
  assert.equal(config.bindHost, "0.0.0.0");
});

test("health endpoint answers in payment-disabled production mode", async () => {
  const res = await request("/health");
  assert.equal(res.status, 200);
  const body = await res.json() as { ok?: unknown; service?: unknown; time?: unknown };
  assert.equal(body.ok, true);
  assert.equal(body.service, "mnm-tickets");
  assert.equal(typeof body.time, "string");
});

test("event page announces unavailable sales and does not render ticket checkout", async () => {
  const res = await request("/events/disabled-ev");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Online ticket sales are temporarily unavailable/i);
  assert.doesNotMatch(html, /action="\/checkout"/);
});

test("ticket checkout is rejected before creating an order, payment or reservation", async () => {
  const beforeOrders = Number(queryOne("SELECT COUNT(*) n FROM orders")!.n);
  const beforePayments = Number(queryOne("SELECT COUNT(*) n FROM payments")!.n);
  const beforeReservations = Number(queryOne("SELECT COUNT(*) n FROM reservations")!.n);
  assert.equal(availableFor(1), 2);

  const res = await request("/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: baseOrigin,
    },
    body: new URLSearchParams({
      category_id: "1",
      qty: "1",
      name: "Test Buyer",
      phone: "0712345678",
      email: "buyer@example.test",
    }),
  });

  assert.equal(res.status, 503);
  const html = await res.text();
  assert.match(html, /No order was created/i);
  assert.match(html, /no payment was taken/i);

  assert.equal(Number(queryOne("SELECT COUNT(*) n FROM orders")!.n), beforeOrders);
  assert.equal(Number(queryOne("SELECT COUNT(*) n FROM payments")!.n), beforePayments);
  assert.equal(Number(queryOne("SELECT COUNT(*) n FROM reservations")!.n), beforeReservations);
  assert.equal(availableFor(1), 2);
});

test("guest juice ordering still works without an online payment provider", async () => {
  const res = await request("/juice/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: baseOrigin,
    },
    body: new URLSearchParams({
      items: JSON.stringify([{ productId: "1", qty: 1 }]),
      type: "pickup",
      customerName: "Juice Guest",
      customerPhone: "0712345678",
    }),
  });
  assert.equal(res.status, 302);
  const location = res.headers.get("location") ?? "";
  assert.match(location, /^\/juice\/order\//);

  const order = queryOne("SELECT order_ref, payment_status, total_minor FROM juice_orders ORDER BY id DESC LIMIT 1");
  assert.ok(order);
  assert.equal(order.payment_status, null);
  assert.ok(Number(order.total_minor) > 0);
});

test("disabled mode cannot be abused through the Daraja callback route", async () => {
  const res = await request("/pay/notify/daraja", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Body: { stkCallback: { CheckoutRequestID: "fake", ResultCode: 0 } } }),
  });
  assert.equal(res.status, 404);
  assert.equal(Number(queryOne("SELECT COUNT(*) n FROM tickets")!.n), 0);
  assert.equal(Number(queryOne("SELECT COUNT(*) n FROM payments")!.n), 0);
});
