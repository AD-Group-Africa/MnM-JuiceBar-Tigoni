/**
 * Optional customer accounts for order history.
 *
 * Guest checkout remains the default. An account only links orders created while
 * the customer is signed in; it never claims historical orders by phone alone.
 * Passwords are hashed with the same scrypt helper as staff accounts, and only
 * SHA-256 session-token hashes are stored.
 */
import type { Context } from "hono";
import type { AppConfig } from "./config.ts";
import { queryAll, queryOne, run } from "./db.ts";
import { hashPassword, hashToken, newSessionToken, verifyPassword } from "./auth.ts";
import { normalisePhoneKenya } from "./orders.ts";

export const CUSTOMER_COOKIE = "mnm_customer";
const SESSION_DAYS = 30;

export interface Customer {
  id: number;
  fullName: string;
  phone: string;
}

export async function registerCustomer(input: {
  fullName: string;
  phone: string;
  password: string;
}): Promise<{ ok: true; customer: Customer } | { ok: false; msg: string }> {
  const name = input.fullName.trim().slice(0, 100);
  const phone = normalisePhoneKenya(input.phone);
  if (!name) return { ok: false, msg: "Enter your name." };
  if (!phone) return { ok: false, msg: "Enter a valid Kenyan mobile number (07…/01…)." };
  if (input.password.length < 8) return { ok: false, msg: "Use at least 8 characters for your password." };
  if (queryOne("SELECT id FROM customers WHERE phone=?", [phone])) {
    return { ok: false, msg: "An account already exists for that phone. Sign in instead." };
  }
  const hash = await hashPassword(input.password);
  const r = run(
    "INSERT INTO customers(full_name,phone,password_hash) VALUES (?,?,?)",
    [name, phone, hash],
  );
  return { ok: true, customer: { id: Number(r.lastInsertRowid), fullName: name, phone } };
}

export async function authenticateCustomer(phoneRaw: string, password: string): Promise<Customer | null> {
  const phone = normalisePhoneKenya(phoneRaw);
  if (!phone) return null;
  const row = queryOne("SELECT id, full_name, phone, password_hash FROM customers WHERE phone=? AND is_active=1", [phone]);
  if (!row) return null;
  if (!(await verifyPassword(password, String(row.password_hash)))) return null;
  return { id: Number(row.id), fullName: String(row.full_name), phone: String(row.phone) };
}

export function createCustomerSession(customerId: number, ip: string): string {
  const token = newSessionToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  run(
    "INSERT INTO customer_sessions(token_hash,customer_id,expires_at,created_ip) VALUES (?,?,?,?)",
    [hashToken(token), customerId, expires, ip],
  );
  return token;
}

export function getCustomerBySession(token: string | undefined): Customer | null {
  if (!token) return null;
  const h = hashToken(token);
  const row = queryOne(
    `SELECT c.id, c.full_name, c.phone, s.expires_at
       FROM customer_sessions s JOIN customers c ON c.id = s.customer_id
      WHERE s.token_hash=? AND c.is_active=1`,
    [h],
  );
  if (!row) return null;
  if (new Date(String(row.expires_at)).getTime() < Date.now()) {
    run("DELETE FROM customer_sessions WHERE token_hash=?", [h]);
    return null;
  }
  return { id: Number(row.id), fullName: String(row.full_name), phone: String(row.phone) };
}

export function destroyCustomerSession(token: string | undefined): void {
  if (!token) return;
  run("DELETE FROM customer_sessions WHERE token_hash=?", [hashToken(token)]);
}

export function setCustomerCookie(ctx: Context, token: string, config: AppConfig): void {
  ctx.header(
    "Set-Cookie",
    `${CUSTOMER_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}` +
      (config.env === "production" ? "; Secure" : ""),
  );
}

export function clearCustomerCookie(ctx: Context, config: AppConfig): void {
  ctx.header(
    "Set-Cookie",
    `${CUSTOMER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` +
      (config.env === "production" ? "; Secure" : ""),
  );
}

export function linkJuiceOrderToCustomer(orderId: number, customerId: number): void {
  run("UPDATE juice_orders SET customer_id=? WHERE id=? AND customer_id IS NULL", [customerId, orderId]);
}

export function linkTicketOrderToCustomer(orderId: number, customerId: number): void {
  run("UPDATE orders SET customer_id=? WHERE id=? AND customer_id IS NULL", [customerId, orderId]);
}

export function juiceOrderHistory(customerId: number): Record<string, unknown>[] {
  return queryAll(
    `SELECT order_ref, status, type, total_minor, currency, created_at
       FROM juice_orders WHERE customer_id=? ORDER BY id DESC LIMIT 100`,
    [customerId],
  );
}

export function ticketOrderHistory(customerId: number): Record<string, unknown>[] {
  return queryAll(
    `SELECT o.order_ref, o.lifecycle, o.total_minor, o.currency, o.created_at, e.title AS event
       FROM orders o JOIN events e ON e.id=o.event_id
      WHERE o.customer_id=? ORDER BY o.id DESC LIMIT 100`,
    [customerId],
  );
}
