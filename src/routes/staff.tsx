/**
 * Staff authentication: login/logout pages + route guards used by all staff areas.
 * Security notes:
 * - login rate-limited per phone/IP (essential for a public endpoint),
 * - sessions stored server-side, cookie HttpOnly SameSite=Lax (+Secure in prod),
 * - all staff mutations require an allowlisted Origin/Referer (CSRF defence-in-depth).
 */
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { Context, Next } from "hono";
import type { AppConfig } from "../config.ts";
import { queryAll } from "../db.ts";
import {
  SESSION_COOKIE, clearSessionCookie, createSession, destroySession, getSessionUser,
  hashPassword, newSessionToken, normalisePhone, roleAllows, setSessionCookie, stateChangeOriginAllowed,
  verifyPassword, type Capability, type SessionUser,
} from "../auth.ts";
import { newCsrfToken } from "../ids.ts";
import { clientIp, consumeRateLimit } from "../ratelimit.ts";
import { pseudonymiseIp, recordAudit } from "../audit.ts";
import { Page } from "../views/layout.tsx";

const loginAttempts = new Map<string, { n: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 10 * 60_000;
const LOGIN_MAX_ATTEMPTS = 8;

function rateLimited(ip: string, key: string): boolean {
  const k = `${ip}:${key}`;
  const now = Date.now();
  const a = loginAttempts.get(k);
  if (!a || a.resetAt < now) return false;
  return a.n >= LOGIN_MAX_ATTEMPTS;
}

function recordFail(ip: string, key: string): void {
  const k = `${ip}:${key}`;
  const now = Date.now();
  const a = loginAttempts.get(k);
  if (!a || a.resetAt < now) loginAttempts.set(k, { n: 1, resetAt: now + LOGIN_WINDOW_MS });
  else a.n++;
}

function successClear(ip: string, key: string): void {
  loginAttempts.delete(`${ip}:${key}`);
}

async function fixedHash(pw: string): Promise<string> { return hashPassword(pw); } // burn constant work on failed login

export function authRoutes(config: AppConfig): Hono {
  const app = new Hono();

  app.get("/staff/login", (c) =>
    c.html(
      <Page title="Sign in" chrome="plain">
        <div class="auth-shell">
          <aside class="auth-brand">
            <a class="auth-brand-mark" href="/" aria-label="MnM Juice Bar home">
              <span class="brand-mark">M&amp;M</span>
              <span class="brand-sub">Juice Bar<small class="brand-sub-locale">Tigoni</small></span>
            </a>
            <div class="auth-brand-copy">
              <p class="kicker">MnM operations</p>
              <h1 class="display">Good service starts<br /><em>behind the counter.</em></h1>
              <p class="auth-brand-sub">Orders, tickets, scanning and trading — one place for the MnM team.</p>
            </div>
            <p class="auth-brand-foot">MnM Juice Bar · Tigoni, Limuru<br /><small>Authorised staff only. Sessions expire after 12 hours.</small></p>
          </aside>

          <div class="auth-panel">
            <div class="auth-card">
              <p class="kicker">Team access</p>
              <h2>Sign in</h2>
              <p class="muted small">Use the phone number and password issued to you by the owner.</p>
              <form method="post" action="/staff/login" class="auth-form">
                <input type="hidden" name="next" value={c.req.query("next") ?? "/staff"} />
                <div class="field">
                  <label for="phone">Phone number</label>
                  <input id="phone" name="phone" type="tel" required autocomplete="tel" inputmode="tel" placeholder="+254 705 687 273" />
                </div>
                <div class="field">
                  <label for="password">Password</label>
                  <input id="password" name="password" type="password" required autocomplete="current-password" placeholder="••••••••" />
                </div>
                <button class="btn btn-primary btn-block btn-lg" type="submit">Sign in</button>
              </form>
              <div class="auth-help">
                <p><strong>Can't get in?</strong> Check the number is the one registered for your account, then ask the owner to reset your password.</p>
                <p><a href="/">← Back to MnM Juice Bar</a></p>
              </div>
            </div>
          </div>
        </div>
      </Page>,
    ));

  app.post("/staff/login", async (c) => {
    if (!stateChangeOriginAllowed(c, config.publicOrigins)) {
      return c.html(<Page title="Blocked"><div class="panel notice bad">Invalid request origin.</div></Page>, 403);
    }
    const ip = clientIp(c);
    // Per-phone throttling alone lets an attacker spray many phone numbers, so
    // also cap all attempts from one IP.
    if (!consumeRateLimit("staff-login-ip", ip, 50, LOGIN_WINDOW_MS).allowed) {
      recordAudit({ action: "auth.rate_limited", entity: "staff", detail: { ip: pseudonymiseIp(ip) } });
      return c.html(<Page title="Too many attempts"><div class="panel notice bad">Too many sign-in attempts from this network. Try again in a few minutes.</div></Page>, 429);
    }
    const form = await c.req.parseBody();
    const phone = String(form.phone ?? "").trim();
    const password = String(form.password ?? "");
    const next = String(form.next ?? "/staff");

    const wanted = normalisePhone(phone);
    if (rateLimited(ip, wanted)) {
      return c.html(<Page title="Too many attempts"><div class="panel notice bad">Too many sign-in attempts. Try again in a few minutes.</div></Page>, 429);
    }
    // Match on the canonical form so "+254 705 687 273" (as displayed on the
    // site) and "+254705687273" (as stored) resolve to the same account.
    const user = queryAll("SELECT id, full_name, role, password_hash, is_active, phone FROM users")
      .find((u) => normalisePhone(String(u.phone)) === wanted);
    const ok = !!user && Number(user.is_active) === 1 && await verifyPassword(password, String(user.password_hash));
    if (!ok) {
      recordFail(ip, wanted);
      recordAudit({ action: "auth.login_failed", entity: "staff", detail: { ip: pseudonymiseIp(ip) } });
      // Burn a constant amount of work to blunt timing/enum differences.
      await fixedHash("spare-work");
      return c.html(<Page title="Sign-in failed"><div class="narrow"><div class="panel notice bad">Wrong phone or password.</div></div></Page>, 401);
    }
    successClear(ip, wanted);
    recordAudit({ action: "auth.login", entity: "staff", entityId: Number(user!.id), actorUser: Number(user!.id), detail: { ip: pseudonymiseIp(ip) } });
    const token = newSessionToken();
    createSession(Number(user!.id), ip, token);
    setSessionCookie(c, token, config);
    if (!safeNext(next)) return c.redirect("/staff");
    // A gate scanner has no dashboard clearance: send them to the scan console
    // instead of /staff, which would bounce them straight back to sign-in.
    const role = user!.role as Parameters<typeof roleAllows>[0];
    if (next === "/staff" && !roleAllows(role, "reports")) return c.redirect("/staff/scan");
    return c.redirect(next);
    function safeNext(n: string): boolean {
      return n.startsWith("/") && !n.startsWith("//");
    }
  });

  app.post("/staff/logout", (c) => {
    if (!stateChangeOriginAllowed(c, config.publicOrigins)) return c.text("", 403);
    const current = getSessionUser(getCookie(c, SESSION_COOKIE));
    if (current) recordAudit({ action: "auth.logout", entity: "staff", entityId: current.id, actorUser: current.id });
    destroySession(getCookie(c, SESSION_COOKIE));
    clearSessionCookie(c);
    return c.redirect("/");
  });

  return app;
}

// ---------- guards for other modules ----------

/**
 * Resolve the current staff user when the request carries a valid session for the
 * given capability AND (for non-GET)s an allowed origin. Returns null when denied.
 * The caller decides the response: redirect to login (HTML) or 401 (JSON).
 */
export async function requireCapability(c: Context, config: AppConfig, capability: Capability): Promise<SessionUser | null> {
  if (!stateChangeOriginAllowed(c, config.publicOrigins)) return null;
  const user = getSessionUser(getCookie(c, SESSION_COOKIE));
  if (!user || !roleAllows(user.role, capability)) return null;
  c.set("csrfToken", newCsrfToken());
  c.set("staffUser", user);
  return user;
}

declare module "hono" {
  interface ContextVariableMap {
    csrfToken: string;
    staffUser: SessionUser;
  }
}

export function csrfInput(token: string): string {
  return `<input type="hidden" name="csrf" value="${token}">`;
}
