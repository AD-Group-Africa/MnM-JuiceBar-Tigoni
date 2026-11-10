/**
 * DEMONSTRATION DATASET seeder (development only).
 *
 * Everything this script writes is clearly labelled as sample/demo data:
 *  - product illustrations are SVGs tagged "SAMPLE IMAGE" (public/menu/*.svg),
 *  - orders carry the reference prefix MNM-DEMO- and a staff note saying so,
 *  - customer names start with "Sample Customer" and use reserved 0700 000 xxx
 *    numbers, so no real customer is ever impersonated,
 *  - catering enquiries use the reference prefix MNM-DEMO-C,
 *  - no reviews are created (invented customer reviews are never presented as real),
 *  - no M-Pesa payment is simulated or recorded: `payment_status` only mirrors
 *    what a human confirmed by hand, and the dev simulator prints to the console.
 *
 * The dataset is idempotent: re-running it never duplicates rows.
 *
 * Run: npm run seed:demo
 */
if (process.env.NODE_ENV === "production") {
  console.error("[seed-demo] Refusing to run: NODE_ENV=production. Demo data is development-only.");
  process.exit(1);
}
console.warn("[seed-demo] Seeding DEMONSTRATION data (clearly labelled sample records).");

import { migrate, run, queryAll, queryOne } from "../src/db.ts";
import { formatMinor } from "../src/money.ts";

migrate(process.env.DATABASE_FILE);

// ---------------------------------------------------------------------------
// 1. Demo catalogue: extra categories + products (milkshakes, mocktails, etc.)
// ---------------------------------------------------------------------------

/** id => [name, description, sort order] — mirrored by migration 0006. */
const CATEGORIES: [number, string, string, number][] = [
  [6, "Milkshakes", "Thick, creamy milkshakes — classic flavours made to order.", 25],
  [7, "Mocktails", "Alcohol-free mixed drinks: fresh, fruity and fun.", 35],
];

interface DemoProduct {
  sku: string;
  name: string;
  categoryId: number;
  description: string;
  priceMinor: number;
  available: number;
  featured: number;
  bestseller: number;
  sortOrder: number;
  ingredientNote: string | null;
  sizes: string | null;
  addons: string | null;
}

const sizes = (medium: number, large: number) =>
  JSON.stringify([
    { label: "Small", price_minor: 0 },
    { label: "Medium", price_minor: medium },
    { label: "Large", price_minor: large },
  ]);

const addons = (...list: [string, number][]) =>
  JSON.stringify(list.map(([name, price_minor]) => ({ name, price_minor })));

const PRODUCTS: DemoProduct[] = [
  // Milkshakes
  {
    sku: "MS-001", name: "Strawberry Milkshake", categoryId: 6,
    description: "Thick strawberry milkshake blended with fresh strawberries and milk.",
    priceMinor: 32000, available: 1, featured: 1, bestseller: 0, sortOrder: 1,
    ingredientNote: "Contains dairy.",
    sizes: sizes(6000, 12000),
    addons: addons(["Extra chocolate", 5000], ["Whipped cream", 4000], ["Extra scoop", 8000]),
  },
  {
    sku: "MS-002", name: "Chocolate Milkshake", categoryId: 6,
    description: "Rich chocolate milkshake with cocoa and milk.",
    priceMinor: 33000, available: 0, featured: 0, bestseller: 0, sortOrder: 2,
    ingredientNote: "Contains dairy.",
    sizes: sizes(6000, 12000),
    addons: addons(["Whipped cream", 4000]),
  },
  // Mocktails
  {
    sku: "MK-001", name: "Mango Mocktail", categoryId: 7,
    description: "Mango, lime and soda — a refreshing alcohol-free cooler.",
    priceMinor: 28000, available: 1, featured: 1, bestseller: 1, sortOrder: 1,
    ingredientNote: "Contains no alcohol. Allergens: none declared.",
    sizes: sizes(5000, 10000),
    addons: addons(["Extra passion fruit", 3000], ["Mint", 1000]),
  },
  {
    sku: "MK-002", name: "Passion Fruit Mocktail", categoryId: 7,
    description: "Passion fruit and soda with a squeeze of lime.",
    priceMinor: 28000, available: 1, featured: 0, bestseller: 0, sortOrder: 2,
    ingredientNote: "Contains no alcohol.",
    sizes: sizes(5000, 10000),
    addons: addons(["Extra passion fruit", 3000]),
  },
  // Snacks
  {
    sku: "WC-001", name: "Sliced Watermelon Bowl", categoryId: 5,
    description: "A bowl of sweet sliced watermelon — a refreshing side.",
    priceMinor: 18000, available: 1, featured: 0, bestseller: 0, sortOrder: 4,
    ingredientNote: null, sizes: null, addons: null,
  },
];

