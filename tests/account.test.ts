import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.PAYMENT_PROVIDER = "dev";
process.env.APP_SECRET_KEY = "account-test-secret-0123456789abcdef";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mnm-account-"));
process.env.DATABASE_FILE = path.join(tmp, "account.sqlite");
process.env.PUBLIC_ORIGINS = "http://localhost:8787";

const { migrate, run, queryOne } = await import("../src/db.ts");
const { createApp } = await import("../src/app.tsx");
const { loadConfig } = await import("../src/config.ts");

const BASE = "http://localhost:8787";
const app = createApp(loadConfig(process.env));
let productId = 0;
let categoryId = 0;

before(() => {
  migrate(process.env.DATABASE_FILE!);
  run("INSERT INTO pricing_terms(label,markup_points,mnm_points,ad_points,currency,active) VALUES ('acct',3500,2500,1000,'KES',1)");
  run("INSERT INTO users(full_name,phone,role,password_hash) VALUES ('Account Owner','+254700000099','owner','scrypt$aa$bb')");
  categoryId = Number(run("INSERT INTO product_categories(name) VALUES ('Account Category')").lastInsertRowid);
  productId = Number(run(
    "INSERT INTO products(category_id,sku,name,price_minor,available,created_by) VALUES (?,?,?,?,1,1)",
    [categoryId, "ACCT-001", "Account Mango", 25000],
  ).lastInsertRowid);
});

after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

async function post(url: string, body: Record<string, string>, cookie = ""): Promise<Response> {
  return app.request(new URL(url, BASE).toString(), {
    method: "POST",
    body: new URLSearchParams(body),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: BASE,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
}

async function get(url: string, cookie = ""): Promise<Response> {
  return app.request(new URL(url, BASE).toString(), { headers: cookie ? { Cookie: cookie } : {} });
}

function sessionCookie(res: Response): string {
  const raw = res.headers.get("set-cookie");
  assert.ok(raw, "expected a customer session cookie");
  return raw.split(";")[0]!;
}

test("customer register, account page and logout", async () => {
  const reg = await post("/account/register", {
    full_name: "Account Customer",
    phone: "0712000001",
    password: "customer-password",
  });
  assert.equal(reg.status, 302);
  const cookie = sessionCookie(reg);
  assert.match(cookie, /mnm_customer=/);

  const page = await get("/account", cookie);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Account Customer/);
  assert.match(html, /\+254712000001/);

  const out = await post("/account/logout", {}, cookie);
  assert.equal(out.status, 302);
  const after = await get("/account", cookie);
  assert.equal(after.status, 302, "destroyed session must not open the account");
});

test("bad password is refused and duplicate phone is refused", async () => {
  const bad = await post("/account/login", { phone: "0712000001", password: "wrong-password" });
  assert.equal(bad.status, 401);
  const dup = await post("/account/register", {
    full_name: "Duplicate",
    phone: "0712000001",
    password: "another-password",
  });
  assert.equal(dup.status, 400);
  assert.match(await dup.text(), /already exists/i);
});

test("signed-in juice checkout is linked and visible only to its owner", async () => {
  const reg = await post("/account/register", {
    full_name: "Juice Owner",
    phone: "0712000002",
    password: "juice-password",
  });
  const cookie = sessionCookie(reg);

  const checkout = await post("/juice/checkout", {
    items: JSON.stringify([{ productId, qty: 1 }]),
    type: "pickup",
    customerName: "Juice Owner",
    customerPhone: "+254712000002",
  }, cookie);
  assert.equal(checkout.status, 302);
  const location = checkout.headers.get("location")!;
  const ref = decodeURIComponent(new URL(location, BASE).pathname.split("/").pop()!);

  const account = await get("/account", cookie);
  assert.equal(account.status, 200);
  assert.ok((await account.text()).includes(ref), "linked juice order appears in history");

  const open = await get(`/account/orders/juice/${encodeURIComponent(ref)}`, cookie);
  assert.equal(open.status, 302);
  assert.match(open.headers.get("location") ?? "", /\/juice\/order\/.+\?t=/);

  const other = await post("/account/register", {
    full_name: "Other Customer",
    phone: "0712000003",
    password: "other-password",
  });
  const otherPage = await get("/account", sessionCookie(other));
  assert.equal(otherPage.status, 200);
  assert.ok(!(await otherPage.text()).includes(ref), "another customer must not see the order");

  const foreignOpen = await get(`/account/orders/juice/${encodeURIComponent(ref)}`, sessionCookie(other));
  assert.equal(foreignOpen.status, 404);
});

test("signed-in ticket checkout is linked and openable from account history", async () => {
  const reg = await post("/account/register", {
    full_name: "Ticket Owner",
    phone: "0712000004",
    password: "ticket-password",
  });
  const cookie = sessionCookie(reg);

  const ev = run(
    `INSERT INTO events(slug,title,venue_name,venue_area,starts_at,organizer_name,organizer_contact,
                        authorization_ref,authorized_by_user,authorized_at,sale_starts_at,sale_ends_at,status,created_by)
     VALUES (?,?,'Hall','Limuru',datetime('now','+7 days'),'Org','+254700000000','AUTH',1,datetime('now'),datetime('now'),datetime('now','+1 day'),'on_sale',1)`,
    [`acct-event-${Date.now()}`, "Account Ticket Event"],
  );
  const cid = Number(run("INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (?,?,?,?)",
    [Number(ev.lastInsertRowid), "Tier", 100_000, 10]).lastInsertRowid);

  const checkout = await post("/checkout", {
    category_id: String(cid),
    qty: "1",
    name: "Ticket Owner",
    phone: "0712000004",
  }, cookie);
  assert.equal(checkout.status, 302, "dev checkout should complete");
  const ref = String(queryOne("SELECT order_ref FROM orders ORDER BY id DESC LIMIT 1")!.order_ref);

  const account = await get("/account", cookie);
  assert.equal(account.status, 200);
  assert.ok((await account.text()).includes(ref), "linked ticket order appears in history");

  const open = await get(`/account/orders/ticket/${encodeURIComponent(ref)}`, cookie);
  assert.equal(open.status, 302);
  assert.match(open.headers.get("location") ?? "", /\/order\/.+\?t=/);
});
