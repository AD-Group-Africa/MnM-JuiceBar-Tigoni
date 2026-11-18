/**
 * Public storefront (no auth). Only events with status 'on_sale' and inside their
 * sale window are shown; drafts and paused events stay private (tested).
 */
import { Hono } from "hono";
import type { AppConfig } from "../config.ts";
import { queryAll, queryOne } from "../db.ts";
import { formatMinor, roundPoints } from "../money.ts";
import { LAUNCH_TERMS } from "../money.ts";
import { Page } from "../views/layout.tsx";

export interface PublicEvent {
  id: number;
  slug: string;
  title: string;
  description: string;
  venue_name: string;
  venue_area: string;
  starts_at: string;
  image_url: string | null;
  organizer_name: string;
  organizer_contact: string;
  status: string;
  sale_ends_at: string | null;
  max_per_order: number;
}

export function onSaleEvents(): PublicEvent[] {
  return queryAll(
    `SELECT id, slug, title, venue_name, venue_area, starts_at, image_url, organizer_name, organizer_contact, status, sale_ends_at, max_per_order
       FROM events
      WHERE status = 'on_sale'
        AND (sale_starts_at IS NULL OR sale_starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        AND (sale_ends_at IS NULL OR sale_ends_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ORDER BY starts_at ASC`,
  ) as unknown as PublicEvent[];
}

export function availableFor(categoryId: number): number {
  const r = queryOne(
    `SELECT t.quantity
             - COALESCE((SELECT COUNT(*) FROM tickets tk
                           JOIN order_items oi ON oi.id = tk.order_item_id
                          WHERE oi.category_id = t.id AND tk.status IN ('valid','redeemed')), 0)
             - COALESCE((SELECT SUM(r.qty) FROM reservations r
                          WHERE r.category_id = t.id AND r.status = 'active'
                            AND r.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')), 0)
             AS avail
       FROM ticket_categories t WHERE t.id = ?`,
    [categoryId],
  );
  return r ? Number(r.avail) : 0;
}

interface CatRow {
  id: number;
  name: string;
  description: string;
  original_price: number;
  quantity: number;
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-KE", { dateStyle: "full", timeStyle: "short" });
}

/** Placeholder-art initials. Skips boilerplate words (SAMPLE / EVENT / DEV …) so
 *  demo events with the same prefix do not all show identical tiles. */
const ART_STOP_WORDS = new Set(["sample", "event", "events", "dev", "seed", "demo", "the", "a", "an", "of", "and"]);

function artCell(title: string, url: string | null) {
  if (url) return <img src={url} alt="" />;
  const words = title.split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9]/g, ""));
  const meaningful = words.filter((w) => w && !ART_STOP_WORDS.has(w.toLowerCase()));
  const source = meaningful.length > 0 ? meaningful : words.filter(Boolean);
  const initials = source.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return <div class="initials">{initials || "MnM"}</div>;
}

function EventCard({ event: e }: { event: PublicEvent }) {
  const d = new Date(e.starts_at);
  return (
    <article class="event-card">
      <a href={`/events/${e.slug}`} aria-label={e.title}>
        <div class="art">
          {artCell(e.title, e.image_url)}
          <span class="event-date-chip"><span class="d">{d.getDate()}</span><span class="m">{d.toLocaleDateString("en-KE", { month: "short" })}</span></span>
        </div>
      </a>
      <div class="body">
        <div class="when">{fmtWhen(e.starts_at)}</div>
        <h3><a href={`/events/${e.slug}`}>{e.title}</a></h3>
        <div class="venue">📍 {e.venue_name}, {e.venue_area}</div>
        <div class="prices"><span>{categoryPriceRange(e.id)}</span><a href={`/events/${e.slug}`}>Tickets →</a></div>
      </div>
    </article>
  );
}

