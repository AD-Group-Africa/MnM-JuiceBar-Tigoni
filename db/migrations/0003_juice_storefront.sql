-- 0003_juice_storefront.sql — MnM Juice Bar product catalogue, orders, delivery, reviews.
-- Extends the ticketing schema; both modules coexist. Migrations are additive and run in order.

PRAGMA foreign_keys = ON;

-- Product categories (configured by staff): e.g. Fresh Juices, Smoothies, Snacks.
CREATE TABLE IF NOT EXISTS product_categories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  description   TEXT NOT NULL DEFAULT '',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  image_url     TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Products (drinks/snacks) — staff-managed catalogue.
CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id   INTEGER NOT NULL REFERENCES product_categories(id),
  sku           TEXT NOT NULL UNIQUE,           -- internal code; customer never sees it
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  ingredient_note TEXT,                        -- e.g. allergen info; shown only when set
  price_minor   INTEGER NOT NULL CHECK (price_minor >= 0),  -- KES minor units; single default price
  currency      TEXT NOT NULL DEFAULT 'KES',
  available     INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
  featured      INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0,1)),
  bestseller    INTEGER NOT NULL DEFAULT 0 CHECK (bestseller IN (0,1)),
  sizes         TEXT,                           -- JSON [{label,price_minor}] optional size variants
  addons        TEXT,                           -- JSON [{name,price_minor}] optional add-ons
  prep_notes    TEXT,                           -- kitchen prep notes (staff only)
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Product images — replaceable, with alt text; one can be marked primary.
CREATE TABLE IF NOT EXISTS product_images (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,                  -- local dev path OR future store key
  alt_text    TEXT NOT NULL DEFAULT '',
  "primary"   INTEGER NOT NULL DEFAULT 0 CHECK ("primary" IN (0,1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS product_images_primary_unique ON product_images(product_id) WHERE "primary" = 1;

-- Juice orders — the primary commercial entity for the juice/snack business.
CREATE TABLE IF NOT EXISTS juice_orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_ref       TEXT NOT NULL UNIQUE,          -- human ref, e.g. MNM-J-8K3F92
  customer_name   TEXT NOT NULL,
  customer_phone  TEXT NOT NULL,
  customer_email  TEXT,
  type            TEXT NOT NULL DEFAULT 'pickup' CHECK (type IN ('pickup','delivery')),
  -- Pickup
  pickup_name      TEXT,                         -- site/contact name if different
  pickup_instructions TEXT,
  -- Delivery
  delivery_zone_id INTEGER REFERENCES delivery_zones(id),
  delivery_address  TEXT,
  delivery_contact  TEXT,                        -- may differ from customer_phone
  delivery_instructions TEXT,
  -- Fulfilment
  status          TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','accepted','preparing','ready_for_pickup','ready_for_dispatch','out_for_delivery','delivered','cancelled','failed')),
  assigned_staff_id INTEGER REFERENCES users(id),   -- who's handling it (owner or assistant)
  rider_name        TEXT,                        -- manual delivery person (no GPS tracking in v1)
  rider_phone       TEXT,
  -- Pricing snapshot (server-recomputed; never trust browser totals)
  subtotal_minor  INTEGER NOT NULL,
  delivery_fee_minor INTEGER NOT NULL DEFAULT 0,
  discount_minor  INTEGER NOT NULL DEFAULT 0,
  total_minor     INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'KES',
  -- Payment (reuses provider model via payments table; juice_orders.payment_id links it)
  payment_id      INTEGER REFERENCES payments(id),
  payment_status  TEXT,                          -- mirror of payments.status for convenience
  -- Notes & audit
  customer_notes  TEXT,
  staff_notes     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (total_minor = subtotal_minor + delivery_fee_minor - discount_minor)
);

-- Juice order items — per-product line with snapshot prices (incl. size/add-on variants).
CREATE TABLE IF NOT EXISTS juice_order_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  juice_order_id INTEGER NOT NULL REFERENCES juice_orders(id) ON DELETE CASCADE,
  product_id     INTEGER NOT NULL REFERENCES products(id),
  size_label     TEXT,                            -- chosen size label (null = default)
  size_price_minor INTEGER,                       -- size price snapshot (null = base price)
  addons_chosen  TEXT,                            -- JSON array of chosen add-on names
  addons_price_minor INTEGER,                     -- add-ons total snapshot
  qty            INTEGER NOT NULL CHECK (qty > 0),
  unit_price_minor INTEGER NOT NULL,             -- total unit price (base + size + addons) snapshot
  line_total_minor INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS juice_orders_status ON juice_orders(status);
CREATE INDEX IF NOT EXISTS juice_orders_created ON juice_orders(created_at);
CREATE INDEX IF NOT EXISTS juice_order_items_order ON juice_order_items(juice_order_id);
CREATE INDEX IF NOT EXISTS product_images_product ON product_images(product_id);

-- Delivery zones — configurable service areas and fees.
CREATE TABLE IF NOT EXISTS delivery_zones (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL UNIQUE,      -- e.g. 'Kabuku', 'Limuru Town'
  description         TEXT NOT NULL DEFAULT '',
  fee_minor           INTEGER NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  min_order_minor     INTEGER NOT NULL DEFAULT 0 CHECK (min_order_minor >= 0),
  enabled             INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Business settings — homepage content, opening hours, social links, about.
CREATE TABLE IF NOT EXISTS business_settings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT NOT NULL UNIQUE,             -- e.g. 'opening_hours', 'about_html', 'instagram_url'
  value        TEXT NOT NULL DEFAULT '',
  updated_by   INTEGER REFERENCES users(id),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Customer reviews — moderation required before public display.
CREATE TABLE IF NOT EXISTS reviews (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id      INTEGER REFERENCES products(id) ON DELETE SET NULL,
  juice_order_id  INTEGER REFERENCES juice_orders(id) ON DELETE SET NULL,  -- verified-purchase link
  rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body            TEXT NOT NULL DEFAULT '',
  author_name     TEXT NOT NULL DEFAULT 'Customer',   -- display name (no phone exposed publicly)
  is_verified     INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0,1)),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  rejection_note  TEXT,
  reported_at     TEXT,
  report_reason   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS reviews_product ON reviews(product_id);
CREATE INDEX IF NOT EXISTS reviews_status ON reviews(status);

-- Seed: product categories (development-labelled; owner to confirm the real menu).
-- These are clearly development seed data, not claims about MnM's confirmed current menu.
INSERT OR IGNORE INTO product_categories(id, name, description, sort_order) VALUES
  (1, 'Fresh Juices', 'Cold-pressed and blended fresh juices from seasonal fruit.', 10),
  (2, 'Smoothies', 'Thick, creamy smoothies — choose your favourite fruit blend.', 20),
  (3, 'Fruit Blends', 'Mixed fruit combinations for a balanced, refreshing drink.', 30),
  (4, 'Other Drinks', 'Water, milkshakes, soya, hot drinks and more.', 40),
  (5, 'Snacks & Accompaniments', 'Light snacks and sides to go with your drink.', 50);

-- Seed: a handful of development products with placeholder names/prices.
-- Owner must confirm actual product names, ingredients and prices before these are shown to customers.
INSERT OR IGNORE INTO products(id, category_id, sku, name, description, price_minor, featured, bestseller, sort_order) VALUES
  -- Fresh Juices
  (1, 1, 'FJ-001', 'Fresh Orange Juice', 'Squeezed oranges, served chilled. A simple, classic favourite.', 25000, 1, 0, 1),
  (2, 1, 'FJ-002', 'Fresh Pineapple Juice', 'Sweet pineapple, pressed fresh. Tangy and bright.', 25000, 1, 0, 2),
  (3, 1, 'FJ-003', 'Fresh Sugar Cane Juice', 'Crisp sugar cane pressed fresh — a Kenyan staple.', 20000, 0, 1, 3),
  (4, 1, 'FJ-004', 'Fresh Watermelon Juice', 'Sweet watermelon, blended smooth and served cold.', 20000, 0, 0, 4),
  -- Smoothies
  (5, 2, 'SM-001', 'Mango Smoothie', 'Ripe mango blended thick with a creamy finish.', 35000, 1, 1, 1),
  (6, 2, 'SM-002', 'Banana Smoothie', 'Creamy banana — comforting and filling.', 30000, 0, 0, 2),
  (7, 2, 'SM-003', 'Berry Smoothie', 'Mixed berries for a fruity, antioxidant-rich drink.', 35000, 0, 0, 3),
  -- Fruit Blends
  (8, 3, 'FB-001', 'Tropical Blend', 'Mango, pineapple and a hint of passion fruit.', 30000, 1, 0, 1),
  (9, 3, 'FB-002', 'Citrus Splash', 'Orange, pineapple and a squeeze of lemon.', 28000, 0, 0, 2),
  -- Other Drinks
  (10, 4, 'OD-001', 'Fresh Soya Milk', 'Freshly prepared soya milk — a filling drink option.', 25000, 0, 0, 1),
  (11, 4, 'OD-002', 'Fresh Guava Juice', 'Sweet, pink guava juice — rich and fruity.', 22000, 0, 0, 2),
  -- Snacks
  (12, 5, 'SN-001', 'Mandazi (3 pcs)', 'Fried dough triangles — a classic Kenyan snack.', 15000, 1, 0, 1),
  (13, 5, 'SN-002', 'Fresh Fruit Cup', 'A bowl of seasonal chopped fruit.', 25000, 0, 1, 2),
  (14, 5, 'SN-003', 'Roasted Groundnuts (small)', 'Warm roasted groundnuts — a crunchy side.', 10000, 0, 0, 3);

-- Seed: delivery zones (editable placeholders until owner confirms coverage).
INSERT OR IGNORE INTO delivery_zones(id, name, description, fee_minor, min_order_minor, enabled, sort_order) VALUES
  (1, 'Kabuku', 'Local delivery within Kabuku — quick turnaround.', 5000, 50000, 1, 10),
  (2, 'Limuru Town', 'Delivery to Limuru town centre.', 10000, 80000, 1, 20),
  (3, 'Jumuia / St. Paul''s area', 'Delivery to Jumuia and the St. Paul''s University area.', 10000, 80000, 1, 30);

-- Seed: business settings (development values; owner to update).
INSERT OR IGNORE INTO business_settings(key, value) VALUES
  ('business_name', 'MnM Juice Bar'),
  ('tagline', 'Fresh drinks, crafted with care — Kabuku, Limuru'),
  ('contact_phone', '+254 705 687 273'),
  ('contact_email', 'hello@mnmjuicebar.co.ke'),
  ('address_line', 'Kabuku, opposite St. Paul''s University, near Jumuia, Limuru, Kenya'),
  ('about_html', '<p>MnM Juice Bar is a local refreshment spot in Kabuku, Limuru, serving fresh juices, smoothies, fruit blends and light snacks.</p><p>We are known for handmade drinks made from fresh fruit and a friendly, neighbourhood feel.</p><p>Our location makes us a convenient stop for students, staff and visitors near St. Paul''s University and Jumuia.</p>'),
  ('instagram_url', 'https://www.instagram.com/mnm_juicebar/'),
  ('facebook_url', 'https://www.facebook.com/p/MnM-smoothie-and-Juicebar-61575533087170/'),
  ('opening_hours', 'Mon–Fri: 8:00 AM – 6:00 PM<br/>Saturday: 9:00 AM – 5:00 PM<br/>Sunday: 10:00 AM – 4:00 PM'),
  ('footer_policy_note', 'Prices are listed in Kenyan Shillings (KES). Menu items, prices and availability are confirmed by MnM Juice Bar staff and may change without notice. This website displays development seed data until the owner confirms the current menu.'),
  ('hero_headline', 'Refreshing drinks, made fresh daily.'),
  ('hero_subhead', 'Juices, smoothies, fruit blends and snacks from MnM Juice Bar, Kabuku, Limuru.'),
  ('hero_cta', 'Order Now');
