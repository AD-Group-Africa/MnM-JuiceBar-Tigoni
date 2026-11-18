/**
 * Explicit payment-disabled provider.
 *
 * This is the safe production mode when no online payment integration is
 * approved. It never simulates success, never contacts a provider and never
 * settles an order. Ticket checkout refuses before creating an order; existing
 * non-payment workflows (juice ordering, staff administration) keep working.
 */
import type { InitiateResult, PaymentProvider } from "./index.ts";

export class DisabledPaymentProvider implements PaymentProvider {
  readonly name = "disabled";

  describe(): string {
    return "Online payments are disabled. No payment can be started or confirmed.";
  }

  async initiate(): Promise<InitiateResult> {
    return {
      ok: false,
      providerRequestId: null,
      status: "unavailable",
      msg: "Online payments are disabled. No payment was started.",
    };
  }
}
