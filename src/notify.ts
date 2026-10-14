/**
 * Notifications — interface plus development adapter.
 * The 'console' adapter NEVER claims delivery: it writes a clearly-labelled line
 * to the log and stores the attempt in the notifications table. A real provider
 * integration must record provider-side confirmation; until then status stays
 * 'sent(with dev adapter)' — deliberately worded to prevent false delivery claims.
 */
import { run } from "./db.ts";

export type Channel = "email" | "sms";

export interface Dated {
  orderRef: string;
  eventTitle: string;
  eventStartsAt: string;
  venue: string;
  ticketsSummary: string;   // e.g. "2 × Regular"
  totalMinor: number;
  currency: string;
  ticketsUrl: string;       // signed URL for guest access
  supportPhone: string;
}

export function renderSms(d: Dated): string {
  return `[DEV-SIM] MnM Tickets: order ${d.orderRef} confirmed. ${d.ticketsSummary} for ${d.eventTitle}. Tickets: ${d.ticketsUrl} Support: ${d.supportPhone}`;
}

export function renderEmail(d: Dated): { subject: string; body: string } {
  return {
    subject: `Your MnM Tickets order ${d.orderRef}`,
    body:
      `[DEV-SIM] Asante! Order ${d.orderRef} for ${d.eventTitle} is confirmed.\n` +
      `Tickets: ${d.ticketsSummary}\nView/download: ${d.ticketsUrl}\n` +
      `Venue: ${d.venue}; starts ${d.eventStartsAt}\nSupport: ${d.supportPhone}`,
  };
}

/** Attempt a send; always records the attempt. Returns the honest status string. */
export function send(channel: Channel, recipient: string, template: string, payload: object): string {
  const text = JSON.stringify(payload);
  run(
    "INSERT INTO notifications(channel,recipient,template,payload,status,detail) VALUES (?,?,?,?,?,?)",
    [channel, recipient, template, text, "sent(with dev adapter)", "console adapter — NOT delivered externally"],
  );
  console.log(
    `[notify:DEV-ADAPTER] ${channel} -> ${recipient} (${template}) content: ${truncate(JSON.stringify(payload), 220)}`,
  );
  return "sent(with dev adapter)";
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
