/**
 * Afrika Digitalis platform administration console.
 * Restricted to ad_admin. Shows platform health, cross-event operational totals,
 * open reconciliation exceptions and the sensitive-action audit trail.
 * Customer PII is NOT exposed here beyond what operations requires.
 */
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { AppConfig } from "../config.ts";
import { SESSION_COOKIE, getSessionUser, roleAllows } from "../auth.ts";
import { queryAll, queryOne } from "../db.ts";
import { formatMinor } from "../money.ts";
import { Page } from "../views/layout.tsx";

export function adminRoutes(_config: AppConfig): Hono {
  const app = new Hono();

  app.get("/admin", (c) => {
    const u = getSessionUser(getCookie(c, SESSION_COOKIE));
    if (!u || !roleAllows(u.role, "admin")) return c.redirect("/staff/login?next=/admin");
    const gross = num(queryOne("SELECT COALESCE(SUM(total_minor),0) s FROM orders WHERE lifecycle IN ('paid','ticket_issued')")!.s);
    const adEarn = num(queryOne("SELECT COALESCE(SUM(ad_minor),0) s FROM orders WHERE lifecycle IN ('paid','ticket_issued')")!.s);
    const mnmEarn = num(queryOne("SELECT COALESCE(SUM(mnm_minor),0) s FROM orders WHERE lifecycle IN ('paid','ticket_issued')")!.s);
    const users = num(queryOne("SELECT COUNT(*) n FROM users")!.n);
    const ticketsValid = num(queryOne("SELECT COUNT(*) n FROM tickets WHERE status='valid'")!.n);
    const ticketsRedeemed = num(queryOne("SELECT COUNT(*) n FROM tickets WHERE status='redeemed'")!.n);
    const exceptions = queryAll(
      `SELECT x.id, x.reason, x.created_at, o.order_ref, o.total_minor, o.currency
         FROM reconcile_exceptions x JOIN orders o ON o.id=x.order_id
        WHERE x.resolved=0 ORDER BY x.id DESC LIMIT 50`,
    ) as Record<string, unknown>[];
    const audit = queryAll(
      `SELECT a.action, a.entity, a.entity_id, a.created_at, u.full_name
         FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user
        ORDER BY a.id DESC LIMIT 50`,
    ) as Record<string, unknown>[];
    const events = queryAll("SELECT title, status, starts_at, organizer_name FROM events ORDER BY id DESC LIMIT 50") as Record<string, unknown>[];
    return c.html(
      <Page title="AD platform console" active="/admin">
        <h1>Afrika Digitalis — platform console</h1>
        <p class="muted">Restricted to AD administrators. Operational data only; personal data minimised.</p>
        <div class="stat-grid">
          <div class="stat"><div class="v">{formatMinor(gross, "KES")}</div><div class="k">gross customer revenue</div></div>
          <div class="stat"><div class="v">{formatMinor(adEarn, "KES")}</div><div class="k">AD platform fees</div></div>
          <div class="stat"><div class="v">{formatMinor(mnmEarn, "KES")}</div><div class="k">MnM commissions</div></div>
          <div class="stat"><div class="v">{ticketsValid} / {ticketsRedeemed}</div><div class="k">tickets valid / redeemed</div></div>
          <div class="stat"><div class="v">{users}</div><div class="k">staff accounts</div></div>
        </div>

        <h2>Events overview</h2>
        <div class="panel">
          <table>
            <thead><tr><th>Event</th><th>Status</th><th>Starts</th><th>Organiser</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr><td>{String(e.title)}</td><td><span class="tag">{String(e.status)}</span></td><td>{new Date(String(e.starts_at)).toLocaleString("en-KE", { dateStyle: "short", timeStyle: "short" })}</td><td>{String(e.organizer_name)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2>Open reconciliation exceptions</h2>
        <div class="panel">
          {exceptions.length === 0 ? <p class="hint">None — all confirmed payments matched an order.</p> : (
            <table>
              <thead><tr><th>#</th><th>Order</th><th>Amount</th><th>Reason</th><th>Raised</th></tr></thead>
              <tbody>
                {exceptions.map((x) => (
                  <tr><td>{num(x.id)}</td><td>{String(x.order_ref)}</td><td>{formatMinor(Number(x.total_minor), String(x.currency))}</td><td>{String(x.reason)}</td><td>{new Date(String(x.created_at)).toLocaleString("en-KE")}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <h2>Audit trail (recent)</h2>
        <div class="panel">
          <table>
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th></tr></thead>
            <tbody>
              {audit.map((a) => (
                <tr><td>{new Date(String(a.created_at)).toLocaleString("en-KE")}</td><td>{String(a.full_name ?? "–")}</td><td><span class="badge-mono">{String(a.action)}</span></td><td>{String(a.entity)}#{String(a.entity_id ?? "")}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Page>,
    );
  });

  return app;
}

function num(v: unknown): number { return Number(v); }
