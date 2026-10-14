-- 0002_scan_log_unknown.sql — allow scan_log rows for unknown/invalid ticket codes
-- (ticket_id NULL when the scanned code does not exist; code text is always kept).

-- SQLite cannot ALTER a column's nullability; rebuild the table.
CREATE TABLE scan_log_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER REFERENCES tickets(id),
  ticket_code TEXT NOT NULL,
  scanner_id  INTEGER NOT NULL REFERENCES users(id),
  result      TEXT NOT NULL CHECK (result IN ('accepted','rejected')),
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO scan_log_new(id, ticket_id, ticket_code, scanner_id, result, reason, created_at)
  SELECT id, ticket_id, ticket_code, scanner_id, result, reason, created_at FROM scan_log;

DROP TABLE scan_log;
ALTER TABLE scan_log_new RENAME TO scan_log;

CREATE INDEX IF NOT EXISTS idx_scan_log_ticket ON scan_log(ticket_id);
CREATE INDEX IF NOT EXISTS idx_scan_log_code ON scan_log(ticket_code);
