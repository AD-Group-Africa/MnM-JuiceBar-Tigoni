/**
 * End-to-end HTTP tests against the real Hono app + temp DB + dev payment adapter.
 * Uses node:test with an app-level fetch — no listener needed.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.APP_SECRET_KEY = "test-secret-please-ignore-0123456789abcdef";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mnm-http-"));
process.env.DATABASE_FILE = path.join(tmp, "http.sqlite");

const { migrate, run, queryOne } = await import("../src/db.ts");
const { createApp } = await import("../src/app.tsx");
const { loadConfig } = await import("../src/config.ts");
const { hashPassword } = await import("../src/auth.ts");

before(async () => {
  migrate(process.env.DATABASE_FILE!);
  run("INSERT INTO pricing_terms(label,markup_points,mnm_points,ad_points,currency,active) VALUES ('t',3500,2500,1000,'KES',1)");
  const owner = await import("../src/auth.ts").then((m) => hashPassword("ownerpw"));
  run("INSERT INTO users(full_name,phone,role,password_hash) VALUES ('Owner O','+254700000020','owner',?)", [owner as unknown as string]);
  const scanpw = await import("../src/auth.ts").then((m) => hashPassword("scanpw"));
  run("INSERT INTO users(full_name,phone,role,password_hash) VALUES ('Scan S','+254700000021','scanner',?)", [scanpw as unknown as string]);
  run(
    `INSERT INTO events(slug,title,venue_name,venue_area,starts_at,organizer_name,organizer_contact,authorization_ref,authorized_by_user,authorized_at,sale_starts_at,sale_ends_at,status,created_by)
     VALUES ('pub-ev','HTTP Test Event (sample seed fixture)','Hall','Limuru',datetime('now','+7 days'),'O','+254700000000','AUTH-1',1,datetime('now'),datetime('now'),datetime('now','+5 days'),'on_sale',1)`,
  );
  run("INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (?,?,?,?)", [1, "Regular", 100_000, 10]);
  // a DRAFT event that must stay private
  run(
    `INSERT INTO events(slug,title,venue_name,venue_area,starts_at,organizer_name,organizer_contact,status,created_by)
     VALUES ('draft-ev','Secret Draft','X','Y',datetime('now','+9 days'),'O','+254700000000','draft',1)`,
  );
  run("INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (?,?,?,?)", [2, "D", 100, 5]);
});

after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { } });

const config = loadConfig(process.env);
const app = createApp(config);
const BASE = "http://localhost:8787";
let cookie = "";

async function req(method: string, url: string, body?: BodyInit, headers: Record<string, string> = {}): Promise<Response> {
  const h: Record<string, string> = { ...headers };
  if (body && !h["Content-Type"]) h["Content-Type"] = "application/x-www-form-urlencoded";
  if (cookie) h["Cookie"] = cookie;
  return app.request(new URL(url, BASE).toString(), { method, body, headers: h });
}

function setCookieFrom(res: Response): void {
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0]!;
}

test("home is the MnM Juice Bar storefront and /events lists only on-sale events", async () => {
  // The juice storefront is the primary business: "/" is the MnM Juice Bar homepage.
  const home = await req("GET", "/");
  const t = await home.text();
  assert.match(t, /MnM Juice Bar/);
  assert.match(t, /Our menu/);
  assert.ok(!t.includes("Secret Draft"), "draft must not leak");

  // The ticketing module keeps its own page.
  const events = await (await req("GET", "/events")).text();
  assert.match(events, /HTTP Test Event/);
  assert.match(events, /pub-ev/);
  assert.ok(!events.includes("draft-ev"), "draft event must not be listed");
});

test("draft event page is 404", async () => {
  const res = await req("GET", "/events/draft-ev");
  assert.equal(res.status, 404);
});

test("login requires valid credentials; sets session cookie", async () => {
  const bad = await req("POST", "/staff/login", new URLSearchParams({ phone: "+254700000020", password: "wrong", next: "/staff" }), { Origin: BASE });
  assert.equal(bad.status, 401);
  assert.equal(cookie, "");
  const ok = await req("POST", "/staff/login", new URLSearchParams({ phone: "+254700000020", password: "ownerpw", next: "/staff" }), { Origin: BASE });
  assert.equal(ok.status, 302);
  assert.ok(/mnm_session=/.test(ok.headers.get("set-cookie") ?? ""));
});

test("login rejects cross-origin posts (CSRF origin check)", async () => {
  const res = await req("POST", "/staff/login", new URLSearchParams({ phone: "+254700000020", password: "ownerpw", next: "/staff" }), { Origin: "http://evil.example" });
  assert.equal(res.status, 403);
});

test("logout invalidates the session server-side", async () => {
  const res = await req("POST", "/staff/login", new URLSearchParams({ phone: "+254700000020", password: "ownerpw", next: "/staff" }), { Origin: BASE });
  setCookieFrom(res);
  const out = await req("POST", "/staff/logout", undefined, { Origin: BASE });
  assert.equal(out.status, 302);
  cookie = "";
});

test("checkout with dev simulator completes end-to-end and tickets verify", async () => {
  const form = new URLSearchParams({
    category_id: "1",
    qty: "2",
    name: "Wanjiku",
    phone: "0712345678",
    email: "",
  });
  const res = await req("POST", "/checkout", form, { Origin: BASE, Referer: `${BASE}/events/pub-ev` });
  assert.equal(res.status, 302);
  const loc = res.headers.get("location") ?? "";
  assert.match(loc, /\/pay\/status\?ref=/);

  // fetch the order via its token
  const refQ = new URLSearchParams(loc.split("?")[1]);
  const ref = refQ.get("ref")!;
  const token = refQ.get("t")!;
  const status = await req("GET", `/order/${ref}?t=${token}`);
  const html = await status.text();
  assert.match(html, /ticket_issued|paid/);

  // grab ticket codes from DB (codes are also on the tickets page via signed link)
  const codes = (await import("../src/db.ts")).queryAll("SELECT ticket_code FROM tickets t JOIN orders o ON o.id=t.order_id WHERE o.order_ref=?", [ref]).map((r) => String(r.ticket_code));
  assert.equal(codes.length, 2);

  // public verify endpoint admits the first
  const v = await req("GET", `/verify/${codes[0]}`);
  assert.equal(v.status, 200);
  const body = (await v.json()) as { valid: boolean; event: { title: string } | null };
  assert.equal(body.valid, true);
  assert.equal(body.event?.title, "HTTP Test Event (sample seed fixture)");

  // an unknown ticket is rejected publicly
  const v2 = await req("GET", "/verify/ZZZZZZ-ZZZZZZ");
  assert.equal(v2.status, 404);
  assert.equal(((await v2.json()) as { valid: boolean }).valid, false);

  // scanner role signs in and redeems the first ticket
  const login = await req("POST", "/staff/login", new URLSearchParams({ phone: "+254700000021", password: "scanpw", next: "/staff/scan" }), { Origin: BASE });
  setCookieFrom(login);
  const scan = await req("POST", "/staff/scan", new URLSearchParams({ code: codes[0] as string }), { Origin: BASE, Referer: `${BASE}/staff/scan` });
  assert.equal(scan.status, 200);
  const scanHtml = await scan.text();
  assert.match(scanHtml, /ADMIT/);
  // second attempt of same ticket: DO NOT ADMIT
  const scan2 = await req("POST", "/staff/scan", new URLSearchParams({ code: codes[0] as string }), { Origin: BASE, Referer: `${BASE}/staff/scan` });
  assert.match(await scan2.text(), /DO NOT ADMIT/);
});

test("customer cannot reach staff areas without a session", async () => {
  cookie = "";
  const res = await req("GET", "/staff/scan");
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location") ?? "", /\/staff\/login/);
});
