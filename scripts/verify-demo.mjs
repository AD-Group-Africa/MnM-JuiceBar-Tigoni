/**
 * Controlled demonstration verification.
 * Runs against a live development server and the dev SQLite database.
 * Creates test orders/tickets (clearly named "Demo Verification") and scans one.
 * Usage: node scripts/verify-demo.mjs
 *
 * Requires a development server with the development payment simulator:
 *   PAYMENT_PROVIDER=dev NODE_ENV=development node dist/server.js
 * Set MNM_BASE to the exact origin the server allows in PUBLIC_ORIGINS.
 * Section 8 exercises the labelled dev simulator only; in payment-disabled
 * production mode ticket checkout correctly returns 503 and that section does
 * not apply. This script writes demo rows to the dev database and must never
 * be pointed at production.
 */
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";

const BASE = process.env.MNM_BASE ?? "http://localhost:8787";
const db = new DatabaseSync("data/mnm-dev.sqlite");
const results = [];
let failures = 0;

function check(name, fn) {
  try {
    const detail = fn();
    results.push(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    failures++;
    results.push(`FAIL  ${name} — ${e.message}`);
  }
}

async function req(method, path, { body, cookie, origin = BASE, redirect = "manual" } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (cookie) headers.Cookie = cookie;
  if (method !== "GET" && origin !== null) headers.Origin = origin;
  const res = await fetch(new URL(path, BASE), {
    method, headers, body: body ? new URLSearchParams(body) : undefined, redirect,
  });
  return res;
}

async function login(phone, password) {
  const res = await req("POST", "/staff/login", { body: { phone, password, next: "/staff" } });
  return { res, cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] };
}

const now = new Date().toISOString();
const stamp = String(Date.now()).slice(-6);

// ---------- 1. public pages & navigation ----------
for (const [path, needle, expected = 200] of [
  ["/", "home-hero"], ["/menu", "The menu"], ["/product/1", "Choose a size"],
  ["/product/5", "Protein scoop"], ["/cart", "Your order"],   ["/events", "What"],
  ["/events/sample-worship-night", "Choose your tier"], ["/tickets", "MnM Tickets"],
  ["/about", "story"], ["/catering", "catering"], ["/contact", "Visit"],
  ["/staff/login", "Sign in"],   ["/juice", "/menu", 301],
]) {
  const res = await req("GET", path);
  const html = await res.text();
  check(`page ${path}`, () => {
    assert.equal(res.status, expected, `status ${res.status}`);
    if (expected === 301) assert.match(res.headers.get("location") ?? "", new RegExp(needle));
    else assert.ok(html.toLowerCase().includes(needle.toLowerCase()), `missing "${needle}"`);
  });
}

// ---------- 2. owner login + cookie ----------
const owner = await login("+254 705 687 273", "dev-owner-password");
check("owner login with displayed spaced phone", () => {
  assert.equal(owner.res.status, 302);
  assert.match(owner.res.headers.get("location") ?? "", /\/staff$/);
  assert.ok(owner.cookie.startsWith("mnm_session="));
});
check("session cookie flags", () => {
  const raw = owner.res.headers.get("set-cookie") ?? "";
  assert.match(raw, /HttpOnly/);
  assert.match(raw, /SameSite=Lax/);
  assert.match(raw, /Max-Age=\d+/);
});

// ---------- 3. juice pickup order + customisation ----------
const p1 = db.prepare("SELECT * FROM products WHERE id=1").get();
const p5 = db.prepare("SELECT * FROM products WHERE id=5").get();
const items = [
  { productId: 1, qty: 2, sizeLabel: "Large", sizePriceMinor: 10000, addonsChosen: [], addonsPriceMinor: 0 },
  { productId: 5, qty: 1, sizeLabel: "Small", sizePriceMinor: 0, addonsChosen: ["Protein scoop"], addonsPriceMinor: 15000 },
];
const pickup = await req("POST", "/juice/checkout", {
  body: {
    items: JSON.stringify(items), type: "pickup",
    customerName: `Demo Verification Pickup ${stamp}`, customerPhone: "0712345678",
    customerNotes: "Automated verification — pickup",
  },
});
// The customer redirect carries the guest access token; the database stores the bare ref.
const pickupPath = pickup.headers.get("location") ?? "";
const pickupRef = pickupPath.split("/").pop().split("?")[0];
check("pickup order redirect", () => {
  assert.equal(pickup.status, 302);
  assert.match(pickupRef, /^MNM-J-/);
});
const pickupRow = db.prepare("SELECT * FROM juice_orders WHERE order_ref=?").get(pickupRef);
check("pickup totals recomputed server-side", () => {
  assert.ok(pickupRow, "order missing");
  assert.equal(pickupRow.subtotal_minor, 70000 + 50000);
  assert.equal(pickupRow.delivery_fee_minor, 0);
  assert.equal(pickupRow.total_minor, 120000);
});
const pickupPage = await (await req("GET", pickupPath)).text();
check("pickup confirmation shows collection journey", () => {
  assert.ok(pickupPage.includes("Awaiting collection"), "pickup journey label missing");
  assert.ok(pickupPage.includes(pickupRef));
  assert.ok(pickupPage.includes("Kabuku") || pickupPage.includes("collection"));
});

