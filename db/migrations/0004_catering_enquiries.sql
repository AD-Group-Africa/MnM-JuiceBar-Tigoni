-- Catering enquiries: event / bulk-drink requests captured from the storefront.
-- Non-destructive: creates a new table only, no data is modified or dropped.
CREATE TABLE IF NOT EXISTS catering_enquiries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  reference         TEXT    NOT NULL UNIQUE,
  contact_name      TEXT    NOT NULL,
  contact_phone     TEXT    NOT NULL,
  contact_email     TEXT,
  event_type        TEXT    NOT NULL,
  event_date        TEXT,
  guest_count       INTEGER NOT NULL DEFAULT 0,
  items_requested   TEXT,
  notes             TEXT,
  status            TEXT    NOT NULL DEFAULT 'new',
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catering_status  ON catering_enquiries(status);
CREATE INDEX IF NOT EXISTS idx_catering_created ON catering_enquiries(created_at DESC);
