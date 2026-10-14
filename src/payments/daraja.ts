/**
 * Safaricom Daraja (M-Pesa Express / STK Push) adapter.
 *
 * Structure is complete per current official integration documentation
 * (developer.safaricom.co.ke): OAuth token with caching, STK initiation with
 * base64 Password(Shortcode+Passkey+Timestamp), callback parsing.
 *
 * LIVE STATUS: BLOCKED — requires MPESA_SHORTCODE/CONSUMER_KEY/CONSUMER_SECRET/
 * PASSKEY/CALLBACK_BASE from an approved merchant arrangement. No live calls have
 * been made and none may be simulated as real. See docs/PAYMENTS_AND_RECONCILIATION.md.
 */
import type { AppConfig } from "../config.ts";
import type { InitiateResult, PaymentProvider } from "./index.ts";

interface TokenCache { token: string; expiresAtMs: number }
const cache: TokenCache = { token: "", expiresAtMs: 0 };

export class DarajaProvider implements PaymentProvider {
  readonly name = "daraja";
  constructor(private config: AppConfig) {
    const m = config.mpesa;
    if (!m.shortcode || !m.consumerKey || !m.consumerSecret || !m.passkey || !m.callbackBase) {
      throw new Error("Daraja not configured: set MPESA_SHORTCODE, MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_PASSKEY, MPESA_CALLBACK_BASE");
    }
  }

  describe(): string {
    return `M-Pesa (Safaricom Daraja, ${this.config.mpesa.env})`;
  }

  private baseUrl(): string {
    return this.config.mpesa.env === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";
  }

  private timestamp(): string {
    const d = new Date();
    const p = (n: number, w: number) => String(n).padStart(w, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1, 2)}${p(d.getDate(), 2)}${p(d.getHours(), 2)}${p(d.getMinutes(), 2)}${p(d.getSeconds(), 2)}`;
  }

  /** OAuth access token, cached until ~60s before expiry. */
  private async accessToken(): Promise<string> {
    if (cache.token && Date.now() < cache.expiresAtMs) return cache.token;
    const url = `${this.baseUrl()}/oauth/v1/generate?grant_type=client_credentials`;
    const auth = Buffer.from(`${this.config.mpesa.consumerKey}:${this.config.mpesa.consumerSecret}`).toString("base64");
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok) throw new Error(`daraja oauth failed: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: string };
    cache.token = body.access_token;
    cache.expiresAtMs = Date.now() + Math.max(0, Number(body.expires_in ?? "3599") - 60) * 1_000;
    return cache.token;
  }

  /** Initiate an STK push. Returns the CheckoutRequestID used as idempotency key. */
  async initiate(orderId: number, amountMinor: number, currency: string, msisdn: string): Promise<InitiateResult> {
    if (currency !== "KES") throw new Error(`daraja: unsupported currency ${currency}`);
    const [token] = await Promise.all([this.accessToken()]);
    const ts = this.timestamp();
    const password = Buffer.from(`${this.config.mpesa.shortcode}${this.config.mpesa.passkey}${ts}`).toString("base64");
    const url = `${this.baseUrl()}/mpesa/stkpush/v1/processrequest`;
    const payload = {
      BusinessShortCode: this.config.mpesa.shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.round(amountMinor / 100), // Daraja takes whole KES
      PartyA: msisdn.replace(/^\+/, ""),
      PartyB: this.config.mpesa.shortcode,
      PhoneNumber: msisdn.replace(/^\+/, ""),
      CallBackURL: `${this.config.mpesa.callbackBase.replace(/\/$/, "")}/pay/notify/daraja`,
      AccountReference: `MNM-${orderId}`,
      TransactionDesc: "Event ticket",
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || body.ResponseCode !== "0") {
      return { ok: false, providerRequestId: null, status: "unavailable", msg: `daraja stk push failed: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}` };
    }
    return { ok: true, providerRequestId: String(body.CheckoutRequestID), status: "initiated" };
  }
}

/** Parse a Daraja STK callback body into the shape handleCallback() validates. */
export interface DarajaCallback {
  Body?: { stkCallback?: {
    MerchantRequestID?: string;
    CheckoutRequestID?: string;
    ResultCode?: number;
    ResultDesc?: string;
    CallbackMetadata?: { Item?: { Name: string; Value: unknown }[] };
  } };
}

export function parseDarajaCallback(raw: string): {
  providerRequestId: string;
  outcome: "succeeded" | "failed";
  amountMinor?: number;
  msisdn?: string;
  providerRef?: string;
  resultCode?: number;
} | null {
  let body: DarajaCallback;
  try {
    body = JSON.parse(raw) as DarajaCallback;
  } catch {
    return null;
  }
  const cb = body.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) return null;
  if (cb.ResultCode === 0) {
    const items = new Map<string, unknown>();
    for (const it of cb.CallbackMetadata?.Item ?? []) items.set(it.Name, it.Value);
    return {
      providerRequestId: cb.CheckoutRequestID,
      outcome: "succeeded",
      amountMinor: Math.round(Number(items.get("Amount")) * 100),
      msisdn: items.get("PhoneNumber") ? String(items.get("PhoneNumber")) : undefined,
      providerRef: items.get("MpesaReceiptNumber") ? String(items.get("MpesaReceiptNumber")) : undefined,
      resultCode: 0,
    };
  }
  return {
    providerRequestId: cb.CheckoutRequestID,
    outcome: "failed",
    resultCode: cb.ResultCode,
  };
}
