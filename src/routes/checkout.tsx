/**
 * Customer checkout + order/tickets status pages.
 * Flow: event page form → /checkout (create order + reservation, initiate payment)
 * → dev-sim callback → status page → /t/<signed> tickets page with QR.
 * With PAYMENT_PROVIDER=daraja this endpoint performs a genuine STK initiation
 * and awaits the provider callback — never trusts the redirect alone.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppConfig } from "../config.ts";
import { queryOne, queryAll } from "../db.ts";
import { createOrder, LIFECYCLE, normalisePhoneKenya, issueGuestToken, checkGuestAccess, signGuestLink } from "../orders.ts";
import { getProvider, recordInitiated, handleCallback } from "../payments/index.ts";
import { formatMinor } from "../money.ts";
import { signPayload } from "../auth.ts";
import { Page } from "../views/layout.tsx";

export function checkoutRoutes(config: AppConfig): Hono {
  const app = new Hono();
  const provider = getProvider(config);

  app.post("/checkout", async (c) => {
    const originOk = (c.req.header("origin") ?? c.req.header("referer") ?? "").startsWith(config.publicOrigins[0] ?? "http://localhost:8787");
    if (!originOk) return c.html(<Page title="Blocked"><div class="panel notice bad">Cross-origin checkout is not allowed.</div></Page>, 403);
    const form = await c.req.parseBody();
    const categoryId = Number(form.category_id);
    const qty = Number(form.qty);
    const name = String(form.name ?? "").slice(0, 80);
    const phone = String(form.phone ?? "").trim();
    const email = String(form.email ?? "").trim().slice(0, 120) || null;

    const res = createOrder({ categoryId, qty, customerName: name, customerPhone: phone, customerEmail: email });
    if (!res.ok || !res.orderId || !res.orderRef) {
      return c.html(<Page title="Order failed"><div class="panel notice bad">{res.msg ?? "Could not create order."}</div><p><a class="btn btn-ghost" href="/events">Back to events</a></p></Page>, 400);
    }
    const order = queryOne("SELECT * FROM orders WHERE id=?", [res.orderId])!;

    // Payment initiation
    const init = await provider.initiate(res.orderId, Number(order.total_minor), String(order.currency), normalisePhoneKenya(phone)!);
    if (!init.ok) {
      return c.html(<Page title="Payment unavailable"><div class="panel notice bad">Payment could not be started. Your order {res.orderRef} is saved; try again from My Tickets or contact support.</div></Page>, 502);
    }
    recordInitiated(res.orderId, provider.name, init.providerRequestId, Number(order.total_minor), String(order.currency), normalisePhoneKenya(phone)!);

    // Guest access token (only hash stored) + signed follow-up link
    const token = issueGuestToken(res.orderId);
    const link = `/order/${encodeURIComponent(res.orderRef)}?t=${encodeURIComponent(token)}`;

    if (provider.name === "dev-simulator") {
      // Simulated provider callback, clearly labelled. This exercises the exact
      // settlement path a real Daraja callback takes.
      await simulatedCallbackProvider(init.providerRequestId!, Number(order.total_minor), config);
    }
    return c.redirect(`/pay/status?ref=${encodeURIComponent(res.orderRef)}&t=${encodeURIComponent(token)}`);
  });

  app.get("/pay/status", (c) => {
    const ref = c.req.query("ref") ?? "";
    const token = c.req.query("t") ?? "";
    if (!checkGuestAccess(ref, token)) return deny(c);
    const order = queryOne("SELECT * FROM orders WHERE order_ref=?", [ref])!;
    return c.html(orderStatusPage(order, token, config));
  });

  app.get("/order/:ref", (c) => {
    const ref = c.req.param("ref");
    const token = c.req.query("t") ?? "";
    if (!checkGuestAccess(ref, token)) return deny(c);
    const order = queryOne("SELECT * FROM orders WHERE order_ref=?", [ref])!;
    return c.html(orderStatusPage(order, token, config));
  });

  return app;
}
void signGuestLink;

async function simulatedCallbackProvider(providerRequestId: string, totalMinor: number, config: AppConfig): Promise<void> {
  // Same code path as daraja's parseDarajaCallback → handleCallback; keeps a single tested flow.
  const body = JSON.stringify({
    Body: { stkCallback: {
      MerchantRequestID: `SIM-${Date.now()}`,
      CheckoutRequestID: providerRequestId,
      ResultCode: 0,
      ResultDesc: "Simulated success",
      CallbackMetadata: { Item: [
        { Name: "Amount", Value: totalMinor / 100 },
        { Name: "MpesaReceiptNumber", Value: `SIM${Date.now().toString(36).toUpperCase()}` },
        { Name: "PhoneNumber", Value: "254700000000" },
      ] },
    } },
  });
  const parsed = (await import("../payments/daraja.ts")).parseDarajaCallback(body) as
    { providerRequestId: string; outcome: "succeeded"; amountMinor: number; providerRef: string } | null;
  if (!parsed) throw new Error("sim callback parse failed");
  handleCallback({ provider: config.paymentProvider, ...parsed, raw: body });
}

/** order page helpers taking plain numbers for status codes */
function deny(c: Context, status: ContentfulStatusCode = 404): Response | Promise<Response> {
  return c.html(
    <Page title="Order access">
      <div class="narrow">
        <div class="panel">
          <h1>Order link not recognised</h1>
          <p class="muted">Use the link exactly as sent to you, or contact {"+254 705 687 273"} with your order reference for help retrieving tickets.</p>
          <p><a class="btn btn-secondary" href="/">Back to home</a></p>
        </div>
      </div>
    </Page>,
    status,
  );
}

