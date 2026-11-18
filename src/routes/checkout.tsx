/**
 * Customer checkout + order/tickets status pages.
 * Flow: event page form → /checkout (create order + reservation, initiate payment)
 * → dev-sim callback → status page → /t/<signed> tickets page with QR.
 * With PAYMENT_PROVIDER=daraja this endpoint performs a genuine STK initiation
 * and awaits the provider callback — never trusts the redirect alone.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppConfig } from "../config.ts";
import { queryOne, queryAll } from "../db.ts";
import { createOrder, LIFECYCLE, normalisePhoneKenya, issueGuestToken, checkGuestAccess, signGuestLink } from "../orders.ts";
import { getProvider, recordInitiating, completeInitiation, failInitiation, handleCallback } from "../payments/index.ts";
import { formatMinor } from "../money.ts";
import { signPayload, stateChangeOriginAllowed } from "../auth.ts";
import { Page } from "../views/layout.tsx";
import { CUSTOMER_COOKIE, getCustomerBySession, linkTicketOrderToCustomer } from "../customers.ts";

export function checkoutRoutes(config: AppConfig): Hono {
  const app = new Hono();
  const provider = getProvider(config);

  app.post("/checkout", async (c) => {
    // Use the shared allow-list (all configured origins, including development
    // loopback aliases) rather than silently comparing against only the first.
    const originOk = stateChangeOriginAllowed(c, config.publicOrigins);
    if (!originOk) return c.html(<Page title="Blocked"><div class="panel notice bad">Cross-origin checkout is not allowed.</div></Page>, 403);
    // Fail before createOrder(): a disabled provider must not reserve inventory,
    // create an order or leave a pending payment row behind.
    if (config.paymentProvider === "disabled") {
      return c.html(
        <Page title="Ticket payments unavailable">
          <div class="narrow">
            <div class="panel notice bad">
              <h1>Online ticket payment is unavailable</h1>
              <p>No order was created and no payment was taken. Online ticket sales are temporarily paused.</p>
              <p class="muted">Please check back later, or contact MnM Juice Bar on +254 705 687 273 for help.</p>
              <p><a class="btn btn-primary" href="/events">Back to events</a></p>
            </div>
          </div>
        </Page>,
        503,
      );
    }
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
    const customer = getCustomerBySession(getCookie(c, CUSTOMER_COOKIE));
    if (customer) linkTicketOrderToCustomer(res.orderId, customer.id);

    // Payment initiation. Persist the local attempt first so a provider-side
    // charge can never exist without an audit anchor; one active attempt per order.
    const totalMinor = Number(order.total_minor);
    const currency = String(order.currency);
    const msisdn = normalisePhoneKenya(phone)!;
    const attempt = recordInitiating(res.orderId, provider.name, totalMinor, currency, msisdn);
    if (!attempt.created) {
      const token = issueGuestToken(res.orderId);
      return c.redirect(`/pay/status?ref=${encodeURIComponent(res.orderRef)}&t=${encodeURIComponent(token)}`);
    }
    let init;
    try {
      init = await provider.initiate(res.orderId, totalMinor, currency, msisdn);
    } catch (err) {
      failInitiation(attempt.paymentId, err instanceof Error ? err.message : "provider initiation threw");
      return c.html(<Page title="Payment unavailable"><div class="panel notice bad">Payment could not be started. Your order {res.orderRef} is saved; try again or contact support.</div></Page>, 502);
    }
    if (!init.ok || !init.providerRequestId) {
      failInitiation(attempt.paymentId, init.msg ?? "provider did not return a request id");
      return c.html(<Page title="Payment unavailable"><div class="panel notice bad">Payment could not be started. Your order {res.orderRef} is saved; try again or contact support.</div></Page>, 502);
    }
    if (!completeInitiation(attempt.paymentId, init.providerRequestId, init.merchantRequestId)) {
      return c.html(<Page title="Payment unavailable"><div class="panel notice bad">Payment was started but could not be confirmed locally. Order {res.orderRef} needs support review.</div></Page>, 500);
    }

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
  // PAYMENT_DEV_FORCE_STATUS=failure makes the simulator emit a DECLINED callback so
  // the failed-payment path can be demonstrated without any real money.
  const forceFailure = config.paymentDevForceStatus === "failure";
  const body = JSON.stringify({
    Body: { stkCallback: {
      MerchantRequestID: `SIM-${Date.now()}`,
      CheckoutRequestID: providerRequestId,
      ResultCode: forceFailure ? 1032 : 0,
      ResultDesc: forceFailure ? "Simulated failure — Request timeout by user" : "Simulated success",
      CallbackMetadata: { Item: [
        { Name: "Amount", Value: totalMinor / 100 },
        { Name: "MpesaReceiptNumber", Value: `SIM${Date.now().toString(36).toUpperCase()}` },
        { Name: "PhoneNumber", Value: "254700000000" },
      ] },
    } },
  });
  const parsed = (await import("../payments/daraja.ts")).parseDarajaCallback(body) as
    { providerRequestId: string; outcome: "succeeded" | "failed"; amountMinor?: number; providerRef?: string } | null;
  if (!parsed) throw new Error("sim callback parse failed");
  handleCallback({ provider: "dev-simulator", ...parsed, raw: body });
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
          {config.paymentProvider === "disabled" ? (
            <p class="notice bad" role="status">
              <strong>Online payment is disabled.</strong>{" "}
              This order is not paid. No payment provider was contacted; contact the bar to arrange payment.
            </p>
          ) : config.paymentProvider === "dev" ? (
            <p class="notice warn" role="status">
              <strong>Development payment simulator — no real money moved.</strong>{" "}
              This order was settled by the local simulator; no M-Pesa prompt was sent and no card was charged.
              Live M-Pesa requires <code>PAYMENT_PROVIDER=daraja</code> with Safaricom Daraja credentials.
            </p>
          ) : null}
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


