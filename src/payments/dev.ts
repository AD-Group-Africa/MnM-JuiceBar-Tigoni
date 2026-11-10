/**
 * DEVELOPMENT-ONLY payment simulator.
 * Never used for real value; every record/log explicitly says it is simulated.
 * Active only when PAYMENT_PROVIDER != daraja.
 * Simulated records are clearly labelled with DEV- prefix in provider_request_id
 * and the payment_status field in the database to prevent accidental claims of real payment.
 */
import type { AppConfig } from "../config.ts";
import type { InitiateResult, PaymentProvider } from "./index.ts";

export class DevSimulator implements PaymentProvider {
  readonly name = "dev-simulator";
  constructor(private config: AppConfig) {}

  describe(): string {
    return "DEVELOPMENT SIMULATOR — no real money moves. (Configure Daraja for live payments.)";
  }

  async initiate(orderId: number, amountMinor: number, currency: string, msisdn: string): Promise<InitiateResult> {
    const force = this.config.paymentDevForceStatus;
    const providerRequestId = `DEV-SIM-${orderId}-${Date.now().toString(36)}`;
    console.log(`[dev-simulator] SIMULATED STK push to ${msisdn} for ${amountMinor} ${currency} (order ${orderId}) — force=${force || "interactive"}`);
    return { ok: true, providerRequestId, status: "initiated" };
  }
}

