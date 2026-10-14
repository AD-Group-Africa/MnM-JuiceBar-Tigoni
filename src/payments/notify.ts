/** Provider-callback parsing shared by the HTTP layer. */
import { parseDarajaCallback } from "./daraja.ts";
import type { ParsedNotify } from "./notify-types.ts";

export type { ParsedNotify };
export type { ParsedNotify as ParsedNotifyT };

export function parseDarajaNotify(raw: string): ParsedNotify | null {
  const d = parseDarajaCallback(raw);
  if (!d) return null;
  return {
    providerRequestId: d.providerRequestId,
    outcome: d.outcome,
    amountMinor: d.amountMinor,
    currency: "KES",
    providerRef: d.providerRef,
    msisdn: d.msisdn,
    resultCode: d.resultCode,
  };
}
