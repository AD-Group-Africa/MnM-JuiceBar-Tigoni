/**
 * DEVELOPMENT-ONLY payment simulator.
 * Never used for real value; every record/log explicitly says it is simulated.
 * Active only when PAYMENT_PROVIDER != daraja.
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
    const providerRequestId = `DEV-${orderId}-${Date.now().toString(36)}`;
    console.log(`[dev-simulator] SIMULATED STK push to ${msisdn} for ${amountMinor} ${currency} (order ${orderId}) — force=${force || "interactive"}`);
    return { ok: true, providerRequestId, status: "initiated" };
  }
}