// ---------- 4. staff status transitions ----------
async function setStatus(id, status) {
  return req("POST", `/staff/juice/orders/${id}/status`, {
    body: { status, note: "Demo verification" }, cookie: owner.cookie,
  });
}
// Skipping states must be refused; the real path must succeed.
const invalidJump = await setStatus(pickupRow.id, "preparing");
const toAccepted = await setStatus(pickupRow.id, "accepted");
const toPreparing = await setStatus(pickupRow.id, "preparing");
const toReady = await setStatus(pickupRow.id, "ready_for_pickup");
const toCollected = await setStatus(pickupRow.id, "delivered");
check("status machine refuses invalid jumps and accepts the pickup path", () => {
  assert.equal(invalidJump.status, 400, "new -> preparing must be refused");
  assert.equal(toAccepted.status, 302);
  assert.equal(toPreparing.status, 302);
  assert.equal(toReady.status, 302);
  assert.equal(toCollected.status, 302);
  const row = db.prepare("SELECT status FROM juice_orders WHERE id=?").get(pickupRow.id);
  assert.equal(row.status, "delivered");
});
const deliveredPage = await (await req("GET", pickupPath)).text();
check("customer confirmation reflects final status", () => {
  assert.ok(/Collected|Delivered/.test(deliveredPage), "final journey state missing");
  assert.ok(deliveredPage.includes("Thank you"));
});

// ---------- 5. delivery order ----------
const delivery = await req("POST", "/juice/checkout", {
  body: {
    items: JSON.stringify([{ productId: 1, qty: 2, sizeLabel: "Small", sizePriceMinor: 0, addonsChosen: [], addonsPriceMinor: 0 }]),
    type: "delivery", deliveryZoneId: "1",
    deliveryAddress: "12 Demo Road, Kabuku", deliveryContact: "Gate 2",
    customerName: `Demo Verification Delivery ${stamp}`, customerPhone: "0712345678",
    customerNotes: "Automated verification — delivery",
  },
});
const deliveryPath = delivery.headers.get("location") ?? "";
const deliveryRef = deliveryPath.split("/").pop().split("?")[0];
const deliveryRow = db.prepare("SELECT * FROM juice_orders WHERE order_ref=?").get(deliveryRef);
check("delivery order applies zone fee and minimum", () => {
  assert.equal(delivery.status, 302);
  assert.ok(deliveryRow, "delivery order missing");
  assert.equal(deliveryRow.subtotal_minor, 50000);
  assert.equal(deliveryRow.delivery_fee_minor, 5000);
  assert.equal(deliveryRow.total_minor, 55000);
  assert.equal(deliveryRow.type, "delivery");
});
const dAccepted = await setStatus(deliveryRow.id, "accepted");
const dPreparing = await setStatus(deliveryRow.id, "preparing");
const dReady = await setStatus(deliveryRow.id, "ready_for_dispatch");
const dOut = await setStatus(deliveryRow.id, "out_for_delivery");
const deliveryPage = await (await req("GET", deliveryPath)).text();
check("delivery order follows its dispatch path", () => {
  assert.equal(dAccepted.status, 302);
  assert.equal(dPreparing.status, 302);
  assert.equal(dReady.status, 302);
  assert.equal(dOut.status, 302);
  const row = db.prepare("SELECT status FROM juice_orders WHERE id=?").get(deliveryRow.id);
  assert.equal(row.status, "out_for_delivery");
  assert.ok(deliveryPage.includes("On the way"), "dispatch journey label missing");
  assert.ok(deliveryPage.includes("12 Demo Road, Kabuku"));
});

// ---------- 6. management surfaces ----------
const orderDetail = await req("GET", `/staff/juice/orders/${pickupRow.id}`, { cookie: owner.cookie });
const productEdit = await req("GET", "/staff/juice/products/1", { cookie: owner.cookie });
const productList = await req("GET", "/staff/juice/products", { cookie: owner.cookie });
const eventsPage = await req("GET", "/staff/events", { cookie: owner.cookie });
check("owner can open order/product/event management", () => {
  assert.equal(orderDetail.status, 200);
  assert.equal(productEdit.status, 200);
  assert.equal(productList.status, 200);
  assert.equal(eventsPage.status, 200);
});
const orderHtml = await orderDetail.text();
check("order detail shows customer and status controls", () => {
  assert.ok(orderHtml.includes("Demo Verification Pickup") || orderHtml.includes("Wanjiku") || orderHtml.includes("customer"));
  assert.ok(/status/i.test(orderHtml));
});

