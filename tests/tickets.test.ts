import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.APP_SECRET_KEY = "test-secret-please-ignore-0123456789abcdef";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mnm-tix-"));
process.env.DATABASE_FILE = path.join(tmp, "t.sqlite");

const { migrate, run, queryOne, queryAll } = await import("../src/db.ts");
const { createOrder } = await import("../src/orders.ts");
const { recordInitiated, handleCallback } = await import("../src/payments/index.ts");
const { verifyTicket, redeemTicket } = await import("../src/tickets.ts");

before(async () => {
  migrate(process.env.DATABASE_FILE!);
  run("INSERT INTO pricing_terms(label,markup_points,mnm_points,ad_points,currency,active) VALUES ('t',3500,2500,1000,'KES',1)");
  run("INSERT INTO users(full_name,phone,role,password_hash) VALUES ('Scanner Q','+254700000009','scanner','scrypt$a$b')");
  run("INSERT INTO users(full_name,phone,role,password_hash) VALUES ('Scanner 2','+254700000010','scanner','scrypt$a$b')");
  const ev = run(
    `INSERT INTO events(slug,title,venue_name,venue_area,starts_at,organizer_name,organizer_contact,authorization_ref,authorized_by_user,authorized_at,sale_starts_at,sale_ends_at,status,created_by)
     VALUES ('ev','Comedy Night (sample seed event)','Hall','Limuru',datetime('now','+2 days'),'O','+254700000000','A',1,datetime('now'),datetime('now'),datetime('now','+1 days'),'on_sale',1)`,
  );
  run("INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (?,?,?,?)", [ev.lastInsertRowid, "Regular", 100_000, 20]);
});

after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { } });

const SCANNER = () => Number(queryOne("SELECT id FROM users WHERE phone='+254700000009'")!.id);
const SCANNER2 = () => Number(queryOne("SELECT id FROM users WHERE phone='+254700000010'")!.id);

/** Purchase + pay + return issued ticket codes. */
function buyAndPay(qty: number): string[] {
  const res = createOrder({ categoryId: 1, qty, customerName: "Tan", customerPhone: "0712345678" });
  assert.equal(res.ok, true);
  const prid = `P-${res.orderId}-${Math.random().toString(36).slice(2)}`;
  recordInitiated(res.orderId!, "dev", prid, qty * 135_000, "KES", "+254712345678");
  const cb = handleCallback({ provider: "dev", providerRequestId: prid, outcome: "succeeded", amountMinor: qty * 135_000, currency: "KES" });
  assert.equal(cb.ok, true);
  return (queryAll("SELECT ticket_code FROM tickets WHERE order_id=?", [res.orderId!]) as { ticket_code: string }[]).map((r) => String(r.ticket_code));
}

test("valid ticket verifies and redeems exactly once", () => {
  const [code] = buyAndPay(1);
  const v = verifyTicket(code!);
  assert.equal(v.ok, true);
  assert.equal(v.outcome, "accepted");

  const r1 = redeemTicket(code!, SCANNER());
  assert.equal(r1.result.outcome, "accepted");

  // second redemption fails, even by another scanner
  const r2 = redeemTicket(code!, SCANNER2());
  assert.equal(r2.result.outcome, "already_redeemed");
  assert.equal(r2.result.ok, false);
  // state stays redeemed
  assert.equal(String(queryOne("SELECT status FROM tickets WHERE ticket_code=?", [code!])!.status), "redeemed");
});

test("unknown codes and tampered codes rejected", () => {
  assert.equal(verifyTicket("NOPE-XXXX").outcome, "unknown_code");
  assert.equal(verifyTicket("").outcome, "unknown_code");
  const r = redeemTicket("NOPE-XXXX", SCANNER());
  assert.equal(r.result.ok, false);
});

test("refunded and cancelled tickets rejected", () => {
  const [code] = buyAndPay(1);
  run("UPDATE tickets SET status='refunded' WHERE ticket_code=?", [code!]);
  assert.equal(verifyTicket(code!).outcome, "refunded");
  assert.equal(verifyTicket(code!).ok, false);

  const [code2] = buyAndPay(1);
  run("UPDATE tickets SET status='cancelled' WHERE ticket_code=?", [code2!]);
  assert.equal(verifyTicket(code2!).outcome, "cancelled");
});

test("redeemed tickets can never flip back to valid through redemption", () => {
  const [a, b] = buyAndPay(2);
  redeemTicket(a!, SCANNER());
  // attempt redemption of the second one but with the code of the first
  const r = redeemTicket(a!, SCANNER());
  assert.notEqual(r.result.outcome, "accepted");
  // b unaffected
  assert.equal(queryOne("SELECT status FROM tickets WHERE ticket_code=?", [b!])!.status, "valid");
});

test("event cancellation rejects tickets", () => {
  const [code] = buyAndPay(1);
  run("UPDATE events SET status='cancelled' WHERE id=1");
  assert.equal(verifyTicket(code!).outcome, "event_cancelled");
  run("UPDATE events SET status='on_sale' WHERE id=1");
});

test("scan audit trail records every attempt", () => {
  const rej = queryAll("SELECT * FROM scan_log WHERE result='rejected'");
  const acc = queryAll("SELECT * FROM scan_log WHERE result='accepted'");
  assert.ok(rej.length >= 3, "rejections logged");
  assert.ok(acc.length >= 1, "acceptances logged");
  assert.ok(rej.every((r) => r.scanner_id != null && r.reason != null));
});
