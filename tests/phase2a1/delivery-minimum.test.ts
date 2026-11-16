/**
 * Phase 2A.1 — delivery minimum (known-defect suite).
 *
 * Exercises the real createJuiceOrder service. The only policy asserted here is
 * the established minimum boundary: below minimum rejects, exactly at minimum
 * accepts, pickup is exempt. Discount/customisation basis remains a founder
 * decision and is not encoded here.
 *
 * Expected to FAIL below the minimum until Phase 2B enforces minOrderMinor.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.APP_SECRET_KEY = "phase2a1-juice-secret-0123456789abcdef";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mnm-p2a1-juice-"));
process.env.DATABASE_FILE = path.join(tmp, "juice.sqlite");

const { migrate, run, queryOne } = await import("../../src/db.ts");
const { createJuiceOrder } = await import("../../src/juice.ts");

const PRODUCT_MINOR = 15_000; // KES 150
const ZONE_MIN_MINOR = 30_000; // KES 300
const ZONE_FEE_MINOR = 5_000;

let productId = 0;
let zoneId = 0;
let disabledZoneId = 0;

before(() => {
  migrate(process.env.DATABASE_FILE!);
  const categoryId = Number(run("INSERT INTO product_categories(name) VALUES ('P2A1 Juice Category')").lastInsertRowid);
  productId = Number(run(
    `INSERT INTO products(category_id, sku, name, description, price_minor, available)
     VALUES (?, 'P2A1-MIN', 'P2A1 Juice', 'Minimum test', ?, 1)`,
    [categoryId, PRODUCT_MINOR],
  ).lastInsertRowid);
  zoneId = Number(run(
    "INSERT INTO delivery_zones(name, description, fee_minor, min_order_minor, enabled, sort_order) VALUES ('P2A1 Zone','Test',?,?,1,1)",
    [ZONE_FEE_MINOR, ZONE_MIN_MINOR],
  ).lastInsertRowid);
  disabledZoneId = Number(run(
    "INSERT INTO delivery_zones(name, description, fee_minor, min_order_minor, enabled, sort_order) VALUES ('P2A1 Disabled','Test',0,0,0,2)",
  ).lastInsertRowid);
});

after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

function delivery(qty: number, extra: Record<string, unknown> = {}) {
  return createJuiceOrder({
    items: [{ productId, qty }],
    type: "delivery",
    deliveryZoneId: zoneId,
    customerName: "Delivery Tester",
    customerPhone: "+254711111111",
    deliveryAddress: "Test Street",
    ...extra,
  } as never);
}

test("below minimum: createJuiceOrder rejects", () => {
  const res = delivery(1);
  assert.equal(res.ok, false, "KES 150 delivery must not be accepted against a KES 300 minimum");
  assert.match(res.msg ?? "", /minimum|300/i);
});

test("exactly at minimum: createJuiceOrder accepts and charges the zone fee", () => {
  const res = delivery(2); // 2 × 150 = 300
  assert.equal(res.ok, true, res.msg);
  const row = queryOne("SELECT subtotal_minor, delivery_fee_minor, total_minor FROM juice_orders WHERE id=?", [res.orderId!])!;
  assert.equal(Number(row.subtotal_minor), ZONE_MIN_MINOR);
  assert.equal(Number(row.delivery_fee_minor), ZONE_FEE_MINOR);
  assert.equal(Number(row.total_minor), ZONE_MIN_MINOR + ZONE_FEE_MINOR);
});

test("above minimum: createJuiceOrder accepts", () => {
  const res = delivery(3);
  assert.equal(res.ok, true, res.msg);
});

test("pickup is exempt from the delivery minimum", () => {
  const res = createJuiceOrder({
    items: [{ productId, qty: 1 }],
    type: "pickup",
    customerName: "Pickup Tester",
    customerPhone: "+254722222222",
  });
  assert.equal(res.ok, true, res.msg);
  const row = queryOne("SELECT delivery_fee_minor, total_minor FROM juice_orders WHERE id=?", [res.orderId!])!;
  assert.equal(Number(row.delivery_fee_minor), 0);
  assert.equal(Number(row.total_minor), PRODUCT_MINOR);
});

test("browser-submitted totals cannot bypass the minimum", () => {
  const res = delivery(1, { subtotalMinor: 999_999, totalMinor: 999_999 });
  assert.equal(res.ok, false, "client-supplied totals must not make a below-minimum cart eligible");
});

test("server-resolved prices are used for the minimum decision", () => {
  const res = delivery(1, { sizePriceMinor: 999_999, addonsPriceMinor: 999_999 });
  assert.equal(res.ok, false, "unconfigured client extras must not raise the server subtotal");
});

test("unknown zones cannot bypass the rule", () => {
  const res = delivery(1, { deliveryZoneId: 999_999 });
  assert.equal(res.ok, false);
});

test("disabled zones cannot bypass the rule", () => {
  const res = delivery(1, { deliveryZoneId: disabledZoneId });
  assert.equal(res.ok, false);
});
