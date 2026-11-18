/**
 * Security-relevant audit trail.
 *
 * Records who did what to the existing `audit_log` table (created in migration
 * 0001). Rules:
 *  - Never store passwords, session tokens, full phone numbers or emails.
 *  - IP addresses are pseudonymised (truncated SHA-256) so abuse can be
 *    correlated without retaining a directly identifying address.
 *  - A failure to write the audit row must never break the request; it is
 *    logged for the operator and the primary action still completes.
 */
import crypto from "node:crypto";
import { run } from "./db.ts";

export interface AuditEntry {
  action: string;
  entity?: string;
  entityId?: string | number | null;
  actorUser?: number | null;
  detail?: Record<string, unknown> | null;
}

export function pseudonymiseIp(ip: string | undefined | null): string | null {
  const value = String(ip ?? "").trim();
  if (!value) return null;
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

export function recordAudit(entry: AuditEntry): void {
  try {
    run("INSERT INTO audit_log(actor_user,action,entity,entity_id,detail) VALUES (?,?,?,?,?)", [
      entry.actorUser ?? null,
      entry.action,
      entry.entity ?? "system",
      entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId),
      entry.detail ? JSON.stringify(entry.detail) : null,
    ]);
  } catch (err) {
    console.warn(`[audit] could not record ${entry.action}: ${(err as Error).message}`);
  }
}
