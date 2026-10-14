/**
 * Payment provider abstraction + central, idempotent settlement handling.
 *
 * NEVER trusts a browser-side "success" — only a validated provider callback
 * (or the explicitly-labelled dev simulator) settles an order.
 */
import type { AppConfig } from "../config.ts";
import { queryAll, queryOne, run } from "../db.ts";
import { nowIso, settleOrderPaid, LIFECYCLE } from "../orders.ts";
import { DevSimulator } from "./dev.ts";
import { DarajaProvider } from "./daraja.ts";

export interface InitiateResult {
  ok: boolean;
  /** Persisted as payments.provider_request_id (UNIQUE idempotency key). */
  providerRequestId: string | null;
  status: "initiated" | "unavailable";
  msg?: string;
}

export interface PaymentProvider {
  readonly name: string;
  /** Human description for checkout UI and logs. */
  describe(): string;
  /** Start a payment attempt for the order. Implementations validate msisdn. */
  initiate(orderId: number, amountMinor: number, currency: string, msisdn: string): Promise<InitiateResult>;
}

export function getProvider(config: AppConfig): PaymentProvider {
  if (config.paymentProvider === "daraja") {
    try {
      return new DarajaProvider(config);
    } catch (err) {
      console.warn("[payments] Daraja unavailable, falling back to dev simulator:", (err as Error).message);
    }
  }
  return new DevSimulator(config);
}

/** Record an initiated attempt. providerRequestId must be unique per attempt. */
export function recordInitiated(orderId: number, provider: string, providerRequestId: string | null, amountMinor: number, currency: string, msisdn: string): number | null {
  try {
    const r = run(
      "INSERT INTO payments(order_id,provider,provider_request_id,amount_minor,currency,status,msisdn) VALUES (?,?,?,?,?, 'initiated', ?)",
      [orderId, provider, providerRequestId, amountMinor, currency, msisdn],
    );
    return Number(r.lastInsertRowid);
  } catch {
    // UNIQUE collision on provider_request_id → provider resent; map to the existing row.
    const existing = providerRequestId
      ? queryOne("SELECT id FROM payments WHERE provider_request_id = ?", [providerRequestId])
      : undefined;
    if (!existing) throw new Error("payment insert failed without unique reference");
    return Number(existing.id);
  }
}

export interface CallbackInput {
  provider: string;
  providerRequestId: string;
  outcome: "succeeded" | "failed" | "expired";
  amountMinor?: number;
  currency?: string;
  providerRef?: string;
  msisdn?: string;
  raw?: string;
}

/**
 * Apply a provider callback with full validation + idempotency.
 * Returns the outcome for the response body (the provider may retry on 500).
 */
export function handleCallback(input: CallbackInput): { ok: boolean; httpStatus: number; detail: string } {
  const payment = queryOne("SELECT * FROM payments WHERE provider_request_id = ?", [input.providerRequestId]);
  if (!payment) {
    return { ok: false, httpStatus: 404, detail: "unknown payment reference" };
  }
  const orderId = Number(payment.order_id);
  if (String(payment.status) === "succeeded") {
    run("UPDATE payments SET status='duplicate', updated_at=? WHERE id=?", [nowIso(), Number(payment.id)]);
    return { ok: true, httpStatus: 200, detail: "duplicate ignored" };
  }

  if (input.outcome === "succeeded") {
    const order = queryOne("SELECT total_minor, currency, lifecycle FROM orders WHERE id=?", [orderId]);
    if (!order) return { ok: false, httpStatus: 500, detail: "order missing" };
    if (input.amountMinor !== Number(order.total_minor) || (input.currency && input.currency !== String(order.currency))) {
      run("UPDATE payments SET status='failed', raw_payload=?, updated_at=? WHERE id=?", [input.raw ?? "", nowIso(), Number(payment.id)]);
      run("INSERT INTO reconcile_exceptions(order_id,payment_id,reason) VALUES (?,?,?)",
        [orderId, Number(payment.id),
         `amount/currency mismatch: got ${String(input.amountMinor)} ${input.currency ?? "?"}, expected ${Number(order.total_minor)} ${String(order.currency)}`]);
      return { ok: true, httpStatus: 200, detail: "amount mismatch logged; order NOT settled" };
    }
    const res = settleOrderPaid(orderId);
    if (!res.ok) {
      // e.g. order expired/cancelled while payment completed → reconciliation queue.
      run("INSERT INTO reconcile_exceptions(order_id,payment_id,reason) VALUES (?,?,?)",
        [orderId, Number(payment.id), `payment succeeded but order un-settleable (lifecycle=${String(order.lifecycle)})`]);
      run("UPDATE payments SET status='succeeded', provider_ref=?, updated_at=? WHERE id=?", [input.providerRef ?? null, nowIso(), Number(payment.id)]);
      return { ok: true, httpStatus: 200, detail: "payment recorded, order needs review" };
    }
    run("UPDATE payments SET status='succeeded', provider_ref=?, updated_at=? WHERE id=?",
      [input.providerRef ?? null, nowIso(), Number(payment.id)]);
    return { ok: true, httpStatus: 200, detail: res.alreadySettled ? "order already settled" : "settled and tickets issued" };
  }

  // failed / expired
  run("UPDATE payments SET status=?, updated_at=? WHERE id=?", [input.outcome, nowIso(), Number(payment.id)]);
  const order = queryOne("SELECT lifecycle FROM orders WHERE id=?", [orderId]);
  if (order && String(order.lifecycle) === LIFECYCLE.PENDING_PAYMENT) {
    run("UPDATE orders SET lifecycle=?, updated_at=? WHERE id=?", [LIFECYCLE.PAYMENT_FAILED, nowIso(), orderId]);
  }
  return { ok: true, httpStatus: 200, detail: "failure recorded" };
}

export function paymentsForOrder(orderId: number): Record<string, unknown>[] {
  return queryAll("SELECT * FROM payments WHERE order_id=? ORDER BY id", [orderId]);
}
