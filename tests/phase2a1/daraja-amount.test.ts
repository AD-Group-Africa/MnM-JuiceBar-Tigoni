/**
 * Phase 2A.1 — Daraja amount consistency (known-defect suite).
 *
 * No OAuth/STK/Query network request leaves the process. fetch is replaced with
 * deterministic fakes. The fractional-KES tests are expected to FAIL until the
 * founder selects and Phase 2B implements a rounding policy.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.APP_SECRET_KEY = "phase2a1-daraja-secret-0123456789abcdef";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mnm-p2a1-daraja-"));
process.env.DATABASE_FILE = path.join(tmp, "daraja.sqlite");

const { migrate, run, queryOne } = await import("../../src/db.ts");
const { createOrder } = await import("../../src/orders.ts");
const { recordInitiated, handleCallback } = await import("../../src/payments/index.ts");
const { DarajaProvider, parseDarajaCallback } = await import("../../src/payments/daraja.ts");
const { loadConfig } = await import("../../src/config.ts");

const env = {
  NODE_ENV: "test",
  PAYMENT_PROVIDER: "daraja",
  MPESA_ENV: "sandbox",
  MPESA_SHORTCODE: "123456",
  MPESA_CONSUMER_KEY: "test-consumer-key",
  MPESA_CONSUMER_SECRET: "test-consumer-secret",
  MPESA_PASSKEY: "test-passkey",
  MPESA_CALLBACK_BASE: "https://example.test",
  APP_SECRET_KEY: "phase2a1-daraja-secret-0123456789abcdef",
  DATABASE_FILE: process.env.DATABASE_FILE,
  PUBLIC_ORIGINS: "http://localhost:8787",
};
const config = loadConfig(env);
const provider = new DarajaProvider(config);
let seq = 0;

before(() => {
  migrate(process.env.DATABASE_FILE!);
  run("INSERT INTO pricing_terms(label,markup_points,mnm_points,ad_points,currency,active) VALUES ('p2a1',3500,2500,1000,'KES',1)");
  run("INSERT INTO users(full_name,phone,role,password_hash) VALUES ('P2A1 Daraja','+254700000061','owner','scrypt$aa$bb')");
});

after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

function makeOrder(originalPriceMinor: number): { orderId: number; totalMinor: number; ref: string } {
  const n = ++seq;
  const eventId = Number(run(
    `INSERT INTO events(slug,title,venue_name,venue_area,starts_at,organizer_name,organizer_contact,
                        authorization_ref,authorized_by_user,authorized_at,sale_starts_at,sale_ends_at,status,created_by)
     VALUES (?,?,'Hall','Limuru',datetime('now','+7 days'),'Organiser','+254700000000','AUTH',1,datetime('now'),datetime('now'),datetime('now','+1 day'),'on_sale',1)`,
    [`p2a1-daraja-${n}`, `Daraja ${n}`],
  ).lastInsertRowid);
  const categoryId = Number(run(
    "INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (?,?,?,?)",
    [eventId, `Tier ${n}`, originalPriceMinor, 20],
  ).lastInsertRowid);
  const res = createOrder({ categoryId, qty: 1, customerName: "Daraja Buyer", customerPhone: "0712345678" });
  assert.equal(res.ok, true, res.msg);
  const order = queryOne("SELECT total_minor, order_ref FROM orders WHERE id=?", [res.orderId!])!;
  return { orderId: res.orderId!, totalMinor: Number(order.total_minor), ref: String(order.order_ref) };
}

async function withMockFetch<T>(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

test("fractional-KES order: STK Amount must equal the payable amount", async () => {
  const captured: { stk?: Record<string, unknown> } = {};
  await withMockFetch(async (url, init) => {
    if (url.includes("/oauth/")) {
      return new Response(JSON.stringify({ access_token: "mock-token", expires_in: "3599" }), { status: 200 });
    }
    if (url.includes("/stkpush/")) {
      captured.stk = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ResponseCode: "0", CheckoutRequestID: "CHECK-AMOUNT", MerchantRequestID: "MERCHANT-AMOUNT" }), { status: 200 });
    }
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    const res = await provider.initiate(1, 33_750, "KES", "+254712345678");
    assert.equal(res.ok, true);
  });
  assert.ok(captured.stk);
  assert.equal(Number(captured.stk.Amount) * 100, 33_750, "KES 337.50 must not silently become KES 338.00");
});

test("fractional-KES callback: parsed minor amount must equal the order total", () => {
  const raw = JSON.stringify({
    Body: { stkCallback: {
      MerchantRequestID: "MERCHANT-AMOUNT",
      CheckoutRequestID: "CHECK-AMOUNT",
      ResultCode: 0,
      ResultDesc: "Success",
      CallbackMetadata: { Item: [
        { Name: "Amount", Value: 338 },
        { Name: "MpesaReceiptNumber", Value: "MOCK123" },
      ] },
    } },
  });
  const parsed = parseDarajaCallback(raw);
  assert.ok(parsed);
  assert.equal(parsed.amountMinor, 33_750, "callback cents must reconcile to the order total");
});

test("fractional-KES settlement: verified success must issue tickets", () => {
  const { orderId, totalMinor } = makeOrder(25_000);
  assert.equal(totalMinor, 33_750);
  recordInitiated(orderId, "daraja", "CHECK-SETTLE-33750", totalMinor, "KES", "+254712345678", "MERCHANT-SETTLE");
  const out = handleCallback({
    provider: "daraja",
    providerRequestId: "CHECK-SETTLE-33750",
    outcome: "succeeded",
    verified: true,
    amountMinor: 33_800,
    currency: "KES",
    merchantRequestId: "MERCHANT-SETTLE",
  });
  assert.equal(out.ok, true, out.detail);
  assert.equal(String(queryOne("SELECT lifecycle FROM orders WHERE id=?", [orderId])!.lifecycle), "ticket_issued");
});

test("one-cent payable amount must not round to zero", async () => {
  const captured: { stk?: Record<string, unknown> } = {};
  await withMockFetch(async (url, init) => {
    if (url.includes("/oauth/")) {
      return new Response(JSON.stringify({ access_token: "mock-token", expires_in: "3599" }), { status: 200 });
    }
    if (url.includes("/stkpush/")) {
      captured.stk = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ResponseCode: "0", CheckoutRequestID: "CHECK-CENT", MerchantRequestID: "MERCHANT-CENT" }), { status: 200 });
    }
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    const res = await provider.initiate(3, 1, "KES", "+254712345678");
    assert.equal(res.ok, true);
  });
  assert.ok(captured.stk);
  assert.equal(Number(captured.stk.Amount) * 100, 1, "a one-cent payable amount must not become zero");
});

test("provider rejection returns unavailable rather than throwing", async () => {
  await withMockFetch(async (url) => {
    if (url.includes("/oauth/")) {
      return new Response(JSON.stringify({ access_token: "mock-token", expires_in: "3599" }), { status: 200 });
    }
    if (url.includes("/stkpush/")) {
      return new Response(JSON.stringify({ ResponseCode: "1", ResponseDescription: "Rejected" }), { status: 200 });
    }
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    const res = await provider.initiate(4, 100_000, "KES", "+254712345678");
    assert.equal(res.ok, false);
    assert.equal(res.status, "unavailable");
  });
});

test("provider timeout must return a safe unavailable result, not throw", async () => {
  await withMockFetch(async (url) => {
    if (url.includes("/oauth/")) {
      return new Response(JSON.stringify({ access_token: "mock-token", expires_in: "3599" }), { status: 200 });
    }
    if (url.includes("/stkpush/")) throw new Error("provider timeout");
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    let result: Awaited<ReturnType<typeof provider.initiate>> | null = null;
    try {
      result = await provider.initiate(5, 100_000, "KES", "+254712345678");
    } catch (err) {
      assert.fail(`timeout escaped as an exception: ${(err as Error).message}`);
    }
    assert.ok(result);
    assert.equal(result.ok, false);
  });
});

test("delayed provider response is awaited", async () => {
  await withMockFetch(async (url) => {
    if (url.includes("/oauth/")) {
      return new Response(JSON.stringify({ access_token: "mock-token", expires_in: "3599" }), { status: 200 });
    }
    if (url.includes("/stkpush/")) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({ ResponseCode: "0", CheckoutRequestID: "CHECK-DELAYED", MerchantRequestID: "MERCHANT-DELAYED" }), { status: 200 });
    }
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    const res = await provider.initiate(6, 100_000, "KES", "+254712345678");
    assert.equal(res.ok, true);
    assert.equal(res.providerRequestId, "CHECK-DELAYED");
  });
});

test("whole-shilling order: STK and callback remain consistent", async () => {
  const captured: { stk?: Record<string, unknown> } = {};
  await withMockFetch(async (url, init) => {
    if (url.includes("/oauth/")) {
      return new Response(JSON.stringify({ access_token: "mock-token", expires_in: "3599" }), { status: 200 });
    }
    if (url.includes("/stkpush/")) {
      captured.stk = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ResponseCode: "0", CheckoutRequestID: "CHECK-WHOLE", MerchantRequestID: "MERCHANT-WHOLE" }), { status: 200 });
    }
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    const res = await provider.initiate(2, 100_000, "KES", "+254712345678");
    assert.equal(res.ok, true);
  });
  assert.ok(captured.stk);
  assert.equal(Number(captured.stk.Amount) * 100, 100_000);
});

test("whole-shilling settlement issues exactly once", () => {
  const { orderId, totalMinor } = makeOrder(100_000);
  assert.equal(totalMinor, 135_000);
  recordInitiated(orderId, "daraja", "CHECK-SETTLE-135000", totalMinor, "KES", "+254712345678", "MERCHANT-WHOLE");
  const out = handleCallback({
    provider: "daraja",
    providerRequestId: "CHECK-SETTLE-135000",
    outcome: "succeeded",
    verified: true,
    amountMinor: 135_000,
    currency: "KES",
    merchantRequestId: "MERCHANT-WHOLE",
  });
  assert.equal(out.ok, true, out.detail);
  assert.equal(String(queryOne("SELECT lifecycle FROM orders WHERE id=?", [orderId])!.lifecycle), "ticket_issued");
  assert.equal(Number(queryOne("SELECT COUNT(*) n FROM tickets WHERE order_id=?", [orderId])!.n), 1);
});

test("amount mismatch never settles and records a reconciliation exception", () => {
  const { orderId } = makeOrder(100_000);
  recordInitiated(orderId, "daraja", "CHECK-MISMATCH", 135_000, "KES", "+254712345678", "MERCHANT-MISMATCH");
  const out = handleCallback({
    provider: "daraja",
    providerRequestId: "CHECK-MISMATCH",
    outcome: "succeeded",
    verified: true,
    amountMinor: 100,
    currency: "KES",
    merchantRequestId: "MERCHANT-MISMATCH",
  });
  assert.equal(out.ok, true);
  assert.match(out.detail, /NOT settled/);
  assert.equal(String(queryOne("SELECT lifecycle FROM orders WHERE id=?", [orderId])!.lifecycle), "pending_payment");
  assert.ok(queryOne("SELECT id FROM reconcile_exceptions WHERE order_id=?", [orderId]));
});

test("currency mismatch never settles", () => {
  const { orderId } = makeOrder(100_000);
  recordInitiated(orderId, "daraja", "CHECK-CURRENCY", 135_000, "KES", "+254712345678", "MERCHANT-CURRENCY");
  const out = handleCallback({
    provider: "daraja",
    providerRequestId: "CHECK-CURRENCY",
    outcome: "succeeded",
    verified: true,
    amountMinor: 135_000,
    currency: "USD",
    merchantRequestId: "MERCHANT-CURRENCY",
  });
  assert.equal(out.ok, true);
  assert.match(out.detail, /NOT settled/);
  assert.equal(String(queryOne("SELECT lifecycle FROM orders WHERE id=?", [orderId])!.lifecycle), "pending_payment");
});

test("query result confirms paid/not-paid but carries no amount to compare", async () => {
  await withMockFetch(async (url) => {
    if (url.includes("/oauth/")) {
      return new Response(JSON.stringify({ access_token: "mock-token", expires_in: "3599" }), { status: 200 });
    }
    if (url.includes("/stkpushquery/")) {
      return new Response(JSON.stringify({ ResponseCode: "0", ResultCode: "0", ResultDesc: "Success" }), { status: 200 });
    }
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    const result = await provider.verifyTransaction("CHECK-QUERY");
    assert.equal(result.reachable, true);
    assert.equal(result.paid, true);
    assert.equal("amountMinor" in result, false, "documented limitation: query returns only paid/not-paid");
  });
});
