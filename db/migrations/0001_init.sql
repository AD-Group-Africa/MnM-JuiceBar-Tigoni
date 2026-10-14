-- 0001_init.sql — MnM Tickets initial schema.
-- Written in SQLite dialect for local development (node:sqlite). Kept deliberately
-- plain/portable; docs/ARCHITECTURE.md notes the small dialect deltas for the
-- production PostgreSQL migration.

PRAGMA foreign_keys = ON;

-- Platform commercial terms configuration (audit-logged, versioned).
-- Applies to NEW orders at transaction time; never alters existing paid orders.
CREATE TABLE IF NOT EXISTS pricing_terms (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  label         TEXT NOT NULL,
  markup_points INTEGER NOT NULL CHECK (markup_points BETWEEN 0 AND 10000),
  mnm_points    INTEGER NOT NULL CHECK (mnm_points    BETWEEN 0 AND 10000),
  ad_points     INTEGER NOT NULL CHECK (ad_points     BETWEEN 0 AND 10000),
  currency      TEXT NOT NULL DEFAULT 'KES',
  active        INTEGER NOT NULL DEFAULT 1,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (mnm_points + ad_points = markup_points)
);
-- Exactly one active terms row at a time.
CREATE UNIQUE INDEX IF NOT EXISTS pricing_terms_single_active
  ON pricing_terms(active) WHERE active = 1;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT NOT NULL,
  phone         TEXT NOT NULL UNIQUE,
  email         TEXT,
  role          TEXT NOT NULL CHECK (role IN ('owner','manager','sales_staff','scanner','ad_admin')),
  password_hash TEXT NOT NULL,                 -- scrypt: N$salt$hash
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash  TEXT NOT NULL UNIQUE,            -- SHA-256 of the cookie token
  user_id     INTEGER NOT NULL REFERENCES users(id),
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_ip  TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  slug             TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  venue_name       TEXT NOT NULL,
  venue_area       TEXT NOT NULL DEFAULT '',   -- area/town, e.g. 'Limuru, Kiambu'
  starts_at        TEXT NOT NULL,              -- ISO 8601
  ends_at          TEXT,
  image_url        TEXT,
  organizer_name   TEXT NOT NULL,
  organizer_contact TEXT NOT NULL,
  -- Authorisation record for authorised resale (required before publish):
  authorization_ref   TEXT NOT NULL DEFAULT '',
  authorization_note  TEXT NOT NULL DEFAULT '',
  authorized_by_user  INTEGER REFERENCES users(id),
  authorized_at       TEXT,
  sale_starts_at   TEXT,
  sale_ends_at     TEXT,
  max_per_order    INTEGER NOT NULL DEFAULT 10,
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','on_sale','paused','completed','cancelled')),
  created_by       INTEGER REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS ticket_categories (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id        INTEGER NOT NULL REFERENCES events(id),
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  original_price  INTEGER NOT NULL CHECK (original_price >= 0),  -- minor units
  quantity        INTEGER NOT NULL CHECK (quantity >= 0),
  sold_count      INTEGER NOT NULL DEFAULT 0,   -- issued & paid tickets
  max_per_order   INTEGER,                      -- overrides event default if set
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (sold_count <= quantity)
);