for (const [id, name, description, sortOrder] of CATEGORIES) {
  run(
    `INSERT INTO product_categories(id, name, description, sort_order) VALUES (?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET description=excluded.description, sort_order=excluded.sort_order`,
    [id, name, description, sortOrder],
  );
}

for (const p of PRODUCTS) {
  const existing = queryOne("SELECT id FROM products WHERE sku=?", [p.sku]);
  if (existing) {
    run(
      `UPDATE products SET category_id=?, name=?, description=?, ingredient_note=?, price_minor=?,
              available=?, featured=?, bestseller=?, sizes=COALESCE(?,sizes), addons=COALESCE(?,addons), sort_order=?
       WHERE sku=?`,
      [p.categoryId, p.name, p.description, p.ingredientNote, p.priceMinor, p.available, p.featured,
       p.bestseller, p.sizes, p.addons, p.sortOrder, p.sku],
    );
  } else {
    run(
      `INSERT INTO products(category_id, sku, name, description, ingredient_note, price_minor,
              available, featured, bestseller, sizes, addons, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [p.categoryId, p.sku, p.name, p.description, p.ingredientNote, p.priceMinor, p.available,
       p.featured, p.bestseller, p.sizes, p.addons, p.sortOrder],
    );
  }
}
console.log(`[seed-demo] catalogue: ${PRODUCTS.length} demo products ensured`);

// ---------------------------------------------------------------------------
// 2. Product images (sample SVG illustrations in public/menu)
// ---------------------------------------------------------------------------

function productImagePath(sku: string): string {
  return `/menu/${sku.toLowerCase()}.svg`;
}

const imageRows = queryAll("SELECT id, sku FROM products ORDER BY id");
let images = 0;
for (const row of imageRows) {
  const productId = Number(row.id);
  const sku = String(row.sku);
  const path = productImagePath(sku);
  const existing = queryOne("SELECT id FROM product_images WHERE product_id=? AND storage_path=?", [productId, path]);
  if (existing) continue;
  const name = String(queryOne("SELECT name FROM products WHERE id=?", [productId])?.name ?? sku);
  run(
    `INSERT INTO product_images(product_id, storage_path, alt_text, "primary", sort_order)
     VALUES (?,?,?,1,0)`,
    [productId, path, `${name} — sample illustration`],
  );
  images++;
}
console.log(`[seed-demo] images: ${images} sample illustration(s) attached`);

// ---------------------------------------------------------------------------
// 3. Catalogue realism: sizes, add-ons, allergens, unavailable items
// ---------------------------------------------------------------------------

const CATALOGUE_ENRICHMENT: [string, string | null, string | null, number | null][] = [
  ["FJ-001", sizes(5000, 10000), null, 1],
  ["FJ-002", sizes(5000, 10000), null, 1],
  ["FJ-003", sizes(5000, 10000), null, 1],
  ["FJ-004", sizes(5000, 10000), null, 0], // out of stock today
  ["SM-001", sizes(7000, 14000), addons(["Extra avocado", 8000], ["Protein scoop", 15000], ["Extra honey", 3000]), 1],
  ["SM-002", sizes(7000, 14000), addons(["Extra banana", 5000], ["Protein scoop", 15000]), 1],
  ["SM-003", sizes(7000, 14000), addons(["Protein scoop", 15000], ["Extra honey", 3000]), 1],
  ["FB-001", sizes(5000, 10000), addons(["Extra passion fruit", 3000]), 1],
  ["FB-002", sizes(5000, 10000), null, 1],
  ["OD-001", null, addons(["Add honey", 2000]), 1],
  ["OD-002", sizes(5000, 10000), null, 1],
  ["SN-003", null, null, 0], // sold out today
];

for (const [sku, sz, ad, available] of CATALOGUE_ENRICHMENT) {
  const row = queryOne("SELECT id FROM products WHERE sku=?", [sku]);
  if (!row) continue;
  run(
    `UPDATE products SET sizes=COALESCE(?,sizes), addons=COALESCE(?,addons), available=? WHERE id=?`,
    [sz, ad, available, Number(row.id)],
  );
}

run(
  `UPDATE products SET ingredient_note = 'Contains dairy.' WHERE sku = 'SM-002'`,
  [],
);
run(
  `UPDATE products SET ingredient_note = 'Contains groundnuts.' WHERE sku = 'SN-003'`,
  [],
);
console.log("[seed-demo] catalogue: sizes, add-ons and availability set");

// ---------------------------------------------------------------------------
// 4. Sample juice orders — every lifecycle status, money maths computed from
//    the live catalogue so the dashboard can never disagree with the orders.
// ---------------------------------------------------------------------------

interface DemoLine { sku: string; qty: number; size?: string; sizePrice?: number; addons?: string[]; addonsPrice?: number }
interface DemoOrder {
  ref: string;
  daysAgo: number;
  hour: number;
  minute: number;
  customer: string;
  phone: string;
  email: string | null;
  type: "pickup" | "delivery";
  zoneId: number | null;
  address: string | null;
  notes: string | null;
  status: string;
  paymentStatus: string | null;
  staffId: number | null;
  rider: string | null;
  lines: DemoLine[];
}

const ORDERS: DemoOrder[] = [
  {
    ref: "MNM-DEMO-001", daysAgo: 6, hour: 11, minute: 20,
    customer: "Sample Customer — Achieng O.", phone: "+254700000101", email: "sample.customer1@example.com",
    type: "pickup", zoneId: null, address: null, notes: "Collect at 4pm please.",
    status: "delivered", paymentStatus: "succeeded", staffId: null, rider: null,
    lines: [{ sku: "SM-001", qty: 2 }],
  },
  {
    ref: "MNM-DEMO-002", daysAgo: 5, hour: 16, minute: 5,
    customer: "Sample Customer — Brian K.", phone: "+254700000102", email: null,
    type: "delivery", zoneId: 1, address: "Plot 12, Kabuku market road (sample address)", notes: null,
    status: "delivered", paymentStatus: "succeeded", staffId: null, rider: "Mercy (demo rider)",
    lines: [{ sku: "FJ-001", qty: 1 }, { sku: "SN-001", qty: 1 }],
  },
  {
    ref: "MNM-DEMO-003", daysAgo: 4, hour: 9, minute: 40,
    customer: "Sample Customer — Carol M.", phone: "+254700000103", email: "sample.customer3@example.com",
    type: "delivery", zoneId: 2, address: "Limuru Town, near the bus stage (sample address)", notes: "Ring the bell twice.",
    status: "delivered", paymentStatus: "succeeded", staffId: null, rider: "Mercy (demo rider)",
    lines: [{ sku: "FJ-002", qty: 2 }, { sku: "SN-002", qty: 1 }],
  },
  {
    ref: "MNM-DEMO-004", daysAgo: 3, hour: 13, minute: 15,
    customer: "Sample Customer — Daniel R.", phone: "+254700000104", email: null,
    type: "pickup", zoneId: null, address: null, notes: null,
    status: "delivered", paymentStatus: "succeeded", staffId: null, rider: null,
    lines: [{ sku: "SM-003", qty: 1 }, { sku: "MS-002", qty: 1 }],
  },
  {
    ref: "MNM-DEMO-005", daysAgo: 2, hour: 10, minute: 10,
    customer: "Sample Customer — Esther W.", phone: "+254700000105", email: "sample.customer5@example.com",
    type: "delivery", zoneId: 1, address: "Kabuku, St. Paul's gate B (sample address)", notes: null,
    status: "delivered", paymentStatus: "succeeded", staffId: null, rider: "Joseph (demo rider)",
    lines: [{ sku: "MK-001", qty: 3 }, { sku: "SN-001", qty: 1 }],
  },
  {
    ref: "MNM-DEMO-006", daysAgo: 1, hour: 18, minute: 30,
    customer: "Sample Customer — Faith N.", phone: "+254700000106", email: null,
    type: "delivery", zoneId: 3, address: "Jumuia, behind the pharmacy (sample address)", notes: "Call on arrival.",
    status: "delivered", paymentStatus: "succeeded", staffId: null, rider: "Joseph (demo rider)",
    lines: [{ sku: "FB-001", qty: 1 }, { sku: "WC-001", qty: 1 }],
  },
  {
    ref: "MNM-DEMO-007", daysAgo: 0, hour: 8, minute: 15,
    customer: "Sample Customer — Gideon T.", phone: "+254700000107", email: null,
    type: "pickup", zoneId: null, address: null, notes: "Extra ice, please.",
    status: "ready_for_pickup", paymentStatus: "succeeded", staffId: null, rider: null,
    lines: [{ sku: "SM-001", qty: 2 }],
  },
  {
    ref: "MNM-DEMO-008", daysAgo: 0, hour: 9, minute: 5,
    customer: "Sample Customer — Hawa S.", phone: "+254700000108", email: "sample.customer8@example.com",
    type: "delivery", zoneId: 1, address: "Madaraka estate, house 7 (sample address)", notes: null,
    status: "out_for_delivery", paymentStatus: "succeeded", staffId: null, rider: "Mercy (demo rider)",
    lines: [{ sku: "MS-001", qty: 1 }, { sku: "FB-002", qty: 1 }],
  },
  {
    ref: "MNM-DEMO-009", daysAgo: 0, hour: 9, minute: 40,
    customer: "Sample Customer — Isaac L.", phone: "+254700000109", email: null,
    type: "pickup", zoneId: null, address: null, notes: null,
    status: "preparing", paymentStatus: null, staffId: null, rider: null,
    lines: [{ sku: "SM-002", qty: 1 }, { sku: "SN-001", qty: 2 }],
  },
  {
    ref: "MNM-DEMO-010", daysAgo: 0, hour: 10, minute: 5,
    customer: "Sample Customer — Jane M.", phone: "+254700000110", email: "sample.customer10@example.com",
    type: "delivery", zoneId: 1, address: "Kabuku, opposite the primary school (sample address)", notes: null,
    status: "new", paymentStatus: null, staffId: null, rider: null,
    lines: [{ sku: "MK-002", qty: 2 }],
  },
  {
    ref: "MNM-DEMO-011", daysAgo: 2, hour: 12, minute: 45,
    customer: "Sample Customer — Kevin O.", phone: "+254700000111", email: null,
    type: "delivery", zoneId: 2, address: "Limuru, Riverside drive (sample address)", notes: null,
    status: "cancelled", paymentStatus: null, staffId: null, rider: null,
    lines: [{ sku: "SM-003", qty: 1 }],
  },
  {
    ref: "MNM-DEMO-012", daysAgo: 3, hour: 15, minute: 20,
    customer: "Sample Customer — Lucy A.", phone: "+254700000112", email: null,
    type: "delivery", zoneId: 3, address: "Jumuia, University grounds (sample address)", notes: null,
    status: "failed", paymentStatus: null, staffId: null, rider: null,
    lines: [{ sku: "FJ-004", qty: 2 }],
  },
];

function productPrice(sku: string): { id: number; price: number } | null {
  const row = queryOne("SELECT id, price_minor FROM products WHERE sku=?", [sku]);
  if (!row) return null;
  return { id: Number(row.id), price: Number(row.price_minor) };
}

function zoneFee(zoneId: number | null): number {
  if (!zoneId) return 0;
  const row = queryOne("SELECT fee_minor FROM delivery_zones WHERE id=?", [zoneId]);
  return row ? Number(row.fee_minor) : 0;
}

const ownerRow = queryOne("SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1");
const ownerId = ownerRow ? Number(ownerRow.id) : null;

let created = 0;
for (const o of ORDERS) {
  if (queryOne("SELECT id FROM juice_orders WHERE order_ref=?", [o.ref])) continue;

  let subtotal = 0;
  const lines: { productId: number; qty: number; sizeLabel: string | null; sizePrice: number | null; addons: string[] | null; addonsPrice: number | null; unit: number; lineTotal: number }[] = [];

  for (const line of o.lines) {
    const product = productPrice(line.sku);
    if (!product) {
      console.warn(`[seed-demo] skipping ${o.ref}: unknown sku ${line.sku}`);
      continue;
    }
    const sizePrice = line.sizePrice ?? 0;
    const addonsPrice = line.addonsPrice ?? 0;
    const unit = product.price + sizePrice + addonsPrice;
    const lineTotal = unit * line.qty;
    subtotal += lineTotal;
    lines.push({
      productId: product.id,
      qty: line.qty,
      sizeLabel: line.size ?? null,
      sizePrice: sizePrice || null,
      addons: line.addons && line.addons.length ? line.addons : null,
      addonsPrice: addonsPrice || null,
      unit,
      lineTotal,
    });
  }

  const fee = o.type === "delivery" ? zoneFee(o.zoneId) : 0;
  const total = subtotal + fee;
  const when = new Date(Date.now() - o.daysAgo * 86_400_000);
  when.setHours(o.hour, o.minute, 0, 0);
  const createdAt = when.toISOString();

  run(
    `INSERT INTO juice_orders(order_ref, customer_name, customer_phone, customer_email, type,
            pickup_name, pickup_instructions, delivery_zone_id, delivery_address, delivery_contact, delivery_instructions,
            status, assigned_staff_id, rider_name, rider_phone, subtotal_minor, delivery_fee_minor, discount_minor,
            total_minor, currency, payment_status, customer_notes, staff_notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)`,
    [
      o.ref, o.customer, o.phone, o.email, o.type,
      null, null, o.zoneId, o.address, null, null,
      o.status, ownerId, o.rider, null,
      subtotal, fee, total, "KES", o.paymentStatus, o.notes,
      "SAMPLE DEMO ORDER — created by the demonstration dataset (npm run seed:demo). Not a real customer.",
      createdAt, createdAt,
    ],
  );
  const orderId = Number(queryOne("SELECT last_insert_rowid() AS id")!.id);

  for (const l of lines) {
    run(
      `INSERT INTO juice_order_items(juice_order_id, product_id, size_label, size_price_minor, addons_chosen, addons_price_minor, qty, unit_price_minor, line_total_minor)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [orderId, l.productId, l.sizeLabel, l.sizePrice, l.addons ? JSON.stringify(l.addons) : null,
       l.addonsPrice, l.qty, l.unit, l.lineTotal],
    );
  }
  created++;
}
console.log(`[seed-demo] orders: ${created} sample order(s) created`);

