/**
 * Order lifecycle engine (payment-agnostic). See docs/ARCHITECTURE.md for flows.
 * Guarantees (tested): no oversell under concurrency, tickets issued exactly once,
 * commission snapshot immutable after order creation, refunds auditable.
 */
import { priceSplitForQty, type CommissionRates } from "./money.ts";
import { newOrderRef, newTicketCode } from "./ids.ts";
import { hashToken, signPayload, verifyPayload, newOpaqueToken } from "./auth.ts";
import { getDb, queryAll, queryOne, run, tx } from "./db.ts";

const RESERVATION_MINUTES = 15;

export const LIFECYCLE = {
  PENDING_PAYMENT: "pending_payment",
  PAYMENT_FAILED: "payment_failed",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
  PAID: "paid",
  TICKET_ISSUED: "ticket_issued",
  REFUND_PENDING: "refund_pending",
  REFUNDED: "refunded",
  RECONCILE_EXCEPTION: "reconcile_exception",
} as const;
export type OrderLifecycle = (typeof LIFECYCLE)[keyof typeof LIFECYCLE];

export function nowIso(): string {
  return new Date().toISOString();
}

/** Release stale active reservations; expire orders left pending with none. */
export function expireReservations(): number {
  const r = getDb().prepare("UPDATE reservations SET status='released' WHERE status='active' AND expires_at <= ?").run(nowIso());
  getDb().prepare(
    `UPDATE orders SET lifecycle='expired', updated_at=?
      WHERE lifecycle='pending_payment'
        AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.order_id=orders.id AND r.status='active')`,
  ).run(nowIso());
  return Number(r.changes);
}

export function activeReserved(categoryId: number): number {
  const r = queryOne(
    "SELECT COALESCE(SUM(qty),0) AS n FROM reservations WHERE category_id=? AND status='active' AND expires_at > ?",
    [categoryId, nowIso()],
  );
  return r ? Number(r.n) : 0;
}

export interface CreateOrderResult {
  ok: boolean;
  code: "created" | "sold_out" | "over_max_per_order" | "not_found" | "invalid";
  orderId?: number;
  orderRef?: string;
  msg?: string;
}

/** Validate a Kenyan mobile number into +2547XXXXXXXX / +2541XXXXXXXX form. */
export function normalisePhoneKenya(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (/^0(7|1)\d{8}$/.test(digits)) return `+254${digits.slice(1)}`;
  if (/^254(7|1)\d{8}$/.test(digits)) return `+${digits}`;
  if (/^\+254(7|1)\d{8}$/.test(raw.trim())) return raw.trim();
  return null;
}

