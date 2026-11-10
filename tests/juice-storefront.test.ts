/**
 * Juice module Sprint 2 verification: staff product management, order detail &
 * receipt rendering, review moderation, delivery zones, and the public checkout
 * journey — all against an isolated temp database.
 *
 * Payment note: no juice payment-initiation flow exists yet; these tests assert
 * that checkout NEVER marks an order paid without provider verification
 * (payment_status stays NULL). No real M-Pesa traffic is generated.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.APP_SECRET_KEY = "test-secret-please-ignore-0123456789abcdef";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mnm-juice-s2-"));
process.env.DATABASE_FILE = path.join(tmp, "juice.sqlite");

const { migrate, run, queryOne, queryAll } = await import("../src/db.ts");
const { createApp } = await import("../src/app.tsx");
const { loadConfig } = await import("../src/config.ts");
const { hashPassword } = await import("../src/auth.ts");
const { createJuiceOrder } = await import("../src/juice.ts");

const OWNER_PHONE = "+254700000030";
const SCANNER_PHONE = "+254700000031";
const OWNER_ID = 1;
const FIXTURE_SKU = "S2-MANGO";
const FIXTURE_PRICE_MINOR = 15_000;
const ZONE_FEE_MINOR = 5_000;

let categoryId = 0;
let productId = 0;
let zoneId = 0;
let reviewId = 0;

before(async () => {
  migrate(process.env.DATABASE_FILE!);
  run("INSERT INTO pricing_terms(label,markup_points,mnm_points,ad_points,currency,active) VALUES ('t',3500,2500,1000,'KES',1)");
  run("INSERT INTO users(full_name,phone,role,password_hash) VALUES ('Owner O',?,'owner',?)", [OWNER_PHONE, await hashPassword("ownerpw")]);
  run("INSERT INTO users(full_name,phone,role,password_hash) VALUES ('Scan S',?,'scanner',?)", [SCANNER_PHONE, await hashPassword("scanpw")]);
  categoryId = Number(run("INSERT INTO product_categories(name) VALUES ('S2 Verify Category')").lastInsertRowid);
  productId = Number(run(
    `INSERT INTO products(category_id, sku, name, description, price_minor, available, featured, bestseller, created_by)
     VALUES (?,?, 'Mango test smoothie', 'Fresh mango', ?, 1, 0, 0, ?)`,
    [categoryId, FIXTURE_SKU, FIXTURE_PRICE_MINOR, OWNER_ID],
  ).lastInsertRowid);
  zoneId = Number(run(
    "INSERT INTO delivery_zones(name, description, fee_minor, min_order_minor, enabled, sort_order) VALUES ('Tigoni test zone', 'Test area', ?, 30000, 1, 1)",
    [ZONE_FEE_MINOR],
  ).lastInsertRowid);
  reviewId = Number(run(
    "INSERT INTO reviews(product_id, rating, body, author_name, is_verified, status) VALUES (?, 5, 'Great test juice', 'Tester T', 1, 'pending')",
    [productId],
  ).lastInsertRowid);
});

after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

const config = loadConfig(process.env);
const app = createApp(config);
const BASE = "http://localhost:8787";

async function rawReq(method: string, url: string, body: BodyInit | undefined, cookie: string, headers: Record<string, string> = {}): Promise<Response> {
  const h: Record<string, string> = { ...headers };
  if (body && !h["Content-Type"]) h["Content-Type"] = "application/x-www-form-urlencoded";
  if (cookie) h["Cookie"] = cookie;
  // Browsers attach Origin to cross-document POSTs; mirror that so these tests
  // exercise the same-origin path. Passing Origin explicitly (including "") wins.
  if (method !== "GET" && h["Origin"] === undefined) h["Origin"] = BASE;
  return app.request(new URL(url, BASE).toString(), { method, body, headers: h });
}

async function loginAs(phone: string, password: string): Promise<string> {
  const res = await app.request(new URL("/staff/login", BASE).toString(), {
    method: "POST",
    body: new URLSearchParams({ phone, password, next: "/staff" }),
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: BASE },
  });
  const sc = res.headers.get("set-cookie");
  assert.ok(sc, "login must set a session cookie");
  return sc.split(";")[0]!;
}

let ownerCookie = "";
let scannerCookie = "";

async function ownerReq(method: string, url: string, fields: Record<string, string> = {}): Promise<Response> {
  if (!ownerCookie) ownerCookie = await loginAs(OWNER_PHONE, "ownerpw");
  const body = Object.keys(fields).length ? new URLSearchParams(fields) : undefined;
  return rawReq(method, url, body, ownerCookie, { Origin: BASE });
}

async function scannerReq(method: string, url: string, fields: Record<string, string> = {}): Promise<Response> {
  if (!scannerCookie) scannerCookie = await loginAs(SCANNER_PHONE, "scanpw");
  const body = Object.keys(fields).length ? new URLSearchParams(fields) : undefined;
  return rawReq(method, url, body, scannerCookie, { Origin: BASE });
}

function productCount(sku: string): number {
  return (queryOne("SELECT COUNT(*) AS n FROM products WHERE sku=?", [sku]) as { n: number }).n;
}

/** Current fixture-product price in minor units (the edit tests intentionally change it). */
function fixturePrice(): number {
  return Number((queryOne("SELECT price_minor FROM products WHERE id=?", [String(productId)]) as { price_minor: number }).price_minor);
}