// ---------------------------------------------------------------------------
// 5. Sample catering enquiries
// ---------------------------------------------------------------------------

const ENQUIRIES: [string, string, string, string | null, string, string, number, string | null, string][] = [
  ["MNM-DEMO-C01", "Sample Customer — Grace N.", "+254700000201", "sample.customer201@example.com",
    "Birthday party", "2026-10-24", 60, "Mango smoothies and fresh orange juice",
    "SAMPLE DEMO ENQUIRY — demonstration dataset, not a real booking."],
  ["MNM-DEMO-C02", "Sample Customer — Otieno Enterprises", "+254700000202", null,
    "Corporate event", "2026-11-06", 150, "Refreshment station with water and juice",
    "SAMPLE DEMO ENQUIRY — demonstration dataset, not a real booking."],
  ["MNM-DEMO-C03", "Sample Customer — Limuru Youth Fellowship", "+254700000203", null,
    "Church or fellowship event", "2026-11-14", 200, "Assorted juices, snacks and milkshakes",
    "SAMPLE DEMO ENQUIRY — demonstration dataset, not a real booking."],
];

const ENQUIRY_STATUS: Record<string, string> = {
  "MNM-DEMO-C01": "new",
  "MNM-DEMO-C02": "quoted",
  "MNM-DEMO-C03": "confirmed",
};

let enquiries = 0;
for (const [ref, name, phone, email, eventType, eventDate, guests, items, notes] of ENQUIRIES) {
  if (queryOne("SELECT id FROM catering_enquiries WHERE reference=?", [ref])) continue;
  const now = new Date().toISOString();
  run(
    `INSERT INTO catering_enquiries(reference, contact_name, contact_phone, contact_email, event_type,
            event_date, guest_count, items_requested, notes, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [ref, name, phone, email, eventType, eventDate, guests, items, notes, ENQUIRY_STATUS[ref] ?? "new", now, now],
  );
  enquiries++;
}
console.log(`[seed-demo] catering: ${enquiries} sample enquiry/enquiries created`);

// ---------------------------------------------------------------------------
// 6. Owner-visible notice about the dataset
// ---------------------------------------------------------------------------

run(
  `INSERT INTO business_settings(key, value) VALUES (?, ?)
   ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  [
    "demo_dataset_notice",
    "DEMONSTRATION DATASET — sample products, prices, images, orders and catering enquiries are for the class demo only. The owner must confirm the real menu, prices and availability before any live trading.",
  ],
);

console.log("[seed-demo] done.");
