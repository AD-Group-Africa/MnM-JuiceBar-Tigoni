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
import { queryOne } from "../db.ts";
import {
  SESSION_COOKIE, clearSessionCookie, createSession, destroySession, getSessionUser,
  hashPassword, newSessionToken, roleAllows, setSessionCookie, stateChangeOriginAllowed,
  verifyPassword, type Capability, type SessionUser,
} from "../auth.ts";
import { newCsrfToken } from "../ids.ts";
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
      <Page title="Staff sign-in">
        <div class="narrow">
          <div class="panel">
            <h1>Staff sign-in</h1>
            <p class="muted">For MnM Juice Bar staff, gate scanners and Afrika Digitalis administrators.</p>
            {c.req.query("next") ? null : null}
            <form method="post" action="/staff/login">
              <input type="hidden" name="next" value={c.req.query("next") ?? "/staff"} />
              <div class="field">
                <label for="phone">Staff phone</label>
                <input id="phone" name="phone" type="tel" required autocomplete="tel" placeholder="+2547…" />
              </div>
              <div class="field">
                <label for="password">Password</label>
                <input id="password" name="password" type="password" required autocomplete="current-password" />
              </div>
              <button class="btn btn-primary btn-block" type="submit">Sign in</button>
            </form>
          </div>
        </div>
      </Page>,
    ));

  app.post("/staff/login", async (c) => {
    if (!stateChangeOriginAllowed(c, config.publicOrigins)) {
      return c.html(<Page title="Blocked"><div class="panel notice bad">Invalid request origin.</div></Page>, 403);
    }
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const form = await c.req.parseBody();
    const phone = String(form.phone ?? "").trim();
    const password = String(form.password ?? "");
    const next = String(form.next ?? "/staff");

    if (rateLimited(ip, phone)) {
      return c.html(<Page title="Too many attempts"><div class="panel notice bad">Too many sign-in attempts. Try again in a few minutes.</div></Page>, 429);
    }
    const user = queryOne("SELECT id, full_name, role, password_hash, is_active FROM users WHERE phone = ?", [phone]);
    const ok = !!user && Number(user.is_active) === 1 && await verifyPassword(password, String(user.password_hash));
    if (!ok) {
      recordFail(ip, phone);
      // Burn a constant amount of work to blunt timing/enum differences.
      await fixedHash("spare-work");
      return c.html(<Page title="Sign-in failed"><div class="narrow"><div class="panel notice bad">Wrong phone or password.</div></div></Page>, 401);
    }
    successClear(ip, phone);
    const token = newSessionToken();
    createSession(Number(user!.id), ip, token);
    setSessionCookie(c, token, config);
    if (!safeNext(next)) return c.redirect("/staff");
    return c.redirect(next);
    function safeNext(n: string): boolean {
      return n.startsWith("/") && !n.startsWith("//");
    }
  });

  app.post("/staff/logout", (c) => {
    if (!stateChangeOriginAllowed(c, config.publicOrigins)) return c.text("", 403);
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