// No-op product save: same values, proving the edit path works without changing the demo menu.
const saveProduct = await req("POST", "/staff/juice/products/1", {
  cookie: owner.cookie,
  body: {
    name: p1.name, sku: p1.sku, categoryId: String(p1.category_id), price: (p1.price_minor / 100).toFixed(2),
    description: p1.description, ingredientNote: p1.ingredient_note ?? "", sortOrder: String(p1.sort_order),
    sizesJson: p1.sizes ?? "", addonsJson: p1.addons ?? "",
    available: p1.available ? "on" : "", featured: p1.featured ? "on" : "", bestseller: p1.bestseller ? "on" : "",
  },
});
check("product save path works (no-op update)", () => {
  assert.equal(saveProduct.status, 302);
  const row = db.prepare("SELECT name, price_minor FROM products WHERE id=1").get();
  assert.equal(row.price_minor, p1.price_minor);
  assert.equal(row.name, p1.name);
});

// ---------- 7. role restrictions ----------
const sales = await login("+254700000003", "dev-staff-password");
const scanner = await login("+254700000004", "dev-scanner-password");
const salesEvents = await req("GET", "/staff/events", { cookie: sales.cookie });
const salesProductSave = await req("POST", "/staff/juice/products/1", {
  cookie: sales.cookie, body: { name: "Should not save" },
});
const scannerFinance = await req("GET", "/staff/orders", { cookie: scanner.cookie });
const anonStaff = await req("GET", "/staff/juice/orders");
check("role restrictions enforced server-side", () => {
  assert.equal(salesEvents.status, 302, "sales staff must not open event finance");
  assert.equal(salesProductSave.status, 403, "sales staff must not save products");
  assert.equal(scannerFinance.status, 302, "scanner must not open ticket finance");
  assert.equal(anonStaff.status, 302, "anonymous must be redirected to login");
});

// ---------- 8. ticketing purchase, issuance, scan ----------
const ticketBuy = await req("POST", "/checkout", {
  body: { category_id: "3", name: `Demo Verification Ticket ${stamp}`, phone: "0712345678", email: "", qty: "1" },
});
const payUrl = ticketBuy.headers.get("location") ?? "";
check("ticket purchase creates simulated payment session", () => {
  assert.equal(ticketBuy.status, 302);
  assert.match(payUrl, /\/pay\/status\?ref=MNM-/);
});
const payPage = await (await req("GET", payUrl)).text();
const ticketLink = payPage.match(/href="(\/t\/[^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
check("payment result links to issued ticket", () => {
  assert.ok(ticketLink, "ticket link missing");
  assert.ok(/tickets are ready|Your tickets/i.test(payPage));
});
const ticketPageRes = await req("GET", ticketLink);
const ticketPage = await ticketPageRes.text();
const code = ticketPage.match(/class="code">([A-Z0-9-]+)</)?.[1];
check("digital ticket rendered with QR and code", () => {
  assert.equal(ticketPageRes.status, 200);
  assert.ok(code, "ticket code missing");
  assert.ok(ticketPage.includes("data:image/svg+xml"), "QR image missing");
  assert.ok(ticketPage.includes("Admission instructions"));
});

const scan1 = await req("POST", "/staff/scan", { cookie: scanner.cookie, body: { code } });
const scan1Html = await scan1.text();
const scan2 = await req("POST", "/staff/scan", { cookie: scanner.cookie, body: { code } });
const scan2Html = await scan2.text();
check("first scan admits", () => {
  assert.equal(scan1.status, 200);
  assert.ok(scan1Html.includes("ADMIT"));
  assert.ok(!scan1Html.includes("DO NOT ADMIT"));
});
check("duplicate scan refused", () => {
  assert.equal(scan2.status, 200);
  assert.ok(scan2Html.includes("DO NOT ADMIT"));
});
const scanHistory = await (await req("GET", "/staff/scan", { cookie: scanner.cookie })).text();
check("scan history lists both attempts", () => {
  assert.ok(scanHistory.includes(code), "code missing from history");
  assert.ok((scanHistory.match(/admitted/g) ?? []).length >= 1);
  assert.ok((scanHistory.match(/refused/g) ?? []).length >= 1);
});
const redeemedPage = await (await req("GET", ticketLink)).text();
check("ticket page reflects redeemed status", () => {
  assert.ok(redeemedPage.includes("redeemed") || redeemedPage.includes("state-redeemed"));
});

// ---------- summary ----------
console.log(results.join("\n"));
console.log(`\n${results.length - failures}/${results.length} checks passed.`);
db.close();
process.exit(failures ? 1 : 0);