// =========================================================================
// 1. Product form: creation
// =========================================================================

test("product create: owner creates a product that persists with minor-unit pricing", async () => {
  const res = await ownerReq("POST", "/staff/juice/products", {
    name: "S2 Passion Blast",
    categoryId: String(categoryId),
    price: "120.50",
    sku: "S2-NEW-1",
    sortOrder: "5",
    description: "Passion + pineapple",
    ingredientNote: "Contains no dairy",
    available: "on",
  });
  assert.equal(res.status, 302);
  assert.ok(res.headers.get("location")!.includes("/staff/juice/products?saved=1"), "success redirects with saved flag");

  const row = queryOne("SELECT * FROM products WHERE sku='S2-NEW-1'") as Record<string, unknown>;
  assert.ok(row, "product must be persisted");
  assert.equal(row.name, "S2 Passion Blast");
  assert.equal(row.price_minor, 12_050, "KES 120.50 must store as 12050 minor units");
  assert.equal(row.available, 1);
  assert.equal(row.category_id, categoryId);
  assert.equal(row.created_by, OWNER_ID, "created_by must record the acting staff user");
  assert.equal(row.currency, "KES");

  const audit = queryOne("SELECT * FROM audit_log WHERE action='product.create' AND entity_id=?", [String(row.id)]);
  assert.ok(audit, "create must write an audit entry");
});

test("product create: invalid and missing fields return 400 with clear messages and persist nothing", async () => {
  const before = productCount("S2-BAD-1");
  const res = await ownerReq("POST", "/staff/juice/products", {
    name: "",
    categoryId: "999999",
    price: "abc",
    sku: "S2-BAD-1",
    sortOrder: "NaN",
    available: "on",
  });
  assert.equal(res.status, 400);
  const html = await res.text();
  assert.ok(html.includes("Product name is required."), "name error shown");
  assert.ok(html.includes("valid category"), "category error shown");
  assert.ok(html.includes("Price must be a valid amount"), "price error shown");
  assert.ok(html.includes("Sort order must be a whole number"), "sort order error shown");
  assert.equal(productCount("S2-BAD-1"), before, "nothing must be persisted on validation failure");
});

test("product create: zero and negative prices are rejected", async () => {
  const zero = await ownerReq("POST", "/staff/juice/products", { name: "Zero", categoryId: String(categoryId), price: "0", available: "on" });
  assert.equal(zero.status, 400);
  assert.ok((await zero.text()).includes("Price must be greater than zero."));

  const negative = await ownerReq("POST", "/staff/juice/products", { name: "Neg", categoryId: String(categoryId), price: "-5", available: "on" });
  assert.equal(negative.status, 400);
  assert.ok((await negative.text()).includes("Price must be a valid amount"));
});

test("product create: malformed sizes/add-ons JSON is rejected", async () => {
  const notJson = await ownerReq("POST", "/staff/juice/products", {
    name: "BadSizes", categoryId: String(categoryId), price: "100", available: "on",
    sizesJson: "not json at all",
  });
  assert.equal(notJson.status, 400);
  assert.ok((await notJson.text()).includes("Sizes must be valid JSON"));

  const badEntry = await ownerReq("POST", "/staff/juice/products", {
    name: "BadEntry", categoryId: String(categoryId), price: "100", available: "on",
    addonsJson: '[{"price_minor": 500}]',
  });
  assert.equal(badEntry.status, 400);
  assert.ok((await badEntry.text()).includes("non-empty"));

  const badPrice = await ownerReq("POST", "/staff/juice/products", {
    name: "BadPrice", categoryId: String(categoryId), price: "100", available: "on",
    sizesJson: '[{"label":"Big","price_minor":-1}]',
  });
  assert.equal(badPrice.status, 400);
  assert.ok((await badPrice.text()).includes("invalid price"));
});

