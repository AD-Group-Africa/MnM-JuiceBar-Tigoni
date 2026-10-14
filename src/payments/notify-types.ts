export interface ParsedNotify {
  providerRequestId: string;
  outcome: "succeeded" | "failed" | "expired";
  amountMinor?: number;
  currency?: string;
  providerRef?: string;
  msisdn?: string;
  resultCode?: number;
}
