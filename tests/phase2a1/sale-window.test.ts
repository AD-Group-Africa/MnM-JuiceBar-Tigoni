/**
 * Phase 2A.1 — sale-window enforcement (known-defect suite).
 *
 * These tests exercise the real server-side order-creation service. They assert
 * the intended contract documented in Phase 2A:
 *   - start inclusive;
 *   - end exclusive;
 *   - server-side enforcement, not public-page filtering.
 *
 * They are expected to FAIL until Phase 2B enforces the window in createOrder.
 * Run with scripts/run-phase2a1-regressions.mjs; do not wire this directory into
 * `npm test`.
 */
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.APP_SECRET_KEY = "phase2a1-sale-secret-0123456789abcdef";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mnm-p2a1-sale-"));
process.env.DATABASE_FILE = path.join(tmp, "sale.sqlite");

const { migrate, run, queryOne } = await import("../../src/db.ts");
const { createOrder } = await import("../../src/orders.ts");
const { createApp } = await import("../../src/app.tsx");
const { loadConfig } = await import("../../src/config.ts");

const BASE = "http://localhost:8787";
const CLOCK = Date.UTC(2026, 10, 16, 9, 0, 0);
const at = (offsetMs: number) => new Date(CLOCK + offsetMs).toISOString();

let eventSeq = 0;

function makeEvent(start: string, end: string): { eventId: number; categoryId: number } {
  const n = ++eventSeq;
  const eventId = Number(run(
    `INSERT INTO events(slug,title,venue_name,venue_area,starts_at,organizer_name,organizer_contact,
                        authorization_ref,authorized_by_user,authorized_at,sale_starts_at,sale_ends_at,status,created_by)
     VALUES (?,?,'Hall','Limuru',?,'Organiser','+254700000000','AUTH',1,?,?,?,'on_sale',1)`,
    [`p2a1-sale-${n}`, `Sale ${n}`, at(7 * 86_400_000), at(0), start, end],
  ).lastInsertRowid);
  const categoryId = Number(run(
    "INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (?,?,?,?)",
    [eventId, `Tier ${n}`, 100_000, 20],
  ).lastInsertRowid);
  return { eventId, categoryId };
}

before(() => {
  migrate(process.env.DATABASE_FILE!);
  run("INSERT INTO pricing_terms(label,markup_points,mnm_points,ad_points,currency,active) VALUES ('p2a1',3500,2500,1000,'KES',1)");
  run("INSERT INTO users(full_name,phone,role,password_hash) VALUES ('P2A1 Owner','+254700000060','owner','scrypt$aa$bb')");
});

after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

function withClock<T>(fn: () => T): T {
  mock.timers.enable({ apis: ["Date"], now: CLOCK });
  try { return fn(); } finally { mock.timers.reset(); }
}

function buy(categoryId: number, name: string) {
  return createOrder({ categoryId, qty: 1, customerName: name, customerPhone: "0712345678" });
}

test("before opening: createOrder rejects", () => {
  const { categoryId } = makeEvent(at(60 * 60_000), at(120 * 60_000));
  withClock(() => {
    const res = buy(categoryId, "Early");
    assert.equal(res.ok, false, "a purchase before sale_starts_at must be rejected server-side");
  });
});

test("exactly at opening: createOrder permits (start inclusive)", () => {
  const { categoryId } = makeEvent(at(0), at(60 * 60_000));
  withClock(() => {
    const res = buy(categoryId, "At Open");
    assert.equal(res.ok, true, "the opening instant is inside the window");
  });
});

test("during the window: createOrder permits", () => {
  const { categoryId } = makeEvent(at(-60 * 60_000), at(60 * 60_000));
  withClock(() => {
    const res = buy(categoryId, "During");
    assert.equal(res.ok, true, "a valid purchase inside the window must succeed");
  });
});

test("exactly at closing: createOrder rejects (end exclusive)", () => {
  const { categoryId } = makeEvent(at(-60 * 60_000), at(0));
  withClock(() => {
    const res = buy(categoryId, "At Close");
    assert.equal(res.ok, false, "the closing instant is outside the window");
  });
});

test("after closing: createOrder rejects", () => {
  const { categoryId } = makeEvent(at(-120 * 60_000), at(-60 * 60_000));
  withClock(() => {
    const res = buy(categoryId, "Late");
    assert.equal(res.ok, false, "a purchase after sale_ends_at must be rejected server-side");
  });
});

test("public-page filtering is not the enforcement mechanism", async () => {
  const { categoryId } = makeEvent(at(60 * 60_000), at(120 * 60_000));
  const app = createApp(loadConfig(process.env));
  const page = await app.request(new URL("/events/p2a1-sale-6", BASE).toString());
  assert.equal(page.status, 404, "future event page is hidden");
  const res = buy(categoryId, "Bypass");
  assert.equal(res.ok, false, "direct order creation must still reject outside the window");
});
