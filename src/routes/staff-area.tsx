/**
 * Staff/owner dashboard: today's trading position, orders, event & inventory
 * management, refunds and CSV exports. Every action re-checks the role
 * server-side; mutating actions additionally require an allow-listed Origin.
 */
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppConfig } from "../config.ts";
import { SESSION_COOKIE, getSessionUser, roleAllows, stateChangeOriginAllowed } from "../auth.ts";
import { queryAll, queryOne, run, tx } from "../db.ts";
import { formatMinor } from "../money.ts";
import { startRefund } from "../orders.ts";
import { Page } from "../views/layout.tsx";
import { newOrderRef as _n } from "../ids.ts";
void _n;

type SessionUser = NonNullable<ReturnType<typeof getSessionUser>>;

function staff(c: import("hono").Context, config: AppConfig, cap: "manage" | "reports" | "scan" | "admin"): SessionUser | null {
  if (!stateChangeOriginAllowed(c, config.publicOrigins) && c.req.method !== "GET") return null;
  const u = getSessionUser(getCookie(c, SESSION_COOKIE));
  return u && roleAllows(u.role, cap) ? u : null;
}

export function staffAreaRoutes(config: AppConfig): Hono {
  const app = new Hono();

  app.get("/staff", (c) => {
    const u = staff(c, config, "reports");
    if (!u) return c.redirect("/staff/login?next=/staff");
    const totalPaid = num(queryOne("SELECT COUNT(*) n FROM orders WHERE lifecycle IN ('paid','ticket_issued')")!.n);
    const ticketsSold = num(queryOne("SELECT COALESCE(SUM(total_minor),0) s FROM orders WHERE lifecycle IN ('paid','ticket_issued')")!.s);
    const today = num(queryOne("SELECT COUNT(*) n FROM orders WHERE DATE(created_at)=DATE('now') AND lifecycle IN ('paid','ticket_issued')")!.n);
    const pending = num(queryOne("SELECT COUNT(*) n FROM orders WHERE lifecycle IN ('pending_payment','payment_failed')")!.n);
    const exceptions = num(queryOne("SELECT COUNT(*) n FROM reconcile_exceptions WHERE resolved=0")!.n);
    const byEvent = queryAll(
      `SELECT e.title, COUNT(o.id) orders, COALESCE(SUM(o.total_minor),0) gross,
              COALESCE(SUM(o.mnm_minor),0) mnm, COALESCE(SUM(o.ad_minor),0) ad
         FROM orders o JOIN events e ON e.id=o.event_id
        WHERE o.lifecycle IN ('paid','ticket_issued')
        GROUP BY e.id ORDER BY gross DESC`,
    ) as { title: string; orders: number; gross: number; mnm: number; ad: number }[];
    return c.html(
      <Page title="Staff dashboard" active="/staff">
        <h1>MnM Trading Dashboard</h1>
        <p class="muted">Signed in as <strong>{u.fullName}</strong> ({u.role}).</p>
        <div class="stat-grid">
          <div class="stat"><div class="v">{totalPaid}</div><div class="k">paid orders (all time)</div></div>
          <div class="stat"><div class="v">KSh {(ticketsSold / 100).toLocaleString("en-KE")}</div><div class="k">customer revenue</div></div>
          <div class="stat"><div class="v">{today}</div><div class="k">paid today</div></div>
          <div class="stat"><div class="v">{pending}</div><div class="k">pending / failed</div></div>
          <div class="stat"><div class="v">{exceptions}</div><div class="k">reconcile open</div></div>
        </div>
        <h2>Sales by event</h2>
        <div class="panel">
          <table>
            <thead><tr><th>Event</th><th>Orders</th><th>Gross</th><th>MnM commission</th><th>AD platform fee</th></tr></thead>
            <tbody>
              {byEvent.length === 0 ? <tr><td colSpan={5} class="muted">No paid orders yet.</td></tr> : byEvent.map((e) => (
                <tr>
                  <td>{e.title}</td><td>{e.orders}</td>
                  <td>{formatMinor(Number(e.gross), "KES")}</td>
                  <td>{formatMinor(Number(e.mnm), "KES")}</td>
                  <td>{formatMinor(Number(e.ad), "KES")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div class="actions-row">
          <a class="btn btn-secondary" href="/staff/orders">Orders</a>
          <a class="btn btn-secondary" href="/staff/events">Events &amp; inventory</a>
          <a class="btn btn-secondary" href="/staff/scan">Scan tickets</a>
          {roleAllows(u.role, "admin") ? <a class="btn btn-ghost" href="/admin">AD platform console</a> : null}
        </div>
      </Page>,
    );
  });

  app.get("/staff/orders", (c) => {
    const u = staff(c, config, "reports");
    if (!u) return c.redirect("/staff/login?next=/staff/orders");
    const orders = queryAll(
      `SELECT o.order_ref, o.lifecycle, o.total_minor, o.currency, o.customer_name, o.customer_phone,
              o.created_at, o.mnm_minor, o.ad_minor, e.title event
         FROM orders o JOIN events e ON e.id = o.event_id
        ORDER BY o.id DESC LIMIT 200`,
    ) as Record<string, unknown>[];
    return c.html(
      <Page title="Orders">
        <h1>Orders</h1>
        <div class="panel">
          <table>
            <thead><tr><th>Ref</th><th>Customer</th><th>Event</th><th>Total</th><th>MnM</th><th>AD</th><th>Status</th><th>Placed</th><th></th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr>
                  <td>{String(o.order_ref)}</td>
                  <td>{String(o.customer_name)}<br /><small class="muted">{String(o.customer_phone)}</small></td>
                  <td>{String(o.event)}</td>
                  <td>{formatMinor(Number(o.total_minor), String(o.currency))}</td>
                  <td>{formatMinor(Number(o.mnm_minor), String(o.currency))}</td>
                  <td>{formatMinor(Number(o.ad_minor), String(o.currency))}</td>
                  <td><span class={String(o.lifecycle) === "ticket_issued" ? "tag ok" : String(o.lifecycle) === "refunded" ? "tag danger" : "tag warn"}>{String(o.lifecycle)}</span></td>
                  <td>{new Date(String(o.created_at)).toLocaleString("en-KE", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td>
                    {(String(o.lifecycle) === "paid" || String(o.lifecycle) === "ticket_issued") && roleAllows(u.role, "manage") ? (
                      <form method="post" action="/staff/orders/refund" style="display:inline">
                        <input type="hidden" name="order_ref" value={String(o.order_ref)} />
                        <button class="btn btn-danger btn-sm" type="submit">Refund…</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <a class="btn btn-ghost" href="/staff/orders.csv">Export CSV</a>
      </Page>,
    );
  });

  app.post("/staff/orders/refund", async (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.text("Forbidden", 403);
    const body = await c.req.parseBody();
    const ok = startRefund(String(body.order_ref ?? ""), u.id);
    return c.redirect("/staff/orders");
    void ok;
  });

  app.get("/staff/orders.csv", (c) => {
    const u = staff(c, config, "reports");
    if (!u) return c.text("Forbidden", 403);
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="mnm-orders.csv"');
    const rows = queryAll(
      `SELECT o.order_ref, o.lifecycle, e.title event, o.customer_name, o.customer_phone,
              o.original_minor, o.mnm_minor, o.ad_minor, o.total_minor, o.currency, o.created_at
         FROM orders o JOIN events e ON e.id=o.event_id ORDER BY o.id DESC`,
    );
    const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const lines = ["order_ref,status,event,customer,phone,original_minor,mnm_minor,ad_minor,total_minor,currency,created_at"];
    for (const r of rows) {
      lines.push([r.order_ref, r.lifecycle, r.event, r.customer_name, r.customer_phone, r.original_minor, r.mnm_minor, r.ad_minor, r.total_minor, r.currency, r.created_at].map(esc).join(","));
    }
    return c.body(lines.join("\n"));
  });

  // ---------- events & inventory ----------
  app.get("/staff/events", (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.redirect("/staff/login?next=/staff/events");
    const events = queryAll("SELECT * FROM events ORDER BY id DESC") as Record<string, unknown>[];
    return c.html(
      <Page title="Events & inventory">
        <h1>Events &amp; inventory</h1>
        <div class="panel">
          <h3>Create event (draft)</h3>
          <form method="post" action="/staff/events">
            <div class="form-row">
              <div class="field"><label>Title</label><input name="title" required /></div>
              <div class="field"><label>Slug</label><input name="slug" required pattern="[a-z0-9-]+" /></div>
            </div>
            <div class="form-row">
              <div class="field"><label>Venue</label><input name="venue_name" required /></div>
              <div class="field"><label>Area</label><input name="venue_area" value="Limuru, Kiambu" /></div>
            </div>
            <div class="form-row">
              <div class="field"><label>Starts at (ISO)</label><input name="starts_at" type="datetime-local" required /></div>
              <div class="field"><label>Sale ends (ISO)</label><input name="sale_ends_at" type="datetime-local" /></div>
            </div>
            <div class="form-row">
              <div class="field"><label>Organiser</label><input name="organizer_name" required /></div>
              <div class="field"><label>Organiser contact</label><input name="organizer_contact" required /></div>
            </div>
            <div class="field"><label>Authorisation reference (organiser permission evidence)</label><input name="authorization_ref" placeholder="e.g. contract no / email ref" /></div>
            <div class="field"><label>Description</label><textarea name="description" rows={2} /></div>
            <button class="btn btn-primary" type="submit">Create draft</button>
          </form>
        </div>
        {events.map((e) => {
          const cats = queryAll(
            `SELECT id, name, original_price, quantity, sold_count,
                    quantity - sold_count - COALESCE((SELECT SUM(qty) FROM reservations r WHERE r.category_id=tc.id AND r.status='active' AND r.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')),0) avail
               FROM ticket_categories tc WHERE event_id=?`, [num(e.id)]) as Record<string, number>[];
          return (
            <div class="panel">
              <h3>{String(e.title)} <span class="tag">{String(e.status)}</span></h3>
              <dl class="kv">
                <dt>Venue</dt><dd>{String(e.venue_name)}, {String(e.venue_area)}</dd>
                <dt>Starts</dt><dd>{new Date(String(e.starts_at)).toLocaleString("en-KE")}</dd>
                <dt>Organiser</dt><dd>{String(e.organizer_name)} ({String(e.organizer_contact)})</dd>
                <dt>Authority</dt><dd>{e.authorization_ref ? String(e.authorization_ref) : <em class="muted">not recorded</em>}</dd>
              </dl>
              <table>
                <thead><tr><th>Category</th><th>Original</th><th>Selling price</th><th>Qty</th><th>Sold</th><th>Available now</th><th>Add stock</th></tr></thead>
                <tbody>
                  {cats.map((cat) => (
                    <tr>
                      <td>{String(cat.name)}</td>
                      <td>{formatMinor(Number(cat.original_price), "KES")}</td>
                      <td>{formatMinor(Number(cat.original_price) + Math.round(Number(cat.original_price) * 0.35), "KES")}</td>
                      <td>{cat.quantity}</td>
                      <td>{cat.sold_count}</td>
                      <td>{cat.avail}</td>
                      <td>
                        <form method="post" action="/staff/events/restock" style="display:flex;gap:6px">
                          <input type="hidden" name="category_id" value={String(cat.id)} />
                          <input name="qty" type="number" min="1" max="500" style="width:80px" required />
                          <button class="btn btn-sm btn-secondary" type="submit">Add</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div class="actions-row" style="margin-top:10px">
                {e.status === "draft" ? (
                  <form method="post" action="/staff/events/publish" style="display:inline">
                    <input type="hidden" name="id" value={String(e.id)} />
                    <button class="btn btn-sm btn-primary" type="submit">Publish</button>
                  </form>
                ) : null}
                {e.status === "on_sale" ? (
                  <form method="post" action="/staff/events/pause" style="display:inline">
                    <input type="hidden" name="id" value={String(e.id)} />
                    <button class="btn btn-sm btn-ghost" type="submit">Pause sales</button>
                  </form>
                ) : null}
                {(e.status === "on_sale" || e.status === "paused") ? (
                  <form method="post" action="/staff/events/cancel" style="display:inline">
                    <input type="hidden" name="id" value={String(e.id)} />
                    <button class="btn btn-sm btn-danger" type="submit">Cancel event</button>
                  </form>
                ) : null}
                <a class="btn btn-sm btn-ghost" href={`/staff/events/${e.id}/ticket`}>Add ticket category</a>
              </div>
            </div>
          );
        })}
      </Page>,
    );
  });

  app.post("/staff/events", async (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.text("Forbidden", 403);
    const b = await c.req.parseBody() as Record<string, string>;
    run(
      `INSERT INTO events(slug,title,description,venue_name,venue_area,starts_at,organizer_name,organizer_contact,authorization_ref,sale_ends_at,status,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'draft', ?)`,
      [b.slug ?? "", b.title ?? "", b.description ?? "", b.venue_name ?? "", b.venue_area ?? "", new Date(b.starts_at ?? Date.now()).toISOString(),
       b.organizer_name ?? "", b.organizer_contact ?? "", b.authorization_ref ?? "", b.sale_ends_at ? new Date(b.sale_ends_at).toISOString() : null, u.id],
    );
    run("INSERT INTO audit_log(actor_user,action,entity,entity_id,detail) VALUES (?,?,?,?,?)", [u.id, "event.create", "events", (b.slug ?? ""), "{}"]);
    return c.redirect("/staff/events");
  });

  app.post("/staff/events/publish", async (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.text("Forbidden", 403);
    const b = await c.req.parseBody();
    const id = Number(b.id);
    const ev = queryOne("SELECT authorization_ref FROM events WHERE id=?", [id]);
    if (!ev) return c.text("Not found", 404);
    if (!String(ev.authorization_ref).trim()) {
      return c.html(<Page title="Blocked"><div class="panel notice bad">Cannot publish: no organiser authorisation recorded. Authorised resale requires documented permission. <a href="/staff/events">Back</a></div></Page>, 400);
    }
    tx(() => {
      run("UPDATE events SET status='on_sale', authorized_by_user=?, authorized_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), sale_starts_at=COALESCE(sale_starts_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=? AND status='draft'", [u.id, id]);
      run("INSERT INTO audit_log(actor_user,action,entity,entity_id,detail) VALUES (?,?,?,?,?)", [u.id, "event.publish", "events", String(id), "{}"]);
    });
    return c.redirect("/staff/events");
  });

  for (const action of ["pause", "cancel"] as const) {
    app.post(`/staff/events/${action}`, async (c) => {
      const u = staff(c, config, "manage");
      if (!u) return c.text("Forbidden", 403);
      const b = await creqBody(c);
      const status = action === "pause" ? "paused" : "cancelled";
      run("UPDATE events SET status=? WHERE id=? AND status IN ('draft','on_sale','paused')", [status, Number(b.id)]);
      run("INSERT INTO audit_log(actor_user,action,entity,entity_id,detail) VALUES (?,?,?,?,?)", [u.id, `event.${action}`, "events", String(b.id), "{}"]);
      return c.redirect("/staff/events");
    });
  }

  app.post("/staff/events/restock", async (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.text("Forbidden", 403);
    const b = await creqBody(c);
    const qty = Math.max(0, Math.min(500, Number(b.qty) | 0));
    run("UPDATE ticket_categories SET quantity = quantity + ? WHERE id=?", [qty, Number(b.category_id)]);
    run("INSERT INTO audit_log(actor_user,action,entity,entity_id,detail) VALUES (?,?,?,?,?)", [u.id, "inventory.restock", "ticket_categories", String(b.category_id), JSON.stringify({ qty })]);
    return c.redirect("/staff/events");
  });

  app.get("/staff/events/:id/ticket", (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.redirect("/staff/login");
    const id = Number(c.req.param("id"));
    const ev = queryOne("SELECT title FROM events WHERE id=?", [id]);
    if (!ev) return c.text("Not found", 404);
    return c.html(
      <Page title="Add ticket category">
        <div class="narrow">
          <div class="panel">
            <h1>Add ticket category</h1>
            <p class="muted">{String(ev.title)} — the original price is set by the organiser; the customer price adds the agreed 35% automatically.</p>
            <form method="post" action="/staff/events/ticket">
              <input type="hidden" name="event_id" value={String(id)} />
              <div class="form-row">
                <div class="field"><label>Name</label><input name="name" required /></div>
                <div class="field"><label>Original price (KES)</label><input name="price_kes" type="number" min="0" step="0.01" required /></div>
              </div>
              <div class="form-row">
                <div class="field"><label>Quantity</label><input name="quantity" type="number" min="1" max="2000" required /></div>
                <div class="field"><label>Description (optional)</label><input name="description" /></div>
              </div>
              <button class="btn btn-primary" type="submit">Add category</button>
            </form>
          </div>
        </div>
      </Page>,
    );
  });

  app.post("/staff/events/ticket", async (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.text("Forbidden", 403);
    const b = await creqBody(c);
    run("INSERT INTO ticket_categories(event_id,name,original_price,quantity,description) VALUES (?,?,?,?,?)",
      [Number(b.event_id), (b.name ?? ""), Math.round(Number(b.price_kes) * 100), Math.max(1, Number(b.quantity) | 0), b.description ?? ""]);
    run("INSERT INTO audit_log(actor_user,action,entity,entity_id,detail) VALUES (?,?,?,?,?)", [u.id, "category.create", "ticket_categories", String(b.event_id), JSON.stringify({ name: b.name })]);
    return c.redirect("/staff/events");
  });

  return app;
}

async function creqBody(c: import("hono").Context): Promise<Record<string, string>> {
  const b = await c.req.parseBody();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(b)) out[k] = typeof v === "string" ? v : "";
  return out;
}

function num(v: unknown): number { return Number(v); }
