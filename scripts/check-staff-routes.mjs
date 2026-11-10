#!/usr/bin/env node
/**
 * Staff-route sweep: signs in as the development owner and requests every
 * staff / juice-bar route, reporting anything that does not return 200.
 *
 *   node scripts/check-staff-routes.mjs [baseUrl]
 *
 * Development-only: it uses the seeded dev owner credentials. It never
 * mutates data and refuses to run when NODE_ENV=production.
 */
if (process.env.NODE_ENV === "production") {
  console.error("[staff-routes] Refusing to run: NODE_ENV=production.");
  process.exit(1);
}

const base = process.argv[2] ?? "http://127.0.0.1:8787";
const phone = process.env.MNM_OWNER_PHONE ?? "+254705687273";
const password = process.env.MNM_OWNER_PASSWORD ?? "dev-owner-password";

let cookie = "";

async function req(path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(new URL(path, base), { ...opts, headers, redirect: "manual" });
  const sc = res.headers.get("set-cookie");
  if (sc && !cookie) cookie = sc.split(";")[0];
  return res;
}

// --- sign in -------------------------------------------------------------
const login = await req("/staff/login", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base },
  body: new URLSearchParams({ phone, password, next: "/staff" }).toString(),
});
if (login.status !== 302) {
  console.error(`[staff-routes] Login failed (status ${login.status}). Is the dev database seeded?`);
  process.exit(1);
}
console.log("[staff-routes] signed in as dev owner");

// --- collect route ids from the live database so we test real links ------
const { DatabaseSync } = await import("node:sqlite");
const dbFile = process.env.DATABASE_FILE ?? "data/mnm-dev.sqlite";
const db = new DatabaseSync(dbFile);
const orderId = db.prepare("SELECT id FROM juice_orders ORDER BY id LIMIT 1").get()?.id;
const productId = db.prepare("SELECT id FROM products ORDER BY id LIMIT 1").get()?.id;
const zoneId = db.prepare("SELECT id FROM delivery_zones ORDER BY id LIMIT 1").get()?.id;
const enquiryId = db.prepare("SELECT id FROM catering_enquiries ORDER BY id LIMIT 1").get()?.id;
const eventId = db.prepare("SELECT id FROM events ORDER BY id LIMIT 1").get()?.id;
db.close();

const ROUTES = [
  "/staff",
  "/staff/juice",
  "/staff/juice/orders",
  "/staff/juice/products",
  "/staff/juice/products/new",
  "/staff/juice/delivery",
  "/staff/juice/delivery/new",
  "/staff/juice/reviews",
  "/staff/juice/catering",
  "/staff/juice/settings",
  "/staff/orders",
  "/staff/events",
  "/staff/scan",
  orderId ? `/staff/juice/orders/${orderId}` : null,
  orderId ? `/staff/juice/orders/${orderId}/receipt` : null,
  productId ? `/staff/juice/products/${productId}` : null,
  zoneId ? `/staff/juice/delivery/${zoneId}` : null,
  eventId ? `/staff/events/${eventId}/ticket` : null,
].filter(Boolean);

const results = [];
for (const path of ROUTES) {
  const res = await req(path);
  const ct = res.headers.get("content-type") ?? "";
  let note = "";
  if (res.status === 500) {
    const body = await res.text();
    const m = body.match(/<pre[^>]*>([\s\S]{0, 400}?)<\/pre>/i);
    note = m ? m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
  }
  results.push({ path, status: res.status, ct, note });
}

const bad = results.filter((r) => r.status !== 200);
console.log(`[staff-routes] checked ${results.length} authenticated route(s)`);
for (const r of results) {
  const mark = r.status === 200 ? "ok " : "BAD";
  console.log(`  ${mark} ${String(r.status).padEnd(4)} ${r.path}${r.note ? "  :: " + r.note : ""}`);
}
if (bad.length) {
  console.log(`[staff-routes] ${bad.length} route(s) did not return 200`);
  process.exitCode = 1;
} else {
  console.log("[staff-routes] OK — every staff route returned 200.");
}
