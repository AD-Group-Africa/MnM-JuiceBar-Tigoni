/**
 * Authentication & authorisation.
 * - Passwords: scrypt with per-user random salt (node:crypto).
 * - Sessions: opaque random tokens; the DB stores only the SHA-256 of the token.
 * - Cookies: HttpOnly, SameSite=Lax, Secure in production.
 * - CSRF: SameSite=Lax + strict Origin/Referer allowlist on state-changing requests
 *   (enforced in middleware; tested in tests/auth.test.ts).
 * - Authorisation: server-side role checks on every protected operation —
 *   hiding UI buttons is never the access control.
 */
import crypto from "node:crypto";
import type { Context } from "hono";
import type { AppConfig } from "./config.ts";
import { queryOne, run } from "./db.ts";

export type Role = "owner" | "manager" | "sales_staff" | "scanner" | "ad_admin";
export type Capability = "admin" | "manage" | "scan" | "reports";

export interface SessionUser {
  id: number;
  fullName: string;
  role: Role;
}

export const SESSION_COOKIE = "mnm_session";
const SESSION_TTL_HOURS = 12;

// ---------- passwords ----------

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const dk = await scryptHash(password, salt);
  return `scrypt$${salt}$${dk}`;
}

async function scryptHash(password: string, salt: string): Promise<string> {
  const dk = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 }, (err, d) =>
      err ? reject(err) : resolve(d),
    );
  });
  return dk.toString("hex");
}

/** Constant-time password verification. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const dk = await scryptHash(password, salt);
  return crypto.timingSafeEqual(Buffer.from(dk, "hex"), Buffer.from(hash, "hex"));
}

// ---------- sessions ----------

export function newSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createSession(userId: number, ip: string, token: string): void {
  const expires = new Date(Date.now() + SESSION_TTL_HOURS * 3_600_000).toISOString();
  run("INSERT INTO sessions(token_hash,user_id,expires_at,created_ip) VALUES (?,?,?,?)", [
    hashToken(token), userId, expires, ip,
  ]);
}

export function getSessionUser(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const h = hashToken(token);
  const row = queryOne(
    `SELECT u.id, u.full_name, u.role, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND u.is_active = 1`,
    [h],
  );
  if (!row) return null;
  if (new Date(String(row.expires_at)).getTime() < Date.now()) {
    run("DELETE FROM sessions WHERE token_hash = ?", [h]);
    return null;
  }
  return { id: Number(row.id), fullName: String(row.full_name), role: String(row.role) as Role };
}

export function destroySession(token: string | undefined): void {
  if (!token) return;
  run("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
}

export function setSessionCookie(ctx: Context, token: string, config: AppConfig): void {
  ctx.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_HOURS * 3600}` +
      (config.env === "production" ? "; Secure" : ""),
  );
}

export function clearSessionCookie(ctx: Context): void {
  ctx.header("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// ---------- signed guest tokens (order/ticket access links, QR payloads) ----------

export function newOpaqueToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/** Signed payload: <base64url(payload)>.<hmac>; used for guest order links. */
export function signPayload(payload: string, secret: Buffer): string {
  const mac = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${mac}`;
}

export function verifyPayload(token: string, secret: Buffer): string | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  let payload: string;
  try {
    payload = Buffer.from(body, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return payload;
}

// ---------- role guards ----------

const ROLE_CLEARANCE: Record<Role, Capability[]> = {
  ad_admin: ["admin", "manage", "scan", "reports"],
  owner: ["manage", "scan", "reports"],
  manager: ["manage", "scan", "reports"],
  sales_staff: ["reports", "scan"],
  scanner: ["scan"],
};

export function roleAllows(role: Role, capability: Capability): boolean {
  return ROLE_CLEARANCE[role].includes(capability);
}

// ---------- CSRF / origin check ----------

/**
 * State-changing requests must carry an Origin or Referer header matching one of the
 * configured public origins (complements SameSite=Lax session cookies).
 */
export function stateChangeOriginAllowed(ctx: Context, publicOrigins: string[]): boolean {
  const method = ctx.req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const origin = ctx.req.header("origin") ?? ctx.req.header("referer");
  if (!origin) return false;
  try {
    const o = new URL(origin);
    return publicOrigins.some((allowed) => {
      const a = new URL(allowed);
      return o.protocol === a.protocol && o.host === a.host;
    });
  } catch {
    return false;
  }
}
