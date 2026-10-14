/**
 * Identifier helpers. All randomness from node:crypto (CSPRNG).
 * Ticket codes deliberately carry no personal data — meaningful info lives
 * server-side; the code is only an unguessable lookup key.
 */
import crypto from "node:crypto";

const ALNUM = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function randomCode(len: number): string {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALNUM[bytes[i]! % ALNUM.length];
  return out;
}

/** Human order reference, e.g. MNM-8K3F92 (excludes confusable characters). */
export function newOrderRef(): string {
  return `MNM-${randomCode(6)}`;
}

/** Ticket code, e.g. 8K3F92-QW1XCD (unguessable: 12 chars ~ 60 bits). */
export function newTicketCode(): string {
  return `${randomCode(6)}-${randomCode(6)}`;
}

/** CSRF nonce for per-session form double-submit. */
export function newCsrfToken(): string {
  return crypto.randomBytes(16).toString("base64url");
}
