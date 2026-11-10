// d1-mock.ts - D1-compatible mock using better-sqlite3 (async interface)
// Provides the same API surface as Cloudflare D1 env.DB for testing

import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a temporary SQLite DB for the mock in the prototype directory
const dbPath = path.resolve(__dirname, "d1-mock.db");
const db = new Database(dbPath, { readonly: false });

// Enable WAL mode and foreign keys
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 8000");

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS ticket_categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    price_minor INTEGER NOT NULL,
    quota INTEGER,
    sold INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT TRUE,
    created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT,
    total_minor INTEGER NOT NULL,
    currency TEXT DEFAULT 'KES',
    lifecycle TEXT DEFAULT 'pending',
    order_ref TEXT NOT NULL,
    created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL,
    order_id INTEGER NOT NULL,
    ticket_code TEXT NOT NULL,
    status TEXT DEFAULT 'valid',
    redeemed_at TEXT,
    redeemed_by INTEGER,
    created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS scan_log (
    id INTEGER PRIMARY KEY,
    ticket_id INTEGER,
    ticket_code TEXT,
    scanner_id INTEGER,
    result TEXT NOT NULL,
    reason TEXT,
    scanned_at TEXT
  );
`);

// Type definitions matching Cloudflare D1 env.DB interface
export interface D1QueryResult {
  rows: Array<Record<string, any>>;
}

export interface D1PreparedStatement {
  all(...params: any[]): any[];
  get(...params: any[]): any;
  run(...params: any[]): { changes: number; lastInsertRowid: number };
}

// D1Database class mimicking Cloudflare D1 binding
export class D1Database {
  #db: Database;

  constructor() {
    this.#db = db;
  }

  prepare(sql: string): D1PreparedStatement {
    const stmt = this.#db.prepare(sql);
    return {
      all: (...params: any[]) => stmt.all(...params),
      get: (...params: any[]) => stmt.get(...params),
      run: (...params: any[]) => {
        const result = stmt.run(...params);
        return {
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid,
        };
      },
    };
  }

  exec(sql: string): void {
    this.#db.exec(sql);
  }

  // Convenience methods matching the actual MnM db.ts API
  queryAll(sql: string, params: (string | number | null)[] = []): any[] {
    return this.#db.prepare(sql).all(...params);
  }

  queryOne(sql: string, params: (string | number | null)[] = []): any {
    return this.#db.prepare(sql).get(...params);
  }

  runSql(sql: string, params: (string | number | null)[] = []): { changes: number; lastInsertRowid: number } {
    const stmt = this.#db.prepare(sql);
    const result = stmt.run(...params);
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  }
}

// Export singleton instance for the prototype
export const d1Db = new D1Database();
