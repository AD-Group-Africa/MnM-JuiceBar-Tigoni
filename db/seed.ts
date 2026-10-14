/**
 * Development-only seed. Creates pricing terms, staff accounts and two clearly
 * labelled fictional sample events. REFUSES to run when NODE_ENV=production —
 * seed credentials must never silently exist in a live system.
 *
 * Run: npm run seed
 */
import { randomBytes } from "node:crypto";

// Guard BEFORE any further bootstrapping.
if (process.env.NODE_ENV === "production") {
  console.error("[seed] Refusing to run: NODE_ENV=production. Seed data is development-only.");
  process.exit(1);
}
console.warn("[seed] Seeding DEVELOPMENT data. Do not use these credentials in production.");

import { hashPassword } from "../src/auth.ts";
import { migrate, run, queryOne, getDb } from "../src/db.ts";
import { LAUNCH_TERMS } from "../src/money.ts";

migrate(process.env.DATABASE_FILE);

// --- pricing terms (active) ---
if (!queryOne("SELECT id FROM pricing_terms WHERE active=1")) {
  run(
    `INSERT INTO pricing_terms(label,markup_points,mnm_points,ad_points,currency,active)
     VALUES (?,?,?,?,?,1)`,
    ["Launch terms 2026 (proposed; owner confirmation pending)", LAUNCH_TERMS.markupPoints, LAUNCH_TERMS.mnmPoints, LAUNCH_TERMS.adPoints, LAUCH_CURRENCY()],
  );
  console.log("[seed] pricing terms inserted (35/25/10, KES)");
}
function LAUCH_CURRENCY(): string { return LAUNCH_TERMS.currency; }

// --- staff accounts ---
async function ensureUser(fullName: string, phone: string, role: string, password: string): Promise<number> {
  const existing = queryOne("SELECT id FROM users WHERE phone=?", [phone]);
  if (existing) return Number(existing.id);
  const hash = await hashPassword(password);
  const r = run("INSERT INTO users(full_name,phone,role,password_hash) VALUES (?,?,?,?)", [fullName, phone, role, hash]);
  return r.lastInsertRowid;
}

function days(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString();
}

async function main(): Promise<void> {
  const owner = await ensureUser("MnM Owner", "+254705687273", "owner", "dev-owner-password");
  const manager = await ensureUser("Sales Manager (dev)", "+254700000002", "manager", "dev-manager-password");
  const staff = await ensureUser("Sales Staff (dev)", "+254700000003", "sales_staff", "dev-staff-password");
  const scanner = await ensureUser("Gate Scanner (dev)", "+254700000004", "scanner", "dev-scanner-password");
  const admin = await ensureUser("AD Platform Admin (dev)", "+254700000005", "ad_admin", "dev-admin-password");
  console.log(`[seed] users: owner=${owner} manager=${manager} sales_staff=${staff} scanner=${scanner} ad_admin=${admin}`);

  eventIfMissing(
    "sample-pool-party",
    "SAMPLE EVENT — Limuru Pool Party (dev seed)",
    "This is a FICTIONAL demonstration event created by the development seed. Venue, organisers and tickets are placeholders to exercise the product.",
    "The Stables, Magnate City (sample venue)",
    "Limuru, Kiambu",
    days(14),
    [
      ["Regular", 100_000, 120],        // KSh 1,000 → sells at KSh 1,350
      ["VIP", 250_000, 30],             // KSh 2,500 → sells at KSh 3,375
    ],
    owner,
  );

  eventIfMissing(
    "sample-worship-night",
    "SAMPLE EVENT — Worship Night Limuru (dev seed)",
    "FICTIONAL demonstration event from the development seed — exercises a draft-state event with a second category set.",
    "St. Paul's University Auditorium (sample venue)",
    "Limuru, Kiambu",
    days(30),
    [["Standard", 50_000, 200]], // KSh 500 → KSh 675
    owner,
  ).draft = true;

  console.log("[seed] done.");
}

function eventIfMissing(slug: string, title: string, description: string, venue: string, area: string, starts: string, cats: [string, number, number][], createdBy: number) {
  if (queryOne("SELECT id FROM events WHERE slug=?", [slug])) return { draft: false as boolean };
  const ev = run(
    `INSERT INTO events(slug,title,description,venue_name,venue_area,starts_at,organizer_name,organizer_contact,sale_starts_at,sale_ends_at,status,created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [slug, title, description, venue, area, starts, "SAMPLE ORGANISER (dev seed)", "+254700000000", new Date().toISOString(), new Date(Date.now() + 7 * 86_400_000).toISOString(), "on_sale", createdBy],
  );
  for (const [name, price, qty] of cats) {
    run("INSERT INTO ticket_categories(event_id,name,original_price,quantity) VALUES (?,?,?,?)", [ev.lastInsertRowid, name, price, qty]);
  }
  return { draft: false as boolean };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
