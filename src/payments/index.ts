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
import { DisabledPaymentProvider } from "./disabled.ts";

export interface InitiateResult {
  ok: boolean;
  /** Persisted as payments.provider_request_id (UNIQUE idempotency key). */
  providerRequestId: string | null;
  /** Daraja MerchantRequestID, stored for callback correlation when available. */
  merchantRequestId?: string | null;
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
  // No fallback. A broken live-provider configuration must stop startup, not
  // silently turn a real checkout into a simulated success.
  if (config.paymentProvider === "daraja") return new DarajaProvider(config);
  if (config.paymentProvider === "dev") return new DevSimulator(config);
  if (config.paymentProvider === "disabled") return new DisabledPaymentProvider();
  throw new Error(`[payments] unsupported provider: ${String(config.paymentProvider)}`);
}

/**
 * Persist a local initiating attempt BEFORE calling the provider. This gives the
 * order a local audit anchor and makes a provider-side charge traceable even if
 * the process fails between the network call and the response write.
 * Only one active attempt is allowed per order; a retry returns the existing one.
 */
export function recordInitiating(
  orderId: number,
  provider: string,
  amountMinor: number,
  currency: string,
  msisdn: string,
): { paymentId: number; created: boolean } {
  const existing = queryOne(
    "SELECT id FROM payments WHERE order_id=? AND status IN ('pending','initiated') ORDER BY id DESC LIMIT 1",
    [orderId],
  );
  if (existing) return { paymentId: Number(existing.id), created: false };
  // `pending` is the schema's pre-callback status; the row has no provider
  // request id until the initiation succeeds.
  const r = run(
    "INSERT INTO payments(order_id,provider,provider_request_id,amount_minor,currency,status,msisdn,raw_payload) VALUES (?,?,NULL,?,?, 'pending', ?,NULL)",
    [orderId, provider, amountMinor, currency, msisdn],
  );
  return { paymentId: Number(r.lastInsertRowid), created: true };
}

/** Attach the provider's request id after a successful initiation. */
export function completeInitiation(paymentId: number, providerRequestId: string, merchantRequestId?: string | null): boolean {
  try {
    run(
      "UPDATE payments SET provider_request_id=?, status='initiated', raw_payload=?, updated_at=? WHERE id=? AND status='pending'",
      [providerRequestId, merchantRequestId ? JSON.stringify({ merchantRequestId }) : null, nowIso(), paymentId],
    );
    return true;
  } catch {
    return false;
  }
}

/** Mark a failed initiation without deleting the audit row. */
export function failInitiation(paymentId: number, reason: string): void {
  run(
    "UPDATE payments SET status='failed', raw_payload=?, updated_at=? WHERE id=? AND status='pending'",
    [JSON.stringify({ error: reason.slice(0, 500) }), nowIso(), paymentId],
  );
}