test("product create: valid sizes and add-ons JSON is normalised and stored", async () => {
  const res = await ownerReq("POST", "/staff/juice/products", {
    name: "S2 Sized", categoryId: String(categoryId), price: "150", sku: "S2-SIZED", available: "on",
    sizesJson: '[{"label":" Large ","price_minor":5000}]',
    addonsJson: '[{"name":"Extra avocado","price_minor":3000}]',
  });
  assert.equal(res.status, 302);
  const row = queryOne("SELECT sizes, addons FROM products WHERE sku='S2-SIZED'") as Record<string, unknown>;
  assert.deepEqual(JSON.parse(String(row.sizes)), [{ label: "Large", price_minor: 5000 }]);
  assert.deepEqual(JSON.parse(String(row.addons)), [{ name: "Extra avocado", price_minor: 3000 }]);
});

// =========================================================================
// 2. Product form: editing
// =========================================================================

test("product edit: updates fields but preserves created_by and currency", async () => {
  const res = await ownerReq("POST", `/staff/juice/products/${productId}`, {
    id: String(productId),
    name: "Mango test smoothie v2",
    categoryId: String(categoryId),
    price: "17.50",
    sku: FIXTURE_SKU,
    sortOrder: "1",
    available: "on",
    featured: "on",
  });
  assert.equal(res.status, 302);
  const row = queryOne("SELECT * FROM products WHERE id=?", [String(productId)]) as Record<string, unknown>;
  assert.equal(row.name, "Mango test smoothie v2");
  assert.equal(row.price_minor, 1750);
  assert.equal(row.featured, 1);
  assert.equal(row.created_by, OWNER_ID, "created_by must be preserved on edit");
  assert.equal(row.currency, "KES", "currency must be preserved on edit");
});

test("product edit: blank sizes field preserves existing sizes and add-ons", async () => {
  const sized = queryOne("SELECT id, sizes, addons FROM products WHERE sku='S2-SIZED'") as Record<string, unknown>;
  const res = await ownerReq("POST", `/staff/juice/products/${sized.id}`, {
    id: String(sized.id),
    name: "S2 Sized",
    categoryId: String(categoryId),
    price: "160",
    sku: "S2-SIZED",
    sortOrder: "0",
    available: "on",
    sizesJson: "",
    addonsJson: "",
  });
  assert.equal(res.status, 302);
  const row = queryOne("SELECT sizes, addons, price_minor FROM products WHERE id=?", [String(sized.id)]) as Record<string, unknown>;
  assert.equal(row.price_minor, 16_000);
  assert.deepEqual(JSON.parse(String(row.sizes)), [{ label: "Large", price_minor: 5000 }], "existing sizes must survive a blank field");
  assert.deepEqual(JSON.parse(String(row.addons)), [{ name: "Extra avocado", price_minor: 3000 }], "existing add-ons must survive a blank field");
});

test("product edit: updating a missing product returns a clear 400, not success", async () => {
  const res = await ownerReq("POST", "/staff/juice/products/999999", {
    id: "999999", name: "Ghost", categoryId: String(categoryId), price: "100", available: "on",
  });
  assert.equal(res.status, 400);
  assert.ok((await res.text()).includes("Product not found"));
});

// =========================================================================
// 3. Product form: duplicates, auth, DB errors
// =========================================================================

test("duplicate SKU: repeated submission fails clearly and does not duplicate the row", async () => {
  const first = await ownerReq("POST", "/staff/juice/products", {
    name: "S2 Dup", categoryId: String(categoryId), price: "90", sku: "S2-DUP", available: "on",
  });
  assert.equal(first.status, 302);
  assert.equal(productCount("S2-DUP"), 1);

  const second = await ownerReq("POST", "/staff/juice/products", {
    name: "S2 Dup again", categoryId: String(categoryId), price: "95", sku: "S2-DUP", available: "on",
  });
  assert.equal(second.status, 400, "duplicate SKU must not report success");
  assert.ok((await second.text()).includes("SKU is already used"), "duplicate must produce a clear message");
  assert.equal(productCount("S2-DUP"), 1, "exactly one row must remain");
  const kept = queryOne("SELECT name, price_minor FROM products WHERE sku='S2-DUP'") as Record<string, unknown>;
  assert.equal(kept.name, "S2 Dup", "the first submission must remain intact");
  assert.equal(kept.price_minor, 9000);
});