function orderStatusPage(order: Record<string, unknown>, token: string, config: AppConfig) {
  const ref = String(order.order_ref);
  const life = String(order.lifecycle);
  const issued = life === LIFECYCLE.TICKET_ISSUED;
  const bad = [LIFECYCLE.PAYMENT_FAILED, LIFECYCLE.EXPIRED, LIFECYCLE.CANCELLED, LIFECYCLE.REFUNDED].includes(life as never);
  const ev = queryOne("SELECT title, venue_name, venue_area, starts_at FROM events WHERE id=?", [Number(order.event_id)])!;
  const items = queryAll(
    `SELECT oi.qty, oi.unit_selling, tc.name FROM order_items oi JOIN ticket_categories tc ON tc.id = oi.category_id WHERE oi.order_id=?`,
    [Number(order.id)],
  );
  return (
    <Page title={`Order ${ref}`}>
      <div class="narrow">
        <div class="panel">
          <div class="steps"><span class="on">1 Order</span> ▸ <span class={issued ? "on" : ""}>2 Pay</span> ▸ <span class={issued ? "on" : ""}>3 Tickets</span></div>
          <h1>{issued ? "Asante! Your tickets are ready" : `Order ${ref}`}</h1>
          <p class="muted">{String(ev.title)} · {String(ev.venue_name)}, {String(ev.venue_area)}</p>
          <dl class="kv">
            <dt>Status</dt><dd><span class={issued ? "tag ok" : bad ? "tag danger" : "tag warn"}>{life}</span></dd>
            <dt>Tickets</dt><dd>{items.map((i) => (
              <span>{Number(i.qty)} × {String(i.name)} @ {formatMinor(Number(i.unit_selling), "KES")}<br /></span>
            ))}</dd>
            <dt>Total paid</dt><dd>{formatMinor(Number(order.total_minor), String(order.currency))}</dd>
          </dl>
          {issued ? (
            <p style="margin-top:12px">
              <a class="btn btn-primary" href={`/t/${encodeURIComponent(signPayload(`order:${ref}`, config.appSecretKey))}`}>View tickets</a>
            </p>
          ) : bad ? (
            <p class="notice bad">This order is {life.replace("_", " ")}. Contact +254 705 687 273 if you need help.</p>
          ) : (
            <p class="notice warn">Payment pending. This page updates once the payment provider confirms.</p>
          )}
          <p class="hint" style="margin-top:14px">Keep this link — it is your ticket access. Bookmark: <a href={`/order/${ref}?t=${encodeURIComponent(token)}`}>order page</a>.</p>
        </div>
      </div>
    </Page>
  );
}


