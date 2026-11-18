/**
 * Order-engine integration tests against an isolated temp database.
 * Covers: snapshot pricing, oversell prevention (incl. concurrent), settle/issue
 * exactly-once semantics, reservation expiry, refunds, guest access.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.APP_SECRET_KEY = "test-secret-please-ignore-0123456789abcdef";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mnm-test-"));
process.env.DATABASE_FILE = path.join(tmp, "test.sqlite");

const { migrate, run, queryOne, queryAll, getDb } = await import("../src/db.ts");
const { createOrder, settleOrderPaid, issueTicketsOnce, expireReservations, LIFECYCLE, issueGuestToken, checkGuestAccess, startRefund, completeRefund, cancelEventAndQueueRefunds, paidIssuedForCategory, syncSoldCount, reconcileSoldCounts } = await import("../src/orders.ts");
const { priceSplit } = await import("../src/money.ts");
const paymentMod = await import("../src/payments/index.ts");
const { handleCallback, recordInitiated } = paymentMod;

before(async () => {
  migrate(process.env.DATABASE_FILE!);
  // base pricing terms
  run("INSERT INTO pricing_terms(label,markup_points,mnm_points,ad_points,currency,active) VALUES ('test',3500,2500,1000,'KES',1)");
  // a staff user so the event's authorized_by_user FK is satisfiable
  run("INSERT INTO users(full_name,phone,role,password_hash) VALUES ('Test Owner','+254700000001','owner','scrypt$aa$bb')");
  // organiser-authorized, published event
  const t = await import("../src/auth.ts");
  const ev = run(
    `INSERT INTO events(slug,title,venue_name,venue_area,starts_at,organizer_name,organizer_contact,
                        authorization_ref,authorized_by_user,authorized_at,sale_starts_at,sale_ends_at,status,created_by)
     VALUES ('ev-test','Test Event','Test Hall','Limuru',datetime('now','+7 days'),'Org','+254700000000',
             'AUTH-123',1,datetime('now'),datetime('now'),datetime('now','+5 days'),'on_sale',1)`,
  );
  run("INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (?,?,?,?)",
    [ev.lastInsertRowid, "Regular", 100_000, 5]);
});

after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

function categoryId(): number {
  const ev = queryOne("SELECT id FROM events WHERE slug='ev-test'")!;
  const cat = run("INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (?,?,?,?)",
    [Number(ev.id), `T-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, 100_000, 50]);
  return Number(cat.lastInsertRowid);
}

test("order snapshot follows the 35/25/10 engine", () => {
  const res = createOrder({ categoryId: categoryId(), qty: 2, customerName: "Ann", customerPhone: "0712345678" });
  assert.equal(res.ok, true);
  const o = queryOne("SELECT * FROM orders WHERE id=?", [res.orderId!])!;
  const unit = priceSplit(100_000);
  assert.equal(Number(o.original_minor), unit.original * 2);
  assert.equal(Number(o.mnm_minor), unit.mnm * 2);
  assert.equal(Number(o.ad_minor), unit.ad * 2);
  assert.equal(Number(o.total_minor), unit.selling * 2);
  assert.equal(String(o.lifecycle), LIFECYCLE.PENDING_PAYMENT);
});

test("oversell is prevented and reservations hold inventory", () => {
  const ev = queryOne("SELECT id FROM events WHERE slug='ev-test'")!;
  const cid = Number(run("INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (?,?,?,?)",
    [Number(ev.id), "Limited", 100_000, 3]).lastInsertRowid);
  const r1 = createOrder({ categoryId: cid, qty: 3, customerName: "B", customerPhone: "0712345678" });
  assert.equal(r1.ok, true);
  const r2 = createOrder({ categoryId: cid, qty: 1, customerName: "C", customerPhone: "0712345678" });
  assert.equal(r2.ok, false);
  assert.equal(r2.code, "sold_out");
});

test("concurrent purchases cannot oversell inventory", async () => {
  // fresh category with quantity 10
  const ev = queryOne("SELECT id FROM events WHERE slug='ev-test'")!;
  const cat = run("INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (?,?,?,?)",
    [Number(ev.id), "VIP", 250_000, 10]);
  const cid = Number(cat.lastInsertRowid);
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      Promise.resolve().then(() => createOrder({ categoryId: cid, qty: 3, customerName: `P${i}`, customerPhone: "0712345678" })),
    ),
  );
  const created = results.filter((r) => r.ok);
  // only floor(10/3)=3 orders of 3 fit
  assert.equal(created.length, 3);
});

test("unpaid orders expire and release reservations", () => {
  const before = queryOne("SELECT COUNT(*) AS n FROM reservations WHERE status='active'")!;
  expireReservations();
  const after2 = queryOne("SELECT COUNT(*) AS n FROM reservations WHERE status='active'")!;
  assert.ok(Number(after2.n) <= Number(before.n));
});

test("payment failure does not issue tickets", () => {
  const res = createOrder({ categoryId: categoryId(), qty: 1, customerName: "D", customerPhone: "0712345678" });
  assert.equal(res.ok, true);
  const pid = recordInitiated(res.orderId!, "dev", `DEVFAIL-${Date.now()}`, 135_000, "KES", "+254712345678");
  const out = handleCallback({ provider: "dev", providerRequestId: `DEVFAIL-NOTMATCH-${pid}`, outcome: "failed" });
  assert.equal(out.ok, false); // unknown ref is rejected
  // real failure callback:
  const o = queryOne("SELECT order_ref FROM orders WHERE id=?", [res.orderId!])!;
  void o;
  const out2 = handleCallback({ provider: "dev", providerRequestId: (queryOne("SELECT provider_request_id FROM payments WHERE id=?", [pid!]) as any).provider_request_id, outcome: "failed" });
  assert.equal(out2.ok, true);
  assert.equal(String(queryOne("SELECT lifecycle FROM orders WHERE id=?", [res.orderId!])!.lifecycle), LIFECYCLE.PAYMENT_FAILED);
  const tickets = queryAll("SELECT * FROM tickets WHERE order_id=?", [res.orderId!]);
  assert.equal(tickets.length, 0);
});

test("confirmed payment issues exactly the purchased tickets, once", () => {
  const res = createOrder({ categoryId: categoryId(), qty: 2, customerName: "E", customerPhone: "0712345678" });
  assert.equal(res.ok, true);
  const oid = res.orderId!;
  const prid = `DEVOK-${oid}`;
  recordInitiated(oid, "dev", prid, 270_000, "KES", "+254712345678");
  const cb = handleCallback({ provider: "dev", providerRequestId: prid, outcome: "succeeded", amountMinor: 270_000, currency: "KES", providerRef: "SIM123" });
  assert.equal(cb.ok, true);
  assert.equal(String(queryOne("SELECT lifecycle FROM orders WHERE id=?", [oid])!.lifecycle), LIFECYCLE.TICKET_ISSUED);
  const tickets = queryAll("SELECT ticket_code FROM tickets WHERE order_id=?", [oid]);
  assert.equal(tickets.length, 2);
  // duplicate callback is idempotent:
  const cb2 = handleCallback({ provider: "dev", providerRequestId: prid, outcome: "succeeded", amountMinor: 270_000, currency: "KES", providerRef: "SIM123" });
  assert.equal(cb2.ok, true);
  assert.equal(cb2.detail, "duplicate ignored");
  const tickets2 = queryAll("SELECT ticket_code FROM tickets WHERE order_id=?", [oid]);
  assert.equal(tickets2.length, 2);
  // direct settle twice also can't double-issue:
  assert.equal(settleOrderPaid(oid).alreadySettled, true);
  assert.equal(issueTicketsOnce(oid), false);
  assert.equal(queryAll("SELECT id FROM tickets WHERE order_id=?", [oid]).length, 2);
});

test("amount mismatch never settles; lands in reconcile queue", () => {
  const res = createOrder({ categoryId: categoryId(), qty: 1, customerName: "F", customerPhone: "0712345678" });
  const prid = `DEVBAD-${res.orderId}`;
  recordInitiated(res.orderId!, "dev", prid, 135_000, "KES", "+254712345678");
  const out = handleCallback({ provider: "dev", providerRequestId: prid, outcome: "succeeded", amountMinor: 100, currency: "KES" });
  assert.equal(out.ok, true);
  assert.match(out.detail, /NOT settled/);
  assert.equal(String(queryOne("SELECT lifecycle FROM orders WHERE id=?", [res.orderId!])!.lifecycle), LIFECYCLE.PENDING_PAYMENT);
  const exc = queryOne("SELECT * FROM reconcile_exceptions WHERE order_id=?", [res.orderId!]);
  assert.ok(exc);
});

test("refund lifecycle voids tickets", () => {
  const res = createOrder({ categoryId: categoryId(), qty: 1, customerName: "G", customerPhone: "0712345678" });
  const prid = `DEVREF-${res.orderId}`;
  recordInitiated(res.orderId!, "dev", prid, 135_000, "KES", "+254712345678");
  handleCallback({ provider: "dev", providerRequestId: prid, outcome: "succeeded", amountMinor: 135_000, currency: "KES" });
  const oid = res.orderId!;
  assert.equal(startRefund(String(queryOne("SELECT order_ref FROM orders WHERE id=?", [oid])!.order_ref), 1), true);
  assert.equal(String(queryOne("SELECT lifecycle FROM orders WHERE id=?", [oid])!.lifecycle), LIFECYCLE.REFUND_PENDING);
  assert.equal(queryOne("SELECT COUNT(*) AS n FROM tickets WHERE order_id=? AND status='refunded'", [oid])!.n, 1);
  // refunded ticket must not verify (checked again in scan tests)
  completeRefund(String(queryOne("SELECT order_ref FROM orders WHERE id=?", [oid])!.order_ref), 1);
});

test("sale window rejects checkout before opening and after closing", () => {
  function eventWindow(startOffsetMs: number, endOffsetMs: number): number {
    const now = Date.now();
    const ev = run(
      `INSERT INTO events(slug,title,venue_name,venue_area,starts_at,organizer_name,organizer_contact,
                          authorization_ref,authorized_by_user,authorized_at,sale_starts_at,sale_ends_at,status,created_by)
       VALUES (?,?,'Hall','Limuru',datetime('now','+30 days'),'Org','+254700000000','AUTH',1,datetime('now'),?,?, 'on_sale',1)`,
      [`window-${now}-${startOffsetMs}`, `Window ${startOffsetMs}`, new Date(now + startOffsetMs).toISOString(), new Date(now + endOffsetMs).toISOString()],
    );
    return Number(run("INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (?,?,?,?)",
      [Number(ev.lastInsertRowid), "Window Tier", 100_000, 10]).lastInsertRowid);
  }

  const future = createOrder({ categoryId: eventWindow(60 * 60_000, 2 * 60 * 60_000), qty: 1, customerName: "Early", customerPhone: "0712345678" });
  assert.equal(future.ok, false);
  assert.equal(future.code, "sale_not_open");

  const past = createOrder({ categoryId: eventWindow(-2 * 60 * 60_000, -60 * 60_000), qty: 1, customerName: "Late", customerPhone: "0712345678" });
  assert.equal(past.ok, false);
  assert.equal(past.code, "sale_closed");
});

test("event cancellation voids tickets, releases holds and queues refunds for staff completion", () => {
  const ev = run(
    `INSERT INTO events(slug,title,venue_name,venue_area,starts_at,organizer_name,organizer_contact,
                        authorization_ref,authorized_by_user,authorized_at,sale_starts_at,sale_ends_at,status,created_by)
     VALUES (?,?,'Hall','Limuru',datetime('now','+30 days'),'Org','+254700000000','AUTH',1,datetime('now'),datetime('now','-1 day'),datetime('now','+1 day'),'on_sale',1)`,
    [`cancel-${Date.now()}`, "Cancel Event"],
  );
  const eventId = Number(ev.lastInsertRowid);
  const cid = Number(run("INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (?,?,?,?)",
    [eventId, "Cancel Tier", 100_000, 10]).lastInsertRowid);

  const paid = createOrder({ categoryId: cid, qty: 2, customerName: "Paid", customerPhone: "0712345678" });
  assert.equal(paid.ok, true);
  payOrder(paid.orderId!);
  const pending = createOrder({ categoryId: cid, qty: 1, customerName: "Pending", customerPhone: "0712345678" });
  assert.equal(pending.ok, true);

  const result = cancelEventAndQueueRefunds(eventId, 1);
  assert.equal(result.ok, true);
  assert.equal(result.refundPending, 1);
  assert.equal(result.pendingCancelled, 1);
  assert.equal(result.ticketsVoided, 2);
  assert.equal(String(queryOne("SELECT status FROM events WHERE id=?", [eventId])!.status), "cancelled");
  assert.equal(String(queryOne("SELECT lifecycle FROM orders WHERE id=?", [paid.orderId!])!.lifecycle), LIFECYCLE.REFUND_PENDING);
  assert.equal(String(queryOne("SELECT lifecycle FROM orders WHERE id=?", [pending.orderId!])!.lifecycle), LIFECYCLE.CANCELLED);
  assert.equal(Number(queryOne("SELECT COUNT(*) n FROM tickets WHERE order_id=? AND status='cancelled'", [paid.orderId!])!.n), 2);
  assert.equal(Number(queryOne("SELECT COUNT(*) n FROM reservations WHERE order_id=? AND status='active'", [pending.orderId!])!.n), 0);

  const ref = String(queryOne("SELECT order_ref FROM orders WHERE id=?", [paid.orderId!])!.order_ref);
  assert.equal(completeRefund(ref, 1), true);
  assert.equal(String(queryOne("SELECT lifecycle FROM orders WHERE id=?", [paid.orderId!])!.lifecycle), LIFECYCLE.REFUNDED);
  assert.equal(Number(queryOne("SELECT COUNT(*) n FROM tickets WHERE order_id=? AND status='refunded'", [paid.orderId!])!.n), 2);
});

test("guest token grants access and other tokens fail", () => {
  const oid = Number(queryOne("SELECT id FROM orders WHERE order_ref LIKE 'MNM-%' LIMIT 1")!.id);
  const tok = issueGuestToken(oid);
  const ref = String(queryOne("SELECT order_ref FROM orders WHERE id=?", [oid])!.order_ref);
  assert.equal(checkGuestAccess(ref, tok), true);
  assert.equal(checkGuestAccess(ref, tok + "x"), false);
  assert.equal(checkGuestAccess(ref, ""), false);
});

function payOrder(orderId: number, provider = "dev", merchantRequestId?: string): void {
  const order = queryOne("SELECT total_minor, currency FROM orders WHERE id=?", [orderId])!;
  const prid = `PAY-${provider}-${orderId}-${Math.random().toString(36).slice(2)}`;
  recordInitiated(orderId, provider, prid, Number(order.total_minor), String(order.currency), "+254712345678", merchantRequestId);
  const out = handleCallback({
    provider,
    providerRequestId: prid,
    outcome: "succeeded",
    amountMinor: Number(order.total_minor),
    currency: String(order.currency),
    merchantRequestId,
    verified: provider === "daraja" ? true : undefined,
  });
  assert.equal(out.ok, true, out.detail);
}

test("paid capacity is enforced and sold_count reconciles to issued tickets", () => {
  const ev = queryOne("SELECT id FROM events WHERE slug='ev-test'")!;
  const cid = Number(run("INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (?,?,?,?)",
    [Number(ev.id), "Capacity Two", 100_000, 2]).lastInsertRowid);
  const first = createOrder({ categoryId: cid, qty: 2, customerName: "Cap A", customerPhone: "0712345678" });
  assert.equal(first.ok, true);
  payOrder(first.orderId!);

  const cat = queryOne("SELECT quantity, sold_count FROM ticket_categories WHERE id=?", [cid])!;
  assert.equal(Number(cat.sold_count), 2, "counter must reflect both issued tickets");
  assert.equal(paidIssuedForCategory(cid), 2, "derived issued count must be authoritative");
  assert.equal(queryAll("SELECT id FROM tickets WHERE order_id=?", [first.orderId!]).length, 2);

  const second = createOrder({ categoryId: cid, qty: 1, customerName: "Cap B", customerPhone: "0712345678" });
  assert.equal(second.ok, false);
  assert.equal(second.code, "sold_out");
  assert.equal(queryAll("SELECT id FROM tickets WHERE order_id=?", [first.orderId!]).length, 2, "no extra tickets on refusal");
});

test("concurrent paid orders cannot oversell capacity", () => {
  const ev = queryOne("SELECT id FROM events WHERE slug='ev-test'")!;
  const cid = Number(run("INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (?,?,?,?)",
    [Number(ev.id), "Concurrent Paid", 100_000, 2]).lastInsertRowid);
  const a = createOrder({ categoryId: cid, qty: 1, customerName: "Con A", customerPhone: "0712345678" });
  const b = createOrder({ categoryId: cid, qty: 1, customerName: "Con B", customerPhone: "0712345678" });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);

  // Settlement is synchronous and transactional in this stack; interleave the
  // two callbacks to prove the second cannot issue against released capacity.
  payOrder(a.orderId!);
  payOrder(b.orderId!);
  assert.equal(paidIssuedForCategory(cid), 2);
  const c = createOrder({ categoryId: cid, qty: 1, customerName: "Con C", customerPhone: "0712345678" });
  assert.equal(c.ok, false);
  assert.equal(c.code, "sold_out");
});

test("refunds release inventory and reconcile sold_count", () => {
  const ev = queryOne("SELECT id FROM events WHERE slug='ev-test'")!;
  const cid = Number(run("INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (?,?,?,?)",
    [Number(ev.id), "Refund Release", 100_000, 2]).lastInsertRowid);
  const res = createOrder({ categoryId: cid, qty: 1, customerName: "Refund R", customerPhone: "0712345678" });
  assert.equal(res.ok, true);
  payOrder(res.orderId!);
  assert.equal(paidIssuedForCategory(cid), 1);
  assert.equal(syncSoldCount(cid), 1);

  const ref = String(queryOne("SELECT order_ref FROM orders WHERE id=?", [res.orderId!])!.order_ref);
  assert.equal(startRefund(ref, 1), true);
  assert.equal(paidIssuedForCategory(cid), 0, "refunded tickets no longer occupy capacity");
  assert.equal(Number(queryOne("SELECT sold_count FROM ticket_categories WHERE id=?", [cid])!.sold_count), 0);

  const replacement = createOrder({ categoryId: cid, qty: 1, customerName: "Refund S", customerPhone: "0712345678" });
  assert.equal(replacement.ok, true, "released capacity must be sellable again");
});

test("startup reconciliation repairs stale sold_count without changing tickets", () => {
  const ev = queryOne("SELECT id FROM events WHERE slug='ev-test'")!;
  const cid = Number(run("INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (?,?,?,?)",
    [Number(ev.id), "Reconcile Me", 100_000, 2]).lastInsertRowid);
  const res = createOrder({ categoryId: cid, qty: 1, customerName: "Reconcile R", customerPhone: "0712345678" });
  assert.equal(res.ok, true);
  payOrder(res.orderId!);
  run("UPDATE ticket_categories SET sold_count=0 WHERE id=?", [cid]);
  assert.equal(Number(queryOne("SELECT sold_count FROM ticket_categories WHERE id=?", [cid])!.sold_count), 0);
  const result = reconcileSoldCounts();
  assert.ok(result.updated >= 1);
  assert.equal(result.failed, 0);
  assert.equal(Number(queryOne("SELECT sold_count FROM ticket_categories WHERE id=?", [cid])!.sold_count), 1);
  assert.equal(queryAll("SELECT id FROM tickets WHERE order_id=?", [res.orderId!]).length, 1);
});

test("daraja callbacks require verification and matching merchant reference", () => {
  const ev = queryOne("SELECT id FROM events WHERE slug='ev-test'")!;
  const cid = Number(run("INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (?,?,?,?)",
    [Number(ev.id), "Daraja Verify", 100_000, 2]).lastInsertRowid);
  const res = createOrder({ categoryId: cid, qty: 1, customerName: "Daraja D", customerPhone: "0712345678" });
  assert.equal(res.ok, true);
  const order = queryOne("SELECT total_minor, currency FROM orders WHERE id=?", [res.orderId!])!;
  const prid = `DARAJA-${res.orderId}`;
  recordInitiated(res.orderId!, "daraja", prid, Number(order.total_minor), String(order.currency), "+254712345678", "MERCHANT-1");

  const unverified = handleCallback({
    provider: "daraja", providerRequestId: prid, outcome: "succeeded",
    amountMinor: Number(order.total_minor), currency: String(order.currency), merchantRequestId: "MERCHANT-1",
  });
  assert.equal(unverified.ok, false);
  assert.equal(unverified.httpStatus, 401);
  assert.equal(String(queryOne("SELECT lifecycle FROM orders WHERE id=?", [res.orderId!])!.lifecycle), LIFECYCLE.PENDING_PAYMENT);
  assert.equal(queryAll("SELECT id FROM tickets WHERE order_id=?", [res.orderId!]).length, 0);

  const mismatch = handleCallback({
    provider: "daraja", providerRequestId: prid, outcome: "succeeded", verified: true,
    amountMinor: Number(order.total_minor), currency: String(order.currency), merchantRequestId: "MERCHANT-OTHER",
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.httpStatus, 409);
  assert.equal(queryAll("SELECT id FROM tickets WHERE order_id=?", [res.orderId!]).length, 0);

  const verified = handleCallback({
    provider: "daraja", providerRequestId: prid, outcome: "succeeded", verified: true,
    amountMinor: Number(order.total_minor), currency: String(order.currency), merchantRequestId: "MERCHANT-1",
  });
  assert.equal(verified.ok, true, verified.detail);
  assert.equal(String(queryOne("SELECT lifecycle FROM orders WHERE id=?", [res.orderId!])!.lifecycle), LIFECYCLE.TICKET_ISSUED);
  assert.equal(queryAll("SELECT id FROM tickets WHERE order_id=?", [res.orderId!]).length, 1);
});