/** Create a pending-payment order with reserved inventory in one transaction. */
export function createOrder(input: {
  categoryId: number;
  qty: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
}): CreateOrderResult {
  const qty = Math.floor(input.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) return { ok: false, code: "invalid", msg: "Invalid quantity." };
  if (!input.customerName.trim()) return { ok: false, code: "invalid", msg: "Name is required." };
  if (!normalisePhoneKenya(input.customerPhone)) return { ok: false, code: "invalid", msg: "Enter a valid Kenyan mobile number (07…/01…)." };

  return tx(() => {
    const cat = queryOne(
      `SELECT tc.id, tc.quantity, tc.sold_count, tc.max_per_order, tc.original_price,
              e.id AS event_id, e.status, e.max_per_order AS event_max
         FROM ticket_categories tc JOIN events e ON e.id = tc.event_id
        WHERE tc.id = ?`,
      [input.categoryId],
    );
    if (!cat) return { ok: false, code: "not_found", msg: "Ticket category not found." };
    if (String(cat.status) !== "on_sale") return { ok: false, code: "not_found", msg: "Event not on sale." };

    expireReservations();

    const activeRes = activeReserved(input.categoryId);
    const available = Number(cat.quantity) - Number(cat.sold_count) - activeRes;
    const maxPer = cat.max_per_order == null ? Number(cat.event_max) : Number(cat.max_per_order);
    if (qty > maxPer) return { ok: false, code: "over_max_per_order", msg: `Maximum ${maxPer} per order.` };
    if (available < qty) return { ok: false, code: "sold_out", msg: "Not enough tickets remaining." };

    const terms = queryOne("SELECT * FROM pricing_terms WHERE active=1");
    if (!terms) throw new Error("No active pricing terms configured");
    const rates: CommissionRates = {
      markupPoints: Number(terms.markup_points),
      mnmPoints: Number(terms.mnm_points),
      adPoints: Number(terms.ad_points),
      currency: String(terms.currency),
    };
    const split = priceSplitForQty(Number(cat.original_price), qty, rates);

    const orderRef = newOrderRef();
    const o = run(
      `INSERT INTO orders(order_ref,event_id,customer_name,customer_phone,customer_email,
                          pricing_terms_id,original_minor,mnm_minor,ad_minor,total_minor,currency,
                          lifecycle,access_token_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, 'pending_payment', '')`,
      [orderRef, Number(cat.event_id), input.customerName.trim(), normalisePhoneKenya(input.customerPhone)!,
       input.customerEmail ?? null, Number(terms.id), split.original, split.mnm, split.ad, split.selling, split.currency],
    );
    const orderId = o.lastInsertRowid;
    const u = split.original / qty, m = split.mnm / qty, a = split.ad / qty, s = split.selling / qty;
    run(
      "INSERT INTO order_items(order_id,category_id,qty,unit_original,unit_mnm,unit_ad,unit_selling) VALUES (?,?,?,?,?,?,?)",
      [orderId, input.categoryId, qty, u, m, a, s],
    );
    run(
      "INSERT INTO reservations(category_id,order_id,qty,status,expires_at) VALUES (?,?,?, 'active', ?)",
      [input.categoryId, orderId, qty, new Date(Date.now() + RESERVATION_MINUTES * 60_000).toISOString()],
    );
    return { ok: true, code: "created", orderId: Number(orderId), orderRef };
  });
}

/**
 * Settle as PAID exactly once (only from provider-confirmed payment handling).
 * Duplicate callbacks return alreadySettled=true and never re-run.
 */
export function settleOrderPaid(orderId: number): { ok: boolean; alreadySettled: boolean } {
  const dup = tx(() => {
    const row = queryOne("SELECT lifecycle FROM orders WHERE id=?", [orderId]);
    if (!row) return false;
    const life = String(row.lifecycle);
    if (life === LIFECYCLE.PAID || life === LIFECYCLE.TICKET_ISSUED) return true;
    if (life !== LIFECYCLE.PENDING_PAYMENT && life !== LIFECYCLE.PAYMENT_FAILED) return false;
    run("UPDATE orders SET lifecycle=?, updated_at=? WHERE id=?", [LIFECYCLE.PAID, nowIso(), orderId]);
    run("UPDATE reservations SET status='converted' WHERE order_id=? AND status='active'", [orderId]);
    return false;
  });
  if (dup) return { ok: true, alreadySettled: true };
  const firstIssue = issueTicketsOnce(orderId);
  if (!firstIssue && !isIssued(orderId)) return { ok: false, alreadySettled: false };
  return { ok: true, alreadySettled: false };
}

function isIssued(orderId: number): boolean {
  return !!queryOne("SELECT id FROM orders WHERE id=? AND lifecycle='ticket_issued'", [orderId]);
}

