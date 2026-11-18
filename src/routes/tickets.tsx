/**
 * Guest ticket pages. Access only via HMAC-signed link (no account needed):
 *   /t/<signed-payload>            → tickets for one order
 * Every QR encodes the ONLINE verification URL for the ticket code —
 * verification is server-side; the QR carries no personal data or secrets.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppConfig } from "../config.ts";
import { queryAll, queryOne } from "../db.ts";
import { guestLinkRef, checkGuestAccess } from "../orders.ts";
import { verifyPayload } from "../auth.ts";
import { formatMinor } from "../money.ts";
import { qrSvgDataUri } from "../qr.ts";
import { Page } from "../views/layout.tsx";

export function ticketRoutes(config: AppConfig): Hono {
  const app = new Hono();

  app.get("/t/:token", (c) => {
    const ref = guestLinkRef(c.req.param("token"), config.appSecretKey);
    if (!ref) return ticketDeny(c);
    const order = queryOne("SELECT * FROM orders WHERE order_ref=?", [ref]);
    if (!order) return ticketDeny(c);
    return c.html(ticketsPage(order, config));
  });

  // Reassurance/order lookup page for guests who still have the raw token.
  app.get("/order/:ref", (c) => {
    const ref = c.req.param("ref");
    const token = c.req.query("t") ?? "";
    if (!checkGuestAccess(ref, token)) return ticketDeny(c);
    const order = queryOne("SELECT * FROM orders WHERE order_ref=?", [ref]);
    if (!order) return ticketDeny(c);
    return c.html(ticketsPage(order, config));
  });

  return app;
}

function ticketDeny(c: Context): Response | Promise<Response> {
  return c.html(
    <Page title="Tickets">
      <div class="narrow">
        <div class="panel">
          <h1>Ticket link not recognised</h1>
          <p class="muted">Use the exact link from your confirmation, or call +254 705 687 273 with your order reference (e.g. MNM-ABC123) and we'll re-send it.</p>
          <p><a class="btn btn-secondary" href="/events">Back to events</a></p>
        </div>
      </div>
    </Page>,
    404,
  );
}

function ticketsPage(order: Record<string, unknown>, config: AppConfig) {
  const ref = String(order.order_ref);
  const ev = queryOne("SELECT title, venue_name, venue_area, starts_at, organizer_name FROM events WHERE id=?", [Number(order.event_id)])!;
  const items = queryAll(
    `SELECT oi.id, oi.qty, oi.unit_selling, tc.name FROM order_items oi JOIN ticket_categories tc ON tc.id=oi.category_id WHERE oi.order_id=?`,
    [Number(order.id)],
  );
  const tickets = queryAll("SELECT * FROM tickets WHERE order_id=? ORDER BY id", [Number(order.id)]);
  const sum = items.reduce((acc, i) => acc + Number(i.qty), 0);
  const starts = new Date(String(ev.starts_at));

  return (
    <Page title={`Tickets ${ref}`} active="/events">
      <div class="page-head">
        <p class="kicker">MnM Tickets · Order {ref}</p>
        <h1>Your tickets.</h1>
        <p class="lead">
          {String(ev.title)} · {starts.toLocaleString("en-KE", { dateStyle: "full", timeStyle: "short" })} ·{" "}
          {String(ev.venue_name)}, {String(ev.venue_area)}
        </p>
        <p class="muted small">
          {sum} ticket{sum === 1 ? "" : "s"} · {formatMinor(Number(order.total_minor), String(order.currency))} · Organised by {String(ev.organizer_name)}
        </p>
      </div>

      {config.paymentProvider === "dev" ? (
        <p class="notice warn" role="status">
          <strong>Development payment simulator — no real money moved.</strong>{" "}
          These tickets were issued by the local simulator, not by live M-Pesa.
        </p>
      ) : null}

      <div class="actions-row">
        <a class="btn btn-ghost btn-sm" href="/events">← All events</a>
        <a class="btn btn-ghost btn-sm" href="tel:+254705687273">Need help? Call the bar</a>
      </div>

      <div class="ticket-grid" style="display:grid;gap:22px;grid-template-columns:1fr;justify-items:center">
        {tickets.map((t, i) => {
          const status = String(t.status);
          const verifyUrl = `${config.publicOrigins[0] ?? ""}/verify/${String(t.ticket_code)}`;
          const tier = items.find((x) => Number(x.id) === Number(t.order_item_id))?.name ?? "Ticket";
          return (
            <div class={`ticket state-${status}`}>
              <div class="head">
                <div class="t">{String(ev.title)}</div>
                <div class="s">{String(tier)} · Ticket {i + 1} of {tickets.length} · {ref}</div>
              </div>
              <div class="qr">
                <img src={qrSvgDataUri(verifyUrl)} alt={`QR code for ticket ${String(t.ticket_code)}`} width="196" height="196" />
                <div class="code">{String(t.ticket_code)}</div>
                <small class="muted">Show this at the gate · valid once</small>
              </div>
              <div class="meta">
                <span class={status === "valid" ? "tag ok" : status === "redeemed" ? "tag" : "tag danger"}>{status}</span>
                <span>{starts.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}</span>
              </div>
              <div class="stub-row">
                <span>{String(ev.venue_name)}</span>
                <span>Doors open before the start time</span>
              </div>
              {status !== "valid" ? (
                <p class="hint" style="padding:0 24px 18px">
                  This ticket was {status} at {String(t.redeemed_at ?? "issue time")}. Contact the bar if this looks wrong.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <section class="panel" style="margin-top:28px">
        <h3>Admission instructions</h3>
        <ul class="hint" style="line-height:1.9;padding-left:18px">
          <li>Arrive with this page open, or a clear screenshot of each QR code.</li>
          <li>Staff scan the QR once at the gate. A second scan of the same ticket is refused.</li>
          <li>Each ticket admits one person. Do not share the QR publicly.</li>
          <li>Tickets are tied to this order. If your phone dies, staff can look up the code above.</li>
        </ul>
        <p class="hint">Questions? WhatsApp or call +254 705 687 273 (MnM Juice Bar, Tigoni).</p>
      </section>
    </Page>
  );
}

export { verifyPayload };
