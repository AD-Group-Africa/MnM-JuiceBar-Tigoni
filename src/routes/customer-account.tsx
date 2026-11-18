/** Optional customer account: phone + password, server-side session, order history. */
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { AppConfig } from "../config.ts";
import { stateChangeOriginAllowed } from "../auth.ts";
import { formatMinor } from "../money.ts";
import {
  CUSTOMER_COOKIE,
  authenticateCustomer,
  clearCustomerCookie,
  createCustomerSession,
  destroyCustomerSession,
  getCustomerBySession,
  juiceOrderHistory,
  registerCustomer,
  setCustomerCookie,
  ticketOrderHistory,
} from "../customers.ts";
import { Page } from "../views/layout.tsx";
import { queryOne } from "../db.ts";
import { issueJuiceOrderToken } from "../juice.ts";
import { issueGuestToken } from "../orders.ts";
import { rateLimit } from "../ratelimit.ts";
import { recordAudit } from "../audit.ts";

export function customerAccountRoutes(config: AppConfig): Hono {
  const app = new Hono();

  const current = (c: import("hono").Context) => getCustomerBySession(getCookie(c, CUSTOMER_COOKIE));

  app.get("/account", (c) => {
    const customer = current(c);
    if (!customer) return c.redirect("/account/login");
    const juice = juiceOrderHistory(customer.id);
    const tickets = ticketOrderHistory(customer.id);
    return c.html(
      <Page title="Your account">
        <div class="panel">
          <h1>Your account</h1>
          <p class="muted">Signed in as {customer.fullName} · {customer.phone}</p>
          <form method="post" action="/account/logout" style="display:inline">
            <button class="btn btn-ghost btn-sm" type="submit">Sign out</button>
          </form>
        </div>
        <div class="panel">
          <h2>Juice orders</h2>
          {juice.length === 0 ? <p class="muted">No signed-in juice orders yet. Guest orders still use their private link.</p> : (
            <table>
              <thead><tr><th>Reference</th><th>Status</th><th>Type</th><th>Total</th><th>Placed</th><th></th></tr></thead>
              <tbody>
                {juice.map((o) => (
                  <tr>
                    <td>{String(o.order_ref)}</td>
                    <td>{String(o.status)}</td>
                    <td>{String(o.type)}</td>
                    <td>{formatMinor(Number(o.total_minor), String(o.currency))}</td>
                    <td>{new Date(String(o.created_at)).toLocaleDateString("en-KE")}</td>
                    <td><a class="btn btn-sm btn-ghost" href={`/account/orders/juice/${encodeURIComponent(String(o.order_ref))}`}>Open</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div class="panel">
          <h2>Ticket orders</h2>
          {tickets.length === 0 ? <p class="muted">No signed-in ticket orders yet.</p> : (
            <table>
              <thead><tr><th>Reference</th><th>Event</th><th>Status</th><th>Total</th><th>Placed</th><th></th></tr></thead>
              <tbody>
                {tickets.map((o) => (
                  <tr>
                    <td>{String(o.order_ref)}</td>
                    <td>{String(o.event)}</td>
                    <td>{String(o.lifecycle)}</td>
                    <td>{formatMinor(Number(o.total_minor), String(o.currency))}</td>
                    <td>{new Date(String(o.created_at)).toLocaleDateString("en-KE")}</td>
                    <td><a class="btn btn-sm btn-ghost" href={`/account/orders/ticket/${encodeURIComponent(String(o.order_ref))}`}>Open</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p class="muted small">Opening an order still requires its private link or reference + checkout phone. Signing in does not expose another person's order.</p>
        </div>
      </Page>,
    );
  });

  app.get("/account/orders/juice/:ref", (c) => {
    const customer = current(c);
    if (!customer) return c.redirect("/account/login");
    const ref = c.req.param("ref");
    const row = queryOne("SELECT id FROM juice_orders WHERE order_ref=? AND customer_id=?", [ref, customer.id]);
    if (!row) return c.text("Not found", 404);
    const token = issueJuiceOrderToken(Number(row.id));
    return c.redirect(`/juice/order/${encodeURIComponent(ref)}?t=${encodeURIComponent(token)}`);
  });

  app.get("/account/orders/ticket/:ref", (c) => {
    const customer = current(c);
    if (!customer) return c.redirect("/account/login");
    const ref = c.req.param("ref");
    const row = queryOne("SELECT id FROM orders WHERE order_ref=? AND customer_id=?", [ref, customer.id]);
    if (!row) return c.text("Not found", 404);
    const token = issueGuestToken(Number(row.id));
    return c.redirect(`/order/${encodeURIComponent(ref)}?t=${encodeURIComponent(token)}`);
  });

  app.get("/account/login", (c) => {
    if (current(c)) return c.redirect("/account");
    return c.html(
      <Page title="Sign in">
        <div class="narrow panel">
          <h1>Sign in</h1>
          <p class="muted">Use the phone number and password you registered. Guest checkout does not require an account.</p>
          <form method="post" action="/account/login">
            <div class="field"><label>Phone</label><input name="phone" inputmode="tel" autocomplete="tel" required /></div>
            <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required /></div>
            <button class="btn btn-primary" type="submit">Sign in</button>
          </form>
          <p class="small muted">New here? <a href="/account/register">Create an account</a>.</p>
        </div>
      </Page>,
    );
  });

  app.post("/account/login", rateLimit({ name: "customer-login", limit: 10, windowMs: 10 * 60_000 }), async (c) => {
    if (!stateChangeOriginAllowed(c, config.publicOrigins)) return c.text("Forbidden", 403);
    const b = await c.req.parseBody();
    const customer = await authenticateCustomer(String(b.phone ?? ""), String(b.password ?? ""));
    if (!customer) {
      return c.html(
        <Page title="Sign in">
          <div class="narrow panel">
            <h1>Sign in</h1>
            <p class="notice bad">Phone or password is incorrect.</p>
            <form method="post" action="/account/login">
              <div class="field"><label>Phone</label><input name="phone" value={String(b.phone ?? "")} required /></div>
              <div class="field"><label>Password</label><input name="password" type="password" required /></div>
              <button class="btn btn-primary" type="submit">Sign in</button>
            </form>
          </div>
        </Page>,
        401,
      );
    }
    const token = createCustomerSession(customer.id, c.req.header("x-forwarded-for") ?? "");
    setCustomerCookie(c, token, config);
    recordAudit({ action: "customer.login", entity: "customers", entityId: customer.id });
    return c.redirect("/account");
  });

  app.get("/account/register", (c) => {
    if (current(c)) return c.redirect("/account");
    return c.html(
      <Page title="Create account">
        <div class="narrow panel">
          <h1>Create account</h1>
          <p class="muted">Optional — you can still check out as a guest. An account keeps your signed-in orders in one place.</p>
          <form method="post" action="/account/register">
            <div class="field"><label>Full name</label><input name="full_name" autocomplete="name" required /></div>
            <div class="field"><label>Phone</label><input name="phone" inputmode="tel" autocomplete="tel" required /></div>
            <div class="field"><label>Password (8+ characters)</label><input name="password" type="password" minlength={8} autocomplete="new-password" required /></div>
            <button class="btn btn-primary" type="submit">Create account</button>
          </form>
        </div>
      </Page>,
    );
  });

  app.post("/account/register", rateLimit({ name: "customer-register", limit: 10, windowMs: 60 * 60_000 }), async (c) => {
    if (!stateChangeOriginAllowed(c, config.publicOrigins)) return c.text("Forbidden", 403);
    const b = await c.req.parseBody();
    const result = await registerCustomer({
      fullName: String(b.full_name ?? ""),
      phone: String(b.phone ?? ""),
      password: String(b.password ?? ""),
    });
    if (!result.ok) {
      return c.html(
        <Page title="Create account">
          <div class="narrow panel">
            <h1>Create account</h1>
            <p class="notice bad">{result.msg}</p>
            <form method="post" action="/account/register">
              <div class="field"><label>Full name</label><input name="full_name" value={String(b.full_name ?? "")} required /></div>
              <div class="field"><label>Phone</label><input name="phone" value={String(b.phone ?? "")} required /></div>
              <div class="field"><label>Password (8+ characters)</label><input name="password" type="password" minlength={8} required /></div>
              <button class="btn btn-primary" type="submit">Create account</button>
            </form>
          </div>
        </Page>,
        400,
      );
    }
    const token = createCustomerSession(result.customer.id, c.req.header("x-forwarded-for") ?? "");
    setCustomerCookie(c, token, config);
    return c.redirect("/account");
  });

  app.post("/account/logout", (c) => {
    if (!stateChangeOriginAllowed(c, config.publicOrigins)) return c.text("Forbidden", 403);
    destroyCustomerSession(getCookie(c, CUSTOMER_COOKIE));
    clearCustomerCookie(c, config);
    return c.redirect("/account/login");
  });

  return app;
}
