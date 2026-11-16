/**
 * Phase 2A.1 — payment initiation persistence ordering.
 *
 * The failing test forces the real checkout route's local payment insert to fail
 * after the provider (dev simulator) has accepted the request. That proves the
 * current order-of-operations leaves no recoverable local payment identity.
 *
 * The later tests record the lifecycle primitives that already work: unique
 * provider IDs map to one row, and an unknown provider callback is rejected.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

process.env.NODE_ENV = "test";
process.env.PAYMENT_PROVIDER = "dev";
process.env.APP_SECRET_KEY = "phase2a1-order-secret-0123456789abcdef";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mnm-p2a1-order-"));
process.env.DATABASE_FILE = path.join(tmp, "order.sqlite");
process.env.PUBLIC_ORIGINS = "http://localhost:8787";

const { migrate, run, queryOne } = await import("../../src/db.ts");
const { createOrder } = await import("../../src/orders.ts");
const { recordInitiated, handleCallback } = await import("../../src/payments/index.ts");
const { createApp } = await import("../../src/app.tsx");
const { loadConfig } = await import("../../src/config.ts");

const BASE = "http://localhost:8787";
let categoryId = 0;
let orderSeq = 0;

before(() => {
  migrate(process.env.DATABASE_FILE!);
  run("INSERT INTO pricing_terms(label,markup_points,mnm_points,ad_points,currency,active) VALUES ('p2a1',3500,2500,1000,'KES',1)");
  run("INSERT INTO users(full_name,phone,role,password_hash) VALUES ('P2A1 Order','+254700000062','owner','scrypt$aa$bb')");
  const eventId = Number(run(
    `INSERT INTO events(slug,title,venue_name,venue_area,starts_at,organizer_name,organizer_contact,
                        authorization_ref,authorized_by_user,authorized_at,sale_starts_at,sale_ends_at,status,created_by)
     VALUES ('p2a1-order','Order Event','Hall','Limuru',datetime('now','+7 days'),'Organiser','+254700000000','AUTH',1,datetime('now'),datetime('now'),datetime('now','+1 day'),'on_sale',1)`,
  ).lastInsertRowid);
  categoryId = Number(run(
    "INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (?,?,?,?)",
    [eventId, "Order Tier", 100_000, 20],
  ).lastInsertRowid);
});

after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

test("provider acceptance followed by local insert failure leaves no recoverable payment identity", async () => {
  const app = createApp(loadConfig(process.env));
  const originalPrepare = DatabaseSync.prototype.prepare;
  (DatabaseSync.prototype as unknown as { prepare: (sql: string) => unknown }).prepare = function (sql: string) {
    if (/INSERT\s+INTO\s+payments/i.test(sql)) throw new Error("simulated local persistence failure");
    return originalPrepare.call(this, sql);
  };
  try {
    const res = await app.request(new URL("/checkout", BASE).toString(), {
      method: "POST",
      body: new URLSearchParams({
        category_id: String(categoryId),
        qty: "1",
        name: "Persistence Failure",
        phone: "0712345678",
        email: "",
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: BASE },
    });
    const payment = queryOne("SELECT id FROM payments ORDER BY id DESC LIMIT 1");
    assert.deepEqual(
      { status: res.status, hasPayment: Boolean(payment) },
      { status: 302, hasPayment: true },
      "a provider-accepted checkout must leave a recoverable local payment identity",
    );
  } finally {
    (DatabaseSync.prototype as unknown as { prepare: typeof originalPrepare }).prepare = originalPrepare;
  }
});

test("duplicate provider request ID maps to one local payment row", () => {
  const res = createOrder({ categoryId, qty: 1, customerName: "Duplicate", customerPhone: "0712345678" });
  assert.equal(res.ok, true, res.msg);
  const first = recordInitiated(res.orderId!, "dev", `DUP-${++orderSeq}`, 135_000, "KES", "+254712345678");
  const second = recordInitiated(res.orderId!, "dev", `DUP-${orderSeq}`, 135_000, "KES", "+254712345678");
  assert.equal(first, second, "same provider request ID must not create a second payment row");
  assert.equal(Number(queryOne("SELECT COUNT(*) n FROM payments WHERE provider_request_id=?", [`DUP-${orderSeq}`])!.n), 1);
});

test("a second active initiation for one order must be refused", () => {
  const res = createOrder({ categoryId, qty: 1, customerName: "Retry", customerPhone: "0712345678" });
  assert.equal(res.ok, true, res.msg);
  const first = recordInitiated(res.orderId!, "dev", "RETRY-FIRST", 135_000, "KES", "+254712345678");
  assert.ok(first);
  assert.throws(
    () => recordInitiated(res.orderId!, "dev", "RETRY-SECOND", 135_000, "KES", "+254712345678"),
    /active|already/i,
    "one order must not have two active payment attempts",
  );
});

test("unknown provider callback is rejected and issues no tickets", () => {
  const beforeTickets = Number(queryOne("SELECT COUNT(*) n FROM tickets")!.n);
  const out = handleCallback({
    provider: "dev",
    providerRequestId: "UNKNOWN-PROVIDER-REFERENCE",
    outcome: "succeeded",
    amountMinor: 135_000,
    currency: "KES",
  });
  assert.equal(out.ok, false);
  assert.equal(out.httpStatus, 404);
  assert.equal(Number(queryOne("SELECT COUNT(*) n FROM tickets")!.n), beforeTickets);
});