test("product create: unauthenticated requests are rejected", async () => {
  const res = await rawReq("POST", "/staff/juice/products", new URLSearchParams({ name: "X", categoryId: String(categoryId), price: "100" }), "");
  assert.equal(res.status, 403);
  assert.equal(productCount("S2-UNAUTH"), 0);
});

test("product create: authenticated scanner (no manage capability) is rejected", async () => {
  const res = await scannerReq("POST", "/staff/juice/products", {
    name: "S2 Unauthorised", categoryId: String(categoryId), price: "100", sku: "S2-UNAUTH", available: "on",
  });
  assert.equal(res.status, 403);
  assert.ok((await res.text()).includes("Forbidden"), "scanner lacks the manage capability entirely");
  assert.equal(productCount("S2-UNAUTH"), 0, "unauthorised role must not persist anything");
});

// =========================================================================
// 4. Product form: rendering
// =========================================================================

test("products list renders saved products, search filters, and the saved banner", async () => {
  const list = await ownerReq("GET", "/staff/juice/products");
  assert.equal(list.status, 200);
  const html = await list.text();
  assert.ok(html.includes("Mango test smoothie v2"), "saved product renders in the list");
  assert.ok(html.includes("S2-NEW-1"), "SKU renders in the list");

  const saved = await ownerReq("GET", "/staff/juice/products?saved=1");
  assert.ok((await saved.text()).includes("Product saved."), "saved banner renders");

  const search = await ownerReq("GET", "/staff/juice/products?q=Passion+Blast");
  const searchHtml = await search.text();
  assert.ok(searchHtml.includes("S2 Passion Blast"));
  assert.ok(!searchHtml.includes("Mango test smoothie v2"), "search must filter out non-matches");
});

test("product forms render with server-rendered fields; edit form is prefilled", async () => {
  const newForm = await ownerReq("GET", "/staff/juice/products/new");
  assert.equal(newForm.status, 200);
  const newHtml = await newForm.text();
  assert.ok(newHtml.includes('name="name"'));
  assert.ok(newHtml.includes('name="categoryId"'));
  assert.ok(newHtml.includes('name="price"'));

  const editForm = await ownerReq("GET", `/staff/juice/products/${productId}`);
  assert.equal(editForm.status, 200);
  const editHtml = await editForm.text();
  assert.ok(editHtml.includes('value="Mango test smoothie v2"'), "edit form prefills the name");
  assert.ok(editHtml.includes('value="17.50"'), "edit form prefills the price in KES");
  assert.ok(editHtml.includes(`name="id"`), "edit form posts the product id");
});

// =========================================================================
// 5. Order detail and receipt workflows
// =========================================================================

function makeOrder(type: "pickup" | "delivery", zone?: number): { orderId: number; orderRef: string } {
  const result = createJuiceOrder({
    items: [{ productId, qty: 2 }],
    type,
    customerName: "Detail Customer",
    customerPhone: "+254711111111",
    deliveryZoneId: zone,
    deliveryAddress: zone ? "Test Street 1" : undefined,
  });
  assert.ok(result.ok, result.msg ?? "fixture order must be created");
  return { orderId: result.orderId!, orderRef: result.orderRef! };
}

