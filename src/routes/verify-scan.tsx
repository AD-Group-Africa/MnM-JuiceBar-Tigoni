/**
 * Verification endpoints.
 * GET  /verify/:code — public read-only status (used by QR codes; rate-limited);
 *                      returns what a street-checker needs without revealing PII.
 * POST /staff/scan   — scanner-role staff endpoint that REDEEMS tickets (audited).
 */
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppConfig } from "../config.ts";
import { SESSION_COOKIE, getSessionUser, roleAllows, stateChangeOriginAllowed } from "../auth.ts";
import { verifyTicket, redeemTicket } from "../tickets.ts";
import { queryAll } from "../db.ts";
import { Page, StaffPage } from "../views/layout.tsx";

const verifyHits = new Map<string, { n: number; resetAt: number }>();
function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const e = verifyHits.get(key);
  if (!e || e.resetAt < now) { verifyHits.set(key, { n: 1, resetAt: now + windowMs }); return false; }
  e.n++;
  return e.n > max;
}

export function verifyScanRoutes(_config: AppConfig): Hono {
  const app = new Hono();

  // Public, read-only check (what the QR links to). No redemption here.
  app.get("/verify/:code", (c) => {
    const code = c.req.param("code").toUpperCase();
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    if (rateLimit(ip, 30, 60_000)) return c.json({ error: "Too many checks; slow down.", code: "rate_limited" }, 429);
    const v = verifyTicket(code);
    return c.json({
      valid: v.ok,
      outcome: v.outcome,
      message: v.detail,
      event: v.event ? { title: v.event.title, starts_at: v.event.starts_at, venue: v.event.venue_name } : null,
    }, v.httpStatus as ContentfulStatusCode);
  });

  // HTML fallback page (scanning staff with a phone camera lands here via QR? no —
  // QR encodes /verify; staff console uses POST). Provides human-readable status.
  app.get("/verify/:code/view", (c) => {
    const v = verifyTicket(c.req.param("code").toUpperCase());
    return c.html(
      <Page title="Ticket check">
        <div class="narrow scan-result">
          <div class="panel">
            <div class={`big-status ${v.ok ? "ok" : "bad"}`}>{v.ok ? "VALID TICKET" : "DO NOT ADMIT"}</div>
            <p>{v.detail}</p>
            {v.event && <dl class="kv"><dt>Event</dt><dd>{v.event.title}</dd><dt>Starts</dt><dd>{new Date(v.event.starts_at).toLocaleString("en-KE")}</dd></dl>}
            <p class="hint">Redemption happens in the staff scanning console only. This page is informational.</p>
          </div>
        </div>
      </Page>,
    );
  });

  return app;
}

// ---------- staff scanning console ----------

export function scanRoutes(config: AppConfig): Hono {
  const app = new Hono();

  const requireScanner = (c: { req: { header(k: string): string | undefined; cookie?: unknown }; raw?: unknown }) => {
    // plain helper using hono context below instead
  };
  void requireScanner;

  app.get("/staff/scan", (c) => {
    const user = getSessionUser(getCookie(c, SESSION_COOKIE));
    if (!user || !roleAllows(user.role, "scan")) return c.redirect("/staff/login?next=/staff/scan");
    return c.html(
      <StaffPage title="Scan tickets" active="/staff/scan">
        <h1>Scan a ticket</h1>
        <p class="muted">Enter or type the ticket code printed under the QR. Redemption is verified live, once, and audited.</p>
        <div class="narrow">
          <div class="panel">
            <form method="post" action="/staff/scan">
              <div class="field">
                <label for="code">Ticket code</label>
                <input id="code" name="code" required autocomplete="off" placeholder="e.g. 8K3F92-QW1XCD" style="text-transform:uppercase" />
              </div>
              <button class="btn btn-primary btn-block" type="submit">Verify &amp; redeem</button>
            </form>
          </div>
          <div class="panel">
            <h3>Your recent scans</h3>
            {scanTable(recentScans(user.id))}
          </div>
        </div>
      </StaffPage>,
    );
  });

  app.post("/staff/scan", async (c) => {
    if (!stateChangeOriginAllowed(c, config.publicOrigins)) return c.text("Invalid origin", 403);
    const user = getSessionUser(getCookie(c, SESSION_COOKIE));
    if (!user || !roleAllows(user.role, "scan")) return c.text("Forbidden", 403);
    {
      const body = await c.req.parseBody();
      const raw = String(body.code ?? "").trim().toUpperCase();
      const r = redeemTicket(raw, user.id);
      return c.html(
        <StaffPage title="Scan result" active="/staff/scan">
          <div class="narrow scan-result">
            <div class={`panel ${r.result.ok ? "notice ok" : "notice bad"}`} style={r.result.ok ? "background:var(--ok-soft)" : "background:var(--danger-soft)"}>
              <div class={`big-status ${r.result.ok ? "ok" : "bad"}`}>{r.result.ok ? "ADMIT" : "DO NOT ADMIT"}</div>
              <p>{r.result.detail}</p>
              {r.result.event && <dl class="kv"><dt>Event</dt><dd>{r.result.event.title}</dd><dt>Venue</dt><dd>{r.result.event.venue_name}</dd><dt>Starts</dt><dd>{new Date(r.result.event.starts_at).toLocaleString("en-KE")}</dd></dl>}
              <p class="hint">Scan #{r.scanId} recorded in the audit log.</p>
            </div>
            <p style="margin-top:14px"><a class="btn btn-primary" href="/staff/scan">Scan next ticket</a></p>
          </div>
        </StaffPage>,
      );
    }
  });

  return app;
}

function recentScans(scannerId: number): Record<string, unknown>[] {
  return queryAll(
    "SELECT ticket_code, result, reason, created_at FROM scan_log WHERE scanner_id=? ORDER BY id DESC LIMIT 10",
    [scannerId],
  );
}

function scanTable(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return <p class="hint">No scans yet.</p>;
  return (
    <table>
      <thead><tr><th>Code</th><th>Result</th><th>Reason</th><th>Time</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr>
            <td>{String(r.ticket_code)}</td>
            <td>{r.result === "accepted" ? <span class="tag ok">accepted</span> : <span class="tag danger">{String(r.result)}</span>}</td>
            <td>{r.reason ? String(r.reason) : "—"}</td>
            <td>{new Date(String(r.created_at)).toLocaleTimeString("en-KE")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
