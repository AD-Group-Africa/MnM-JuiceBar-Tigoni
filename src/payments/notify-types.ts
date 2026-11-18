export interface ParsedNotify {
  providerRequestId: string;
  merchantRequestId?: string;
  outcome: "succeeded" | "failed" | "expired";
  amountMinor?: number;
  currency?: string;
  providerRef?: string;
  msisdn?: string;
  resultCode?: number;
}