/** Record an initiated attempt. providerRequestId must be unique per attempt. */
export function recordInitiated(orderId: number, provider: string, providerRequestId: string | null, amountMinor: number, currency: string, msisdn: string, merchantRequestId?: string | null): number | null {
  const active = queryOne(
    "SELECT id FROM payments WHERE order_id=? AND status IN ('pending','initiated') AND (provider_request_id IS NULL OR provider_request_id <> ?) LIMIT 1",
    [orderId, providerRequestId],
  );
  if (active) throw new Error("An active payment attempt already exists for this order");
  try {
    const r = run(
      "INSERT INTO payments(order_id,provider,provider_request_id,amount_minor,currency,status,msisdn,raw_payload) VALUES (?,?,?,?,?, 'initiated', ?,?)",
      [orderId, provider, providerRequestId, amountMinor, currency, msisdn, merchantRequestId ? JSON.stringify({ merchantRequestId }) : null],
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
  merchantRequestId?: string;
  /** True only after a trusted provider query (or the labelled dev simulator). */
  verified?: boolean;
  raw?: string;
}

/**
 * Apply a provider callback with full validation + idempotency.
 * Returns the outcome for the response body (the provider may retry on 500).
 */
function auditPayment(action: string, paymentId: number, orderId: number, detail: Record<string, unknown>): void {
  try {
    run("INSERT INTO audit_log(actor_user,action,entity,entity_id,detail) VALUES (NULL,?,?,?,?)",
      [action, "payments", String(paymentId), JSON.stringify({ orderId, ...detail })]);
  } catch (err) {
    // Audit failure must not turn a verified callback into a second settlement.
    console.error("[payments] audit write failed:", err);
  }
}

function providerMatches(stored: string, supplied: string): boolean {
  if (stored === supplied) return true;
  const devAliases = new Set(["dev", "dev-simulator"]);
  return devAliases.has(stored) && devAliases.has(supplied);
}

function storedMerchantRequestId(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as { merchantRequestId?: unknown };
    return typeof parsed.merchantRequestId === "string" ? parsed.merchantRequestId : null;
  } catch {
    return null;
  }
}

export function handleCallback(input: CallbackInput): { ok: boolean; httpStatus: number; detail: string } {
  const payment = queryOne("SELECT * FROM payments WHERE provider_request_id = ?", [input.providerRequestId]);
  if (!payment) {
    return { ok: false, httpStatus: 404, detail: "unknown payment reference" };
  }
  const orderId = Number(payment.order_id);
  const paymentId = Number(payment.id);

  if (!providerMatches(String(payment.provider), input.provider)) {
    auditPayment("payment.callback.provider_mismatch", paymentId, orderId, { stored: String(payment.provider), supplied: input.provider });
    return { ok: false, httpStatus: 409, detail: "provider mismatch" };
  }
  if (input.provider === "daraja" && input.verified !== true) {
    auditPayment("payment.callback.unverified", paymentId, orderId, {});
    return { ok: false, httpStatus: 401, detail: "provider callback not verified" };
  }
  const expectedMerchant = storedMerchantRequestId(payment.raw_payload);
  if (input.merchantRequestId && expectedMerchant && input.merchantRequestId !== expectedMerchant) {
    auditPayment("payment.callback.merchant_mismatch", paymentId, orderId, { supplied: input.merchantRequestId });
    run("INSERT INTO reconcile_exceptions(order_id,payment_id,reason) VALUES (?,?,?)",
      [orderId, paymentId, "merchant request reference mismatch"]);
    return { ok: false, httpStatus: 409, detail: "merchant request mismatch" };
  }

  if (String(payment.status) === "succeeded" || String(payment.status) === "duplicate") {
    if (String(payment.status) !== "duplicate") {
      run("UPDATE payments SET status='duplicate', updated_at=? WHERE id=?", [nowIso(), paymentId]);
    }
    auditPayment("payment.callback.duplicate", paymentId, orderId, {});
    return { ok: true, httpStatus: 200, detail: "duplicate ignored" };
  }

  if (input.outcome === "succeeded") {
    const order = queryOne("SELECT total_minor, currency, lifecycle FROM orders WHERE id=?", [orderId]);
    if (!order) return { ok: false, httpStatus: 500, detail: "order missing" };
    if (input.amountMinor !== Number(order.total_minor) || (input.currency && input.currency !== String(order.currency))) {
      run("UPDATE payments SET status='failed', raw_payload=?, updated_at=? WHERE id=?", [input.raw ?? "", nowIso(), paymentId]);
      run("INSERT INTO reconcile_exceptions(order_id,payment_id,reason) VALUES (?,?,?)",
        [orderId, paymentId,
         `amount/currency mismatch: got ${String(input.amountMinor)} ${input.currency ?? "?"}, expected ${Number(order.total_minor)} ${String(order.currency)}`]);
      auditPayment("payment.callback.amount_mismatch", paymentId, orderId, {});
      return { ok: true, httpStatus: 200, detail: "amount mismatch logged; order NOT settled" };
    }
    const res = settleOrderPaid(orderId);
    if (!res.ok) {
      // e.g. order expired/cancelled or capacity changed while payment completed → reconciliation queue.
      run("INSERT INTO reconcile_exceptions(order_id,payment_id,reason) VALUES (?,?,?)",
        [orderId, paymentId, `payment succeeded but order un-settleable (lifecycle=${String(order.lifecycle)})`]);
      run("UPDATE payments SET status='succeeded', provider_ref=?, updated_at=? WHERE id=?", [input.providerRef ?? null, nowIso(), paymentId]);
      auditPayment("payment.callback.unsettleable", paymentId, orderId, { lifecycle: String(order.lifecycle) });
      return { ok: true, httpStatus: 200, detail: "payment recorded, order needs review" };
    }
    run("UPDATE payments SET status='succeeded', provider_ref=?, updated_at=? WHERE id=?",
      [input.providerRef ?? null, nowIso(), paymentId]);
    auditPayment("payment.callback.settled", paymentId, orderId, { duplicate: res.alreadySettled });
    return { ok: true, httpStatus: 200, detail: res.alreadySettled ? "order already settled" : "settled and tickets issued" };
  }

  // failed / expired
  run("UPDATE payments SET status=?, updated_at=? WHERE id=?", [input.outcome, nowIso(), paymentId]);
  auditPayment(`payment.callback.${input.outcome}`, paymentId, orderId, {});
  const order = queryOne("SELECT lifecycle FROM orders WHERE id=?", [orderId]);
  if (order && String(order.lifecycle) === LIFECYCLE.PENDING_PAYMENT) {
    run("UPDATE orders SET lifecycle=?, updated_at=? WHERE id=?", [LIFECYCLE.PAYMENT_FAILED, nowIso(), orderId]);
  }
  return { ok: true, httpStatus: 200, detail: "failure recorded" };
}

export function paymentsForOrder(orderId: number): Record<string, unknown>[] {
  return queryAll("SELECT * FROM payments WHERE order_id=? ORDER BY id", [orderId]);
}