export function publicRoutes(config: AppConfig): Hono {
  const app = new Hono();

  // The ticketing platform's own landing page. The site root is the MnM Juice
  // Bar storefront (registered first in app.tsx), so the ticket homepage lives
  // here at /tickets and is linked from /events.
  app.get("/tickets", (c) => {
    const events = onSaleEvents();
    return c.html(
      <Page title="MnM Tickets — buy event tickets" active="/events">
        <div class="page-head">
          <p class="kicker">MnM Tickets · Limuru</p>
          <h1>Good nights start<br />with a ticket.</h1>
          <p class="lead">
            Authorised event tickets sold from the bar and online. Every ticket is unique,
            issued instantly with a QR code and verified once at the gate.
          </p>
          <div class="actions-row">
            <a class="btn btn-primary" href="#upcoming">See what's on</a>
            <a class="btn btn-ghost" href="/">Back to the juice bar</a>
          </div>
        </div>

        <section class="section" id="upcoming">
          <div class="section-head">
            <div>
              <p class="kicker">Upcoming</p>
              <h2>Events on sale.</h2>
            </div>
            <p class="muted small">Prices include the MnM service commission and the Afrika Digitalis platform fee.</p>
          </div>
          {events.length === 0 ? (
            <div class="panel"><p class="muted">No events are on sale right now — check back soon, or call {BUS_PHONE()}.</p></div>
          ) : (
            <div class="event-grid">
              {events.map((e) => <EventCard event={e} />)}
            </div>
          )}
        </section>

        <section class="section">
          <div class="section-head">
            <div>
              <p class="kicker">How it works</p>
              <h2>From phone to gate.</h2>
            </div>
          </div>
          <ol class="steps-inline">
            <li><span>Choose your event and tier</span></li>
            <li><span>Pay — simulated in this demo</span></li>
            <li><span>Your QR ticket appears instantly</span></li>
            <li><span>Staff scan it once at the gate</span></li>
          </ol>
          <p class="hint">MnM is the authorised seller for listed events. The organiser and support contact are shown on every event page.</p>
        </section>
      </Page>,
    );
  });

  app.get("/events", (c) => {
    const events = onSaleEvents();
    return c.html(
      <Page title="Events & tickets" active="/events">
        <div class="page-head">
          <p class="kicker">MnM Tickets</p>
          <h1>What's on.</h1>
          <p class="lead">Live events around Limuru, sold through MnM Juice Bar. Buy online, show your QR at the gate.</p>
        </div>
        <div class="actions-row">
          <a class="btn btn-ghost btn-sm" href="/tickets">About MnM Tickets</a>
          <a class="btn btn-ghost btn-sm" href="/">Back to the juice bar</a>
        </div>

        {events.length === 0 ? (
          <div class="panel"><p class="muted">Nothing on sale at the moment. Try again soon or call {BUS_PHONE()}.</p></div>
        ) : (
          <div class="event-grid">
            {events.map((e) => <EventCard event={e} />)}
          </div>
        )}
      </Page>,
    );
  });

  app.get("/events/:slug", (c) => {
    const slug = c.req.param("slug");
    const ev = queryOne(
      `SELECT * FROM events
        WHERE slug = ? AND status = 'on_sale'
          AND (sale_starts_at IS NULL OR sale_starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          AND (sale_ends_at IS NULL OR sale_ends_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      [slug],
    ) as unknown as PublicEvent | undefined;
    if (!ev) return c.html(<Page title="Event not found"><div class="panel"><h1>Event not available</h1><p class="muted">This event does not exist, is not on sale, or its sale window has closed.</p><p><a class="btn btn-secondary" href="/events">See all events</a></p></div></Page>, 404);

    const cats = queryAll(
      "SELECT id, name, description, original_price, quantity FROM ticket_categories WHERE event_id = ? ORDER BY original_price DESC",
      [ev.id],
    ) as unknown as CatRow[];

    return c.html(
      <Page title={ev.title} active="/events">
        <div class="event-hero">
          <p class="muted small"><a href="/events">← All events</a></p>
          <div class="event-hero-grid">
            <div>
              <p class="kicker">MnM Tickets · {ev.venue_area}</p>
              <h1 class="event-hero-title">{ev.title}</h1>
              <div class="event-meta-list">
                <div class="event-meta-item">
                  <span class="ico" aria-hidden="true">◷</span>
                  <div><strong>When</strong>{fmtWhen(ev.starts_at)}</div>
                </div>
                <div class="event-meta-item">
                  <span class="ico" aria-hidden="true">⌖</span>
                  <div><strong>Where</strong>{ev.venue_name}, {ev.venue_area}</div>
                </div>
                <div class="event-meta-item">
                  <span class="ico" aria-hidden="true">✦</span>
                  <div><strong>Organiser</strong>{ev.organizer_name} · {ev.organizer_contact}</div>
                </div>
                <div class="event-meta-item">
                  <span class="ico" aria-hidden="true">◎</span>
                  <div><strong>Sold by</strong>MnM Juice Bar — authorised reseller</div>
                </div>
              </div>
              {ev.description ? <p class="muted">{ev.description}</p> : null}
              {config.paymentProvider === "disabled" ? (
                <p class="notice bad">
                  <strong>Online ticket sales are temporarily unavailable.</strong>{" "}
                  No payment can be taken and no ticket order will be created. Please check back later or contact MnM Juice Bar for help.
                </p>
              ) : config.paymentProvider === "dev" ? (
                <p class="notice warn">
                  <strong>Demonstration ticketing — payment is simulated.</strong>{" "}
                  No M-Pesa prompt is sent and no money moves. Every ticket is real in the system and can be scanned.
                </p>
              ) : (
                <p class="notice ok">
                  <strong>Secure M-Pesa payment.</strong> Complete checkout to receive an STK prompt on your phone. Tickets are issued only after the payment provider confirms.
                </p>
              )}
            </div>
            <div class="event-poster">
              {ev.image_url ? <img src={ev.image_url} alt={ev.title} /> : artCell(ev.title, null)}
            </div>
          </div>
        </div>

        <section class="section">
          <div class="section-head">
            <div>
              <p class="kicker">Tickets</p>
              <h2>Choose your tier.</h2>
            </div>
            <p class="muted small">Each purchase needs a name and phone number so we can reach you about the order.</p>
          </div>

          <div class="tier-stack">
            {cats.map((cat) => {
              const avail = availableFor(cat.id);
              const orig = Number(cat.original_price);
              const mnm = roundPoints(orig, LAUNCH_TERMS.mnmPoints);
              const ad = roundPoints(orig, LAUNCH_TERMS.adPoints);
              const maxPer = Math.min(avail, ev.max_per_order);
              return (
                <div class="tier">
                  <div class="tier-head">
                    <div>
                      <h3 class="tier-name">{cat.name}</h3>
                      {cat.description ? <p class="tier-desc">{cat.description}</p> : null}
                    </div>
                    <div class="tier-price">
                      <span class="amount">{formatMinor(orig + mnm + ad, LAUNCH_TERMS.currency)}</span>
                      <span class="each">per ticket</span>
                    </div>
                  </div>

                  <details class="tier-breakdown">
                    <summary>Price breakdown</summary>
                    <div class="price-line"><span>Organiser ticket price</span><span>{formatMinor(orig, LAUNCH_TERMS.currency)}</span></div>
                    <div class="price-line"><span>MnM service commission</span><span>{formatMinor(mnm, LAUNCH_TERMS.currency)}</span></div>
                    <div class="price-line"><span>Platform fee (Afrika Digitalis)</span><span>{formatMinor(ad, LAUNCH_TERMS.currency)}</span></div>
                  </details>

                  {config.paymentProvider === "disabled" ? (
                    <p class="tier-sold-out">Online sales are paused — no order will be created until payment is restored.</p>
                  ) : avail <= 0 ? (
                    <p class="tier-sold-out">Sold out — this tier has no tickets left.</p>
                  ) : (
                    <form method="post" action="/checkout" class="tier-form">
                      <input type="hidden" name="category_id" value={String(cat.id)} />
                      <div class="form-row">
                        <div class="field">
                          <label for={`name-${cat.id}`}>Your name</label>
                          <input id={`name-${cat.id}`} name="name" type="text" maxlength={80} required placeholder="e.g. Wanjiku Kamau" />
                        </div>
                        <div class="field">
                          <label for={`phone-${cat.id}`}>{config.paymentProvider === "daraja" ? "Phone (M-Pesa)" : "Phone"}</label>
                          <input id={`phone-${cat.id}`} name="phone" type="tel" maxlength={20} required placeholder="07… or +2547…" pattern="(\+?254|0)[17]\d{8}" title="Kenyan mobile number, e.g. 0712345678" />
                        </div>
                        <div class="field">
                          <label for={`email-${cat.id}`}>Email (optional)</label>
                          <input id={`email-${cat.id}`} name="email" type="email" maxlength={120} placeholder="you@example.com" />
                        </div>
                        <div class="field">
                          <label for={`qty-${cat.id}`}>Quantity</label>
                          <select id={`qty-${cat.id}`} name="qty">
                            {[1, 2, 3, 4].filter((q) => q <= maxPer).map((q) => <option value={q}>{q}</option>)}
                          </select>
                        </div>
                        <div class="field">
                          <button class="btn btn-primary btn-block" type="submit">
                            Get tickets — {formatMinor((orig + mnm + ad), LAUNCH_TERMS.currency)} each
                          </button>
                        </div>
                      </div>
                      <p class="hint">{avail} of {cat.quantity} remaining · maximum {maxPer} per order on this screen</p>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section class="panel">
          <h3>At the gate</h3>
          <p class="hint">
            Show the QR code on your phone. Staff scan it live — each ticket can be redeemed once only,
            and a duplicate scan is refused. Screenshots work; you do not need to print anything.
          </p>
          <h3>Refunds &amp; transfers</h3>
          <p class="hint">
            Refund, transfer and cancellation conditions are agreed with the organiser and shown before purchase.
            Contact the organiser above for questions about this event.
          </p>
        </section>
      </Page>,
    );
  });

  app.get("/health", (c) => c.json({ ok: true, service: "mnm-tickets", time: new Date().toISOString() }));

  return app;
}

function BUS_PHONE(): string {
  return "+254 705 687 273";
}

export function categoryPriceRange(eventId: number): string {
  const cats = queryAll("SELECT original_price FROM ticket_categories WHERE event_id = ?", [eventId]);
  if (cats.length === 0) return "No tickets configured";
  const prices = cats.map((r) => {
    const orig = Number(r.original_price);
    return orig + roundPoints(orig, LAUNCH_TERMS.mnmPoints) + roundPoints(orig, LAUNCH_TERMS.adPoints);
  });
  const min = Math.min(...prices), max = Math.max(...prices);
  return min === max ? `from ${formatMinor(min, "KES")}` : `${formatMinor(min, "KES")} – ${formatMinor(max, "KES")}`;
}
