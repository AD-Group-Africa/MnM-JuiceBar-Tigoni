/**
 * Ticket verification & redemption (server-side only).
 * Rules (tested in tests/tickets.test.ts):
 *  - unknown codes rejected;
 *  - valid tickets accepted and redeemed exactly once (atomic guarded UPDATE);
 *  - redeemed / refunded / cancelled tickets rejected without state change;
 *  - tickets of cancelled events rejected;
 *  - every attempt recorded in scan_log (accepted and rejected) with scanner id.
 */
import { queryOne, run, tx } from "./db.ts";
import { nowIso } from "./orders.ts";

export type VerifyOutcome =
  | "accepted"
  | "unknown_code"
  | "already_redeemed"
  | "refunded"
  | "cancelled"
  | "void"
  | "event_cancelled"
  | "order_not_issued";

export interface VerifyResult {
  outcome: VerifyOutcome;
  ok: boolean;
  httpStatus: number;
  /** Customer-facing detail (no PII leak): event title, hold info. */
  detail: string;
  event?: { id: number; title: string; starts_at: string; venue_name: string };
}

export function verifyTicket(code: string): VerifyResult {
  const t = queryOne(
    `SELECT t.id, t.status AS ticket_status, t.event_id, o.lifecycle AS order_lifecycle,
            e.title, e.starts_at, e.venue_name, e.status AS event_status
       FROM tickets t
       JOIN orders o ON o.id = t.order_id
       JOIN events e ON e.id = t.event_id
      WHERE t.ticket_code = ?`,
    [code],
  );
  if (!t) return { outcome: "unknown_code", ok: false, httpStatus: 404, detail: "Ticket not recognised. Check the code or try manual lookup." };

  if (String(t.order_lifecycle) !== "ticket_issued") {
    return { outcome: "order_not_issued", ok: false, httpStatus: 409, detail: "Ticket is not in an issued state." };
  }
  const status = String(t.ticket_status);
  if (status === "redeemed") return { outcome: "already_redeemed", ok: false, httpStatus: 409, detail: "This ticket was already used.", event: ev(t) };
  if (status === "refunded") return { outcome: "refunded", ok: false, httpStatus: 409, detail: "This ticket was refunded." };
  if (status === "cancelled") return { outcome: "cancelled", ok: false, httpStatus: 409, detail: "This ticket was cancelled." };
  if (status === "void") return { outcome: "void", ok: false, httpStatus: 409, detail: "This ticket is void." };
  if (String(t.event_status) === "cancelled") return { outcome: "event_cancelled", ok: false, httpStatus: 409, detail: "The event was cancelled; ticket not redeemable." };

  return { outcome: "accepted", ok: true, httpStatus: 200, detail: "Valid ticket", event: ev(t) };
}

function ev(t: Record<string, unknown>): VerifyResult["event"] {
  return {
    id: Number(t.event_id),
    title: String(t.title),
    starts_at: String(t.starts_at),
    venue_name: String(t.venue_name),
  };
}

/** Atomic redemption; every attempt (both outcomes) is audited. */
export function redeemTicket(code: string, scannerId: number): { result: VerifyResult; scanId: number } {
  const pre = verifyTicket(code);
  if (!pre.ok) {
    const ticket = queryOne("SELECT id FROM tickets WHERE ticket_code=?", [code]);
    const r = run(
      "INSERT INTO scan_log(ticket_id,ticket_code,scanner_id,result,reason) VALUES (?,?,?,?,?)",
      [ticket ? Number(ticket.id) : null, code, scannerId, "rejected", pre.outcome],
    );
    return { result: pre, scanId: Number(r.lastInsertRowid) };
  }
  const outcome = tx(() => {
    const r = run(
      "UPDATE tickets SET status='redeemed', redeemed_at=?, redeemed_by=? WHERE ticket_code=? AND status='valid'",
      [nowIso(), scannerId, code],
    );
    if (Number(r.changes) === 1) return "accepted" as const;
    // Lost the race or state changed between verify and redeem → re-check for accurate reason.
    const after = queryOne("SELECT status FROM tickets WHERE ticket_code=?", [code]);
    const st = after ? String(after.status) : "unknown";
    return (st === "redeemed" ? "already_redeemed" : st === "valid" ? "accepted" : st) as VerifyOutcome;
  });
  if (outcome === "accepted") {
    const t = queryOne(
      `SELECT t.id, e.title, e.starts_at, e.venue_name FROM tickets t JOIN events e ON e.id=t.event_id WHERE t.ticket_code=?`,
      [code],
    )!;
    const scan = run(
      "INSERT INTO scan_log(ticket_id,ticket_code,scanner_id,result,reason) VALUES (?,?,?,?,?)",
      [Number(t.id), code, scannerId, "accepted", null],
    );
    return {
      result: {
        outcome: "accepted", ok: true, httpStatus: 200, detail: `Admit — ${String(t.title)}`,
        event: { id: Number(t.event_id), title: String(t.title), starts_at: String(t.starts_at), venue_name: String(t.venue_name) },
      },
      scanId: Number(scan.lastInsertRowid),
    };
  }
  const failed = verifyTicket(code);
  failed.detail = failed.detail === "Valid ticket" ? "Ticket state changed during redemption." : failed.detail;
  const ticket = queryOne("SELECT id FROM tickets WHERE ticket_code=?", [code]);
  const scan = run(
    "INSERT INTO scan_log(ticket_id,ticket_code,scanner_id,result,reason) VALUES (?,?,?,?,?)",
    [ticket ? Number(ticket.id) : null, code, scannerId, rejected(outcome), outcome],
  );
  void failed;
  return { result: failed, scanId: Number(scan.lastInsertRowid) };
}

function rejected(o: VerifyOutcome): "accepted" | "rejected" {
  return o === "accepted" ? "accepted" : "rejected";
}