/** Issue one ticket row per purchased ticket; refuses unless order is exactly PAID. */
export function issueTicketsOnce(orderId: number): boolean {
  return tx(() => {
    const order = queryOne("SELECT id, lifecycle FROM orders WHERE id=?", [orderId]);
    if (!order || String(order.lifecycle) !== LIFECYCLE.PAID) return false;
    const existing = queryOne("SELECT COUNT(*) AS n FROM tickets WHERE order_id=?", [orderId]);
    if (Number(existing!.n) > 0) return false;
    const items = queryAll("SELECT id, qty FROM order_items WHERE order_id=?", [orderId]);
    for (const it of items) {
      for (let i = 0; i < Number(it.qty); i++) {
        run(
          "INSERT INTO tickets(ticket_code, order_id, order_item_id, event_id, status) VALUES (?,?,?,?, 'valid')",
          [newTicketCode(), orderId, Number(it.id), Number(queryOne("SELECT event_id FROM orders WHERE id=?", [orderId])!.event_id)],
        );
      }
    }
    run("UPDATE orders SET lifecycle=?, updated_at=? WHERE id=?", [LIFECYCLE.TICKET_ISSUED, nowIso(), orderId]);
    return true;
  });
}

export function cancelUnpaidOrder(orderRef: string): boolean {
  return tx(() => {
    const order = queryOne("SELECT id, lifecycle FROM orders WHERE order_ref=?", [orderRef]);
    if (!order || String(order.lifecycle) !== LIFECYCLE.PENDING_PAYMENT) return false;
    run("UPDATE orders SET lifecycle=?, updated_at=? WHERE id=?", [LIFECYCLE.CANCELLED, nowIso(), Number(order.id)]);
    run("UPDATE reservations SET status='released' WHERE order_id=? AND status='active'", [Number(order.id)]);
    return true;
  });
}

/** Staff-initiated refund flow (both steps audit-logged). */
export function startRefund(orderRef: string, actorId: number): boolean {
  return tx(() => {
    const order = queryOne("SELECT id, lifecycle FROM orders WHERE order_ref=?", [orderRef]);
    if (!order) return false;
    const life = String(order.lifecycle);
    if (life !== LIFECYCLE.PAID && life !== LIFECYCLE.TICKET_ISSUED) return false;
    run("UPDATE orders SET lifecycle=?, updated_at=? WHERE id=?", [LIFECYCLE.REFUND_PENDING, nowIso(), Number(order.id)]);
    run("UPDATE tickets SET status='refunded' WHERE order_id=?", [Number(order.id)]);
    run("INSERT INTO audit_log(actor_user,action,entity,entity_id,detail) VALUES (?,?,?,?,?)",
      [actorId, "order.refund_started", "orders", String(order.id), "{}"]);
    return true;
  });
}

export function completeRefund(orderRef: string, actorId: number): boolean {
  return tx(() => {
    const order = queryOne("SELECT id, lifecycle FROM orders WHERE order_ref=?", [orderRef]);
    if (!order || String(order.lifecycle) !== LIFECYCLE.REFUND_PENDING) return false;
    run("UPDATE orders SET lifecycle=?, updated_at=? WHERE id=?", [LIFECYCLE.REFUNDED, nowIso(), Number(order.id)]);
    run("UPDATE tickets SET status='refunded' WHERE order_id=? AND status='valid'", [Number(order.id)]);
    run("INSERT INTO audit_log(actor_user,action,entity,entity_id,detail) VALUES (?,?,?,?,?)",
      [actorId, "order.refund_completed", "orders", String(order.id), "{}"]);
    return true;
  });
}

// ---------- guest access ----------

/** Guest access token: raw returned once; only its hash is stored. */
export function issueGuestToken(orderId: number): string {
  const raw = newOpaqueToken();
  run("UPDATE orders SET access_token_hash=? WHERE id=?", [hashToken(raw), orderId]);
  return raw;
}

export function checkGuestAccess(ref: string, token: string): boolean {
  const o = queryOne("SELECT access_token_hash FROM orders WHERE order_ref=?", [ref]);
  return !!o && String(o.access_token_hash) === hashToken(token);
}

/** Signed guest link payload: HMAC over "order:<ref>". */
export function signGuestLink(orderRef: string, secret: Buffer): string {
  return signPayload(`order:${orderRef}`, secret);
}

export function guestLinkRef(token: string, secret: Buffer): string | null {
  const payload = verifyPayload(token, secret);
  if (!payload) return null;
  const [kind, ref] = payload.split(":");
  return kind === "order" && ref ? ref : null;
}