test("order detail renders the order with items, customer and integer-minor totals", async () => {
  const { orderId, orderRef } = makeOrder("pickup");
  const res = await ownerReq("GET", `/staff/juice/orders/${orderId}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes(orderRef), "order reference renders");
  assert.ok(html.includes("Detail Customer"), "customer name renders");
  assert.ok(html.includes("Mango test smoothie v2"), "line item renders");

  const price = fixturePrice();
  const row = queryOne("SELECT * FROM juice_orders WHERE id=?", [String(orderId)]) as Record<string, unknown>;
  assert.equal(row.subtotal_minor, price * 2, "money is stored in integer minor units");
  assert.equal(row.total_minor, price * 2);
  assert.equal(row.currency, "KES");
  const item = queryOne("SELECT * FROM juice_order_items WHERE juice_order_id=?", [String(orderId)]) as Record<string, unknown>;
  assert.equal(item.qty, 2);
  assert.equal(item.unit_price_minor, price);
  assert.equal(item.line_total_minor, price * 2);
});

test("receipt renders line items, quantities, totals and pending payment state", async () => {
  const { orderId, orderRef } = makeOrder("delivery", zoneId);
  const res = await ownerReq("GET", `/staff/juice/orders/${orderId}/receipt`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("ORDER RECEIPT"));
  assert.ok(html.includes(orderRef));
  assert.ok(html.includes("Mango test smoothie v2"));
  const price = fixturePrice();
  assert.ok(html.includes("KSh 17.50"), "unit price money renders formatted");
  assert.ok(html.includes("KSh 35.00"), "line/subtotal money renders formatted");
  assert.ok(html.includes("KSh 50.00"), "delivery fee renders formatted");
  assert.ok(html.includes("KSh 85.00"), "total renders formatted");
  assert.ok(html.includes(`/staff/juice/orders/${orderId}`), "receipt back-link uses a real URL");

  const row = queryOne("SELECT * FROM juice_orders WHERE id=?", [String(orderId)]) as Record<string, unknown>;
  assert.equal(row.delivery_fee_minor, ZONE_FEE_MINOR, "zone fee maps into the order in minor units");
  assert.equal(row.total_minor, price * 2 + ZONE_FEE_MINOR);
  assert.equal(row.payment_status, null, "order must not be marked paid without provider verification");
});

test("missing order returns 404 on detail and receipt", async () => {
  const detail = await ownerReq("GET", "/staff/juice/orders/999999");
  assert.equal(detail.status, 404);
  const receipt = await ownerReq("GET", "/staff/juice/orders/999999/receipt");
  assert.equal(receipt.status, 404);
});

test("order detail and receipt are inaccessible without a session", async () => {
  const { orderId } = makeOrder("pickup");
  const detail = await rawReq("GET", `/staff/juice/orders/${orderId}`, undefined, "");
  assert.equal(detail.status, 302);
  assert.ok(detail.headers.get("location")!.includes("/staff/login"));
  const receipt = await rawReq("GET", `/staff/juice/orders/${orderId}/receipt`, undefined, "");
  assert.equal(receipt.status, 302);
});

test("scanner role cannot reach staff order pages (outside authorised scope)", async () => {
  const { orderId } = makeOrder("pickup");
  const res = await scannerReq("GET", `/staff/juice/orders/${orderId}`);
  assert.equal(res.status, 302);
  assert.ok(res.headers.get("location")!.includes("/staff/login"));
});

// =========================================================================
// 6. Review moderation
// =========================================================================

function insertPendingReview(body: string): number {
  return Number(run(
    "INSERT INTO reviews(product_id, rating, body, author_name, is_verified, status) VALUES (?, 4, ?, 'Mod Tester', 0, 'pending')",
    [productId, body],
  ).lastInsertRowid);
}

test("moderation: approving a pending review persists and audits the change", async () => {
  const id = insertPendingReview("Approve me please");
  const res = await ownerReq("POST", "/staff/juice/reviews/moderate", { reviewId: String(id), status: "approved" });
  assert.equal(res.status, 302);
  const row = queryOne("SELECT status FROM reviews WHERE id=?", [String(id)]) as Record<string, unknown>;
  assert.equal(row.status, "approved");
  const audit = queryOne("SELECT * FROM audit_log WHERE action='review.approved' AND entity_id=?", [String(id)]);
  assert.ok(audit, "approval must be audited");
});

test("moderation: rejecting without a note is refused and leaves state intact", async () => {
  const id = insertPendingReview("Reject without note");
  const res = await ownerReq("POST", "/staff/juice/reviews/moderate", { reviewId: String(id), status: "rejected" });
  assert.equal(res.status, 400);
  assert.ok((await res.text()).includes("Rejection requires a note."));
  const row = queryOne("SELECT status FROM reviews WHERE id=?", [String(id)]) as Record<string, unknown>;
  assert.equal(row.status, "pending", "failed moderation must not change state");
});

test("moderation: rejecting with a note persists status and note", async () => {
  const id = insertPendingReview("Reject with note");
  const res = await ownerReq("POST", "/staff/juice/reviews/moderate", { reviewId: String(id), status: "rejected", note: "Contains unverified claims" });
  assert.equal(res.status, 302);
  const row = queryOne("SELECT status, rejection_note FROM reviews WHERE id=?", [String(id)]) as Record<string, unknown>;
  assert.equal(row.status, "rejected");
  assert.equal(row.rejection_note, "Contains unverified claims");
});

test("moderation: invalid action, invalid id and missing review are refused", async () => {
  const id = insertPendingReview("Bogus action target");
  const bogus = await ownerReq("POST", "/staff/juice/reviews/moderate", { reviewId: String(id), status: "banana" });
  assert.equal(bogus.status, 400);
  assert.ok((await bogus.text()).includes("Invalid moderation action"));
  assert.equal((queryOne("SELECT status FROM reviews WHERE id=?", [String(id)]) as { status: string }).status, "pending");

  const badId = await ownerReq("POST", "/staff/juice/reviews/moderate", { reviewId: "abc", status: "approved" });
  assert.equal(badId.status, 400);

  const missing = await ownerReq("POST", "/staff/juice/reviews/moderate", { reviewId: "999999", status: "approved" });
  assert.equal(missing.status, 400);
  assert.ok((await missing.text()).includes("Review not found."));
});

test("moderation: unauthenticated and unauthorised requests are rejected", async () => {
  const id = insertPendingReview("Auth target");
  const anon = await rawReq("POST", "/staff/juice/reviews/moderate", new URLSearchParams({ reviewId: String(id), status: "approved" }), "");
  assert.equal(anon.status, 403);
  const scanner = await scannerReq("POST", "/staff/juice/reviews/moderate", { reviewId: String(id), status: "approved" });
  assert.equal(scanner.status, 403);
  assert.equal((queryOne("SELECT status FROM reviews WHERE id=?", [String(id)]) as { status: string }).status, "pending");
});

test("moderation: repeating an approval is idempotent and does not corrupt state", async () => {
  const id = insertPendingReview("Repeat me");
  const first = await ownerReq("POST", "/staff/juice/reviews/moderate", { reviewId: String(id), status: "approved" });
  assert.equal(first.status, 302);
  const second = await ownerReq("POST", "/staff/juice/reviews/moderate", { reviewId: String(id), status: "approved" });
  assert.equal(second.status, 302);
  const row = queryOne("SELECT status FROM reviews WHERE id=?", [String(id)]) as Record<string, unknown>;
  assert.equal(row.status, "approved");
});

test("moderated reviews render in the staff UI with the right filter", async () => {
  const approved = await ownerReq("GET", "/staff/juice/reviews?status=approved");
  assert.equal(approved.status, 200);
  assert.ok((await approved.text()).includes("Approve me please"));

  const rejected = await ownerReq("GET", "/staff/juice/reviews?status=rejected");
  assert.ok((await rejected.text()).includes("Contains unverified claims"), "rejection note renders");
});

// =========================================================================
// 7. Delivery zones
// =========================================================================

test("zone create: valid zone persists fees in minor units", async () => {
  const res = await ownerReq("POST", "/staff/juice/delivery", {
    name: "S2 Test Zone", description: "Sprint 2 area", fee: "75", minOrder: "400", enabled: "on", sortOrder: "9",
  });
  assert.equal(res.status, 302);
  const row = queryOne("SELECT * FROM delivery_zones WHERE name='S2 Test Zone'") as Record<string, unknown>;
  assert.ok(row, "zone must be persisted");
  assert.equal(row.fee_minor, 7500, "KES 75 stores as 7500 minor units");
  assert.equal(row.min_order_minor, 40_000, "KES 400 stores as 40000 minor units");
  assert.equal(row.enabled, 1);
});

test("zone create/edit: invalid fees, names and malformed values are rejected", async () => {
  const badFee = await ownerReq("POST", "/staff/juice/delivery", { name: "Bad fee", fee: "abc", minOrder: "100", enabled: "on" });
  assert.equal(badFee.status, 400);
  assert.ok((await badFee.text()).includes("Delivery fee must be a valid amount"));

  const noName = await ownerReq("POST", "/staff/juice/delivery", { name: "", fee: "50", minOrder: "100", enabled: "on" });
  assert.equal(noName.status, 400);
  assert.ok((await noName.text()).includes("Zone name is required."));

  const badEdit = await ownerReq("POST", `/staff/juice/delivery/${zoneId}`, { name: "Tigoni test zone", fee: "-3", minOrder: "x", enabled: "on" });
  assert.equal(badEdit.status, 400);
  const row = queryOne("SELECT fee_minor, min_order_minor FROM delivery_zones WHERE id=?", [String(zoneId)]) as Record<string, unknown>;
  assert.equal(row.fee_minor, ZONE_FEE_MINOR, "invalid edit must not modify the zone");
});

test("zone edit: updates fee and toggles enabled off", async () => {
  const res = await ownerReq("POST", `/staff/juice/delivery/${zoneId}`, {
    name: "Tigoni test zone", description: "Updated", fee: "10", minOrder: "300", enabled: "off", sortOrder: "1",
  });
  assert.equal(res.status, 302);
  const row = queryOne("SELECT * FROM delivery_zones WHERE id=?", [String(zoneId)]) as Record<string, unknown>;
  assert.equal(row.fee_minor, 1000);
  assert.equal(row.enabled, 0, "zone disabled");
});

test("zone edit: unknown zone id returns 404", async () => {
  const res = await ownerReq("POST", "/staff/juice/delivery/999999", { name: "Ghost", fee: "10", minOrder: "0", enabled: "on" });
  assert.equal(res.status, 404);
});

test("disabled zones are rejected at checkout and never produce NaN totals", async () => {
  const res = await rawReq("POST", "/juice/checkout", new URLSearchParams({
    items: JSON.stringify([{ productId, qty: 1 }]),
    type: "delivery",
    deliveryZoneId: String(zoneId),
    customerName: "Zone Tester",
    customerPhone: "+254722222222",
    deliveryAddress: "Somewhere",
  }), "");
  assert.equal(res.status, 400);
  assert.ok((await res.text()).includes("not available"), "disabled zone must be refused clearly");
});

test("zone fee flows into checkout totals; invalid zone references are refused", async () => {
  // Re-enable the fixture zone with a known fee.
  run("UPDATE delivery_zones SET enabled=1, fee_minor=5000 WHERE id=?", [String(zoneId)]);

  const valid = await rawReq("POST", "/juice/checkout", new URLSearchParams({
    items: JSON.stringify([{ productId, qty: 1 }]),
    type: "delivery",
    deliveryZoneId: String(zoneId),
    customerName: "Fee Tester",
    customerPhone: "+254733333333",
    deliveryAddress: "Fee Street",
  }), "");
  assert.equal(valid.status, 302);
  const ref = decodeURIComponent(valid.headers.get("location")!.split("/").pop()!);
  const row = queryOne("SELECT * FROM juice_orders WHERE order_ref=?", [ref]) as Record<string, unknown>;
  assert.equal(row.subtotal_minor, fixturePrice());
  assert.equal(row.delivery_fee_minor, ZONE_FEE_MINOR);
  assert.equal(row.total_minor, fixturePrice() + ZONE_FEE_MINOR, "total = subtotal + zone fee, exact minor units");

  const missing = await rawReq("POST", "/juice/checkout", new URLSearchParams({
    items: JSON.stringify([{ productId, qty: 1 }]),
    type: "delivery",
    deliveryZoneId: "999999",
    customerName: "Zone X", customerPhone: "+254744444444", deliveryAddress: "X",
  }), "");
  assert.equal(missing.status, 400);

  const malformed = await rawReq("POST", "/juice/checkout", new URLSearchParams({
    items: JSON.stringify([{ productId, qty: 1 }]),
    type: "delivery",
    deliveryZoneId: "abc",
    customerName: "Zone Y", customerPhone: "+254755555555", deliveryAddress: "Y",
  }), "");
  assert.equal(malformed.status, 400, "malformed zone reference must not be accepted");

  const zones = await ownerReq("GET", "/staff/juice/delivery");
  assert.ok((await zones.text()).includes("Tigoni test zone"), "zones render in the staff UI");
});

// =========================================================================
// 8. Public checkout journey
// =========================================================================

test("checkout: valid pickup order creates an unpaid order and confirmation renders", async () => {
  const res = await rawReq("POST", "/juice/checkout", new URLSearchParams({
    items: JSON.stringify([{ productId, qty: 2 }]),
    type: "pickup",
    customerName: "Checkout Customer",
    customerPhone: "+254766666666",
  }), "");
  assert.equal(res.status, 302);
  const location = res.headers.get("location")!;
  assert.ok(location.startsWith("/juice/order/"), "redirects to the order confirmation");

  const ref = decodeURIComponent(location.split("/").pop()!);
  const row = queryOne("SELECT * FROM juice_orders WHERE order_ref=?", [ref]) as Record<string, unknown>;
  assert.ok(row, "order persists");
  assert.equal(row.status, "new");
  assert.equal(row.payment_status, null, "no order may be marked paid without provider verification");
  assert.equal(row.total_minor, fixturePrice() * 2);
  assert.notEqual(ref, "", "order reference is present");

  const page = await app.request(new URL(location, BASE).toString());
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes(ref), "confirmation page shows the reference");
});

test("checkout: repeated identical submissions create distinct orders with unique references", async () => {
  const submit = () => rawReq("POST", "/juice/checkout", new URLSearchParams({
    items: JSON.stringify([{ productId, qty: 1 }]),
    type: "pickup",
    customerName: "Repeat Customer",
    customerPhone: "+254777777777",
  }), "");
  const a = await submit();
  const b = await submit();
  assert.equal(a.status, 302);
  assert.equal(b.status, 302);
  const refA = decodeURIComponent(a.headers.get("location")!.split("/").pop()!);
  const refB = decodeURIComponent(b.headers.get("location")!.split("/").pop()!);
  assert.notEqual(refA, refB, "each submission gets a unique reference (no idempotency key in v1)");
  const count = (queryOne("SELECT COUNT(*) AS n FROM juice_orders WHERE order_ref IN (?,?)", [refA, refB]) as { n: number }).n;
  assert.equal(count, 2);
});

test("checkout: unavailable products, empty carts and missing details are refused", async () => {
  run("UPDATE products SET available=0 WHERE id=?", [String(productId)]);
  const unavailable = await rawReq("POST", "/juice/checkout", new URLSearchParams({
    items: JSON.stringify([{ productId, qty: 1 }]), type: "pickup",
    customerName: "C", customerPhone: "+254700000099",
  }), "");
  assert.equal(unavailable.status, 400);
  assert.ok((await unavailable.text()).includes("currently unavailable"));
  run("UPDATE products SET available=1 WHERE id=?", [String(productId)]);

  const empty = await rawReq("POST", "/juice/checkout", new URLSearchParams({
    items: "[]", type: "pickup", customerName: "C", customerPhone: "+254700000099",
  }), "");
  assert.equal(empty.status, 400);
  assert.ok((await empty.text()).includes("Cart cannot be empty."));

  const noDetails = await rawReq("POST", "/juice/checkout", new URLSearchParams({
    items: JSON.stringify([{ productId, qty: 1 }]), type: "pickup",
    customerName: "", customerPhone: "",
  }), "");
  assert.equal(noDetails.status, 400);
  assert.ok((await noDetails.text()).includes("Customer name and phone are required."));
});

test("checkout: invalid quantities and negative price extras are rejected", async () => {
  const before = (queryOne("SELECT COUNT(*) AS n FROM juice_orders") as { n: number }).n;
  for (const qty of ["0", "-2", "abc"]) {
    const res = await rawReq("POST", "/juice/checkout", new URLSearchParams({
      items: JSON.stringify([{ productId, qty }]), type: "pickup",
      customerName: "Qty Tester", customerPhone: "+254788888888",
    }), "");
    assert.equal(res.status, 400, `qty=${qty} must be rejected`);
  }

  const negativeExtra = await rawReq("POST", "/juice/checkout", new URLSearchParams({
    items: JSON.stringify([{ productId, qty: 1, sizePriceMinor: -500 }]), type: "pickup",
    customerName: "Qty Tester", customerPhone: "+254788888888",
  }), "");
  assert.equal(negativeExtra.status, 400);
  assert.ok((await negativeExtra.text()).includes("Invalid size price"));

  const after = (queryOne("SELECT COUNT(*) AS n FROM juice_orders") as { n: number }).n;
  assert.equal(after, before, "rejected checkouts must not create orders");
});

test("checkout: unknown products are refused safely without leaking internals", async () => {
  const res = await rawReq("POST", "/juice/checkout", new URLSearchParams({
    items: JSON.stringify([{ productId: 999999, qty: 1 }]), type: "pickup",
    customerName: "Ghost Buyer", customerPhone: "+254799999999",
  }), "");
  assert.equal(res.status, 400);
  const html = await res.text();
  assert.ok(html.includes("Unknown product in cart."));
  assert.ok(!html.includes("SELECT"), "error page must not leak SQL");
  assert.ok(!html.includes("sqlite"), "error page must not leak database internals");
});

test("checkout: cross-origin and origin-less submissions are refused", async () => {
  const before = (queryOne("SELECT COUNT(*) AS n FROM juice_orders") as { n: number }).n;
  const fields = new URLSearchParams({
    items: JSON.stringify([{ productId, qty: 1 }]), type: "pickup",
    customerName: "Cross Origin", customerPhone: "+254700000095",
  });

  const foreign = await rawReq("POST", "/juice/checkout", fields, "", { Origin: "http://evil.example" });
  assert.equal(foreign.status, 403, "a foreign Origin must not be able to place an order");

  const bare = await rawReq("POST", "/juice/checkout", fields, "", { Origin: "" });
  assert.equal(bare.status, 403, "a state-changing POST without Origin/Referer must be refused");

  const after = (queryOne("SELECT COUNT(*) AS n FROM juice_orders") as { n: number }).n;
  assert.equal(after, before, "refused submissions must not create orders");
});

test("checkout: no juice order is ever marked paid without provider verification", async () => {
  const paid = queryAll("SELECT id FROM juice_orders WHERE payment_status IS NOT NULL");
  assert.equal(paid.length, 0, "payment_status must stay NULL until a verified provider callback settles it");
});