-- Short-lived inventory reservations created at checkout, converted on payment.
CREATE TABLE IF NOT EXISTS reservations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id  INTEGER NOT NULL REFERENCES ticket_categories(id),
  order_id     INTEGER NOT NULL REFERENCES orders(id),
  qty          INTEGER NOT NULL CHECK (qty > 0),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','converted','released')),
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_ref     TEXT NOT NULL UNIQUE,           -- human-ref, e.g. MNM-8K3F92
  event_id      INTEGER NOT NULL REFERENCES events(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,                 -- E.164-ish, delivery contact
  customer_email TEXT,
  -- PRICING SNAPSHOT at transaction time (never recomputed, never changed retroactively):
  pricing_terms_id INTEGER REFERENCES pricing_terms(id),
  original_minor  INTEGER NOT NULL,
  mnm_minor       INTEGER NOT NULL,
  ad_minor        INTEGER NOT NULL,
  total_minor     INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'KES',
  lifecycle       TEXT NOT NULL DEFAULT 'draft'
    CHECK (lifecycle IN ('draft','pending_payment','payment_failed','expired','cancelled','paid','ticket_issued','refund_pending','refunded','reconcile_exception')),
  access_token_hash TEXT NOT NULL,              -- guest "my tickets" link (token hash only)
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        INTEGER NOT NULL REFERENCES orders(id),
  category_id     INTEGER NOT NULL REFERENCES ticket_categories(id),
  qty             INTEGER NOT NULL CHECK (qty > 0),
  unit_original   INTEGER NOT NULL,             -- snapshot per unit
  unit_mnm        INTEGER NOT NULL,
  unit_ad         INTEGER NOT NULL,
  unit_selling    INTEGER NOT NULL
);

-- Payment attempts + provider notifications (append-only financial audit trail).
CREATE TABLE IF NOT EXISTS payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        INTEGER NOT NULL REFERENCES orders(id),
  provider        TEXT NOT NULL,                -- 'dev' | 'daraja'
  provider_request_id TEXT UNIQUE,              -- e.g. Mpesa CheckoutRequestID — idempotency key
  provider_ref    TEXT,                         -- receipt no (MpesaReceiptNumber) once confirmed
  amount_minor    INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'KES',
  status          TEXT NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated','pending','succeeded','failed','duplicate','expired')),
  msisdn          TEXT,                         -- paying phone
  raw_payload     TEXT,                         -- last callback JSON (safe fields only)
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- issued_tickets unique index in 0002; tickets issued ONLY after confirmed payment.
CREATE TABLE IF NOT EXISTS tickets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_code  TEXT NOT NULL,                   -- random, shown to customer; verified server-side
  order_id     INTEGER NOT NULL REFERENCES orders(id),
  order_item_id INTEGER NOT NULL REFERENCES order_items(id),
  event_id     INTEGER NOT NULL REFERENCES events(id),
  status       TEXT NOT NULL DEFAULT 'valid'
    CHECK (status IN ('valid','redeemed','refunded','cancelled','void')),
  issued_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  redeemed_at  TEXT,
  redeemed_by  INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS scan_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id),
  ticket_code TEXT NOT NULL,                    -- what was scanned (may be invalid/unknown)
  scanner_id  INTEGER NOT NULL REFERENCES users(id),
  result      TEXT NOT NULL CHECK (result IN ('accepted','rejected')),
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel     TEXT NOT NULL CHECK (channel IN ('email','sms')),
  recipient   TEXT NOT NULL,
  template    TEXT NOT NULL,
  payload     TEXT NOT NULL,                    -- JSON
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent(with dev adapter)','failed')),
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user   INTEGER REFERENCES users(id),
  action       TEXT NOT NULL,                   -- e.g. 'event.publish', 'pricing_terms.update'
  entity       TEXT NOT NULL,
  entity_id    TEXT,
  detail       TEXT,                            -- JSON
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_categories_event ON ticket_categories(event_id);
CREATE INDEX IF NOT EXISTS idx_orders_event ON orders(event_id);
CREATE INDEX IF NOT EXISTS idx_orders_lifecycle ON orders(lifecycle);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_order ON tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_event ON tickets(event_id);
CREATE INDEX IF NOT EXISTS idx_scan_log_ticket ON scan_log(ticket_id);
CREATE INDEX IF NOT EXISTS idx_reservations_category ON reservations(category_id, status);

-- Reconciliation exceptions surfaced to staff (manual review queue).
CREATE TABLE IF NOT EXISTS reconcile_exceptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id),
  payment_id  INTEGER REFERENCES payments(id),
  reason      TEXT NOT NULL,
  resolved    INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
