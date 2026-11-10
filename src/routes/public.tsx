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
    `SELECT t.quantity - t.sold_count
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

export function publicRoutes(_config: AppConfig): Hono {
  const app = new Hono();

  // The ticketing platform's own landing page. The site root is the MnM Juice
  // Bar storefront (registered first in app.tsx), so the ticket homepage lives
  // here at /tickets and is linked from /events.
  app.get("/tickets", (c) => {
    const events = onSaleEvents();
    return c.html(
      <Page title="Buy event tickets">
        <section class="hero">
          <div class="kicker">Authorised event ticket resale · Limuru</div>
          <h1>Buy event tickets at MnM Juice Bar, or right here.</h1>
          <p class="lead">
            Verified, authentic event tickets sold by <strong>MnM Juice Bar</strong> (Kabuku, opposite St.&nbsp;Paul's University)
            and issued instantly with a QR code you show at the gate. Powered by Afrika Digitalis.
          </p>
        </section>
        <h2>Upcoming events</h2>
        {events.length === 0 ? (
          <div class="panel"><p class="muted">No events are on sale right now — check back soon, or call {BUS_PHONE()}.</p></div>
        ) : (
          <div class="event-grid">
            {events.map((e) => (
              <article class="event-card">
                <a href={`/events/${e.slug}`} aria-hidden="true"><div class="art">{artCell(e.title, e.image_url)}</div></a>
                <div class="body">
                  <div class="when">{fmtWhen(e.starts_at)}</div>
                  <h3><a href={`/events/${e.slug}`} style="text-decoration:none;color:inherit">{e.title}</a></h3>
                  <div class="venue">📍 {e.venue_name}, {e.venue_area}</div>
                  <div class="prices">
                    {categoryPriceRange(e.id)} ·{" "}
                    <a href={`/events/${e.slug}`}>Buy →</a>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
        <hr class="divider" />
        <section class="panel">
          <h2>How MnM Tickets works</h2>
          <ol>
            <li>Choose your event and the number of tickets.</li>
            <li>Pay with M-Pesa — you receive a payment prompt on your phone.</li>
            <li>Your unique QR ticket appears instantly — keep the confirmation link we send you.</li>
            <li>Gate staff scan your QR — verification happens live online, every time.</li>
          </ol>
          <p class="hint">MnM is the authorised seller of tickets for listed events. The responsible seller, organiser and support contact are shown on every event page.</p>
        </section>
      </Page>,
    );
  });

  app.get("/events", (c) => {
    const events = onSaleEvents();
    return c.html(
      <Page title="Events" active="/events">
        <p class="muted small"><a href="/tickets">About MnM Tickets</a> &middot; <a href="/">Back to MnM Juice Bar</a></p>
        <h1>Events on sale</h1>
        {events.length === 0
          ? <div class="panel"><p class="muted">Nothing on sale at the moment. Try again soon or contact {"+254 705 687 273"}.</p></div>
          : (
            <div class="event-grid">
              {events.map((e) => (
                <article class="event-card">
                  <a href={`/events/${e.slug}`} aria-hidden="true"><div class="art">{artCell(e.title, e.image_url)}</div></a>
                  <div class="body">
                    <div class="when">{fmtWhen(e.starts_at)}</div>
                    <h3><a href={`/events/${e.slug}`} style="text-decoration:none;color:inherit">{e.title}</a></h3>
                    <div class="venue">📍 {e.venue_name}, {e.venue_area}</div>
                    <div class="prices">{categoryPriceRange(e.id)} · <a href={`/events/${e.slug}`}>Buy →</a></div>
                  </div>
                </article>
              ))}
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
      <Page title={ev.title} active="events">
        <p><a href="/events">← All events</a></p>
        <h1>{ev.title}</h1>
        <div class="kv" style="margin-bottom:12px">
          <dt>When</dt><dd>{fmtWhen(ev.starts_at)}</dd>
          <dt>Where</dt><dd>{ev.venue_name}, {ev.venue_area}</dd>
          <dt>Organiser</dt><dd>{ev.organizer_name}</dd>
          <dt>Seller</dt><dd>MnM Juice Bar (authorised reseller) · questions: {ev.organizer_contact}</dd>
        </div>
        {ev.description && <p>{ev.description}</p>}
        <hr class="divider" />
        <h2>Tickets</h2>
        <p class="hint" style="margin-bottom:10px">Each purchase needs a name and phone number so we can reach you about the order and send your tickets.</p>
        {cats.map((cat) => {
          const avail = availableFor(cat.id);
          const orig = Number(cat.original_price);
          const mnm = roundPoints(orig, LAUNCH_TERMS.mnmPoints);
          const ad = roundPoints(orig, LAUNCH_TERMS.adPoints);
          return (
            <div class="panel">
              <h3>{cat.name}{cat.description ? <small> — {cat.description}</small> : ""}</h3>
              <div class="price-line"><span>Ticket price (set by organiser)</span><span>{formatMinor(orig, LAUNCH_TERMS.currency)}</span></div>
              <div class="price-line"><span>MnM service commission</span><span>{formatMinor(mnm, LAUNCH_TERMS.currency)}</span></div>
              <div class="price-line"><span>Platform fee (Afrika Digitalis)</span><span>{formatMinor(ad, LAUNCH_TERMS.currency)}</span></div>
              <div class="price-line total"><span>You pay per ticket</span><span>{formatMinor(orig + mnm + ad, LAUNCH_TERMS.currency)}</span></div>
              <form method="post" action="/checkout" style="margin-top:10px">
                <input type="hidden" name="category_id" value={String(cat.id)} />
                <div class="form-row">
                  <div>
                    <label for={`name-${cat.id}`}>Your name</label>
                    <input id={`name-${cat.id}`} name="name" type="text" maxlength={80} required placeholder="e.g. Wanjiku Kamau" />
                  </div>
                  <div>
                    <label for={`phone-${cat.id}`}>Phone (M-Pesa)</label>
                    <input id={`phone-${cat.id}`} name="phone" type="tel" maxlength={20} required placeholder="07… or +2547…" pattern="(\+?254|0)[17]\d{8}" title="Kenyan mobile number, e.g. 0712345678" />
                  </div>
                  <div>
                    <label for={`email-${cat.id}`}>Email (optional)</label>
                    <input id={`email-${cat.id}`} name="email" type="email" maxlength={120} placeholder="you@example.com" />
                  </div>
                </div>
                <div class="form-row">
                  <div>
                    <label for={`qty-${cat.id}`}>Quantity</label>
                    <select id={`qty-${cat.id}`} name="qty">
                      {[1, 2, 3, 4].map((q) => (q <= Math.min(avail, ev.max_per_order) ? <option value={q}>{q}</option> : null))}
                    </select>
                    <p class="hint">{avail} of {cat.quantity} remaining · max {Math.min(avail, ev.max_per_order)} per order on this screen</p>
                  </div>
                  <div style="align-self:end">
                    {avail > 0 || null}
                    {avail > 0 || (
                      <span class="tag danger">Sold out</span>
                    )}
                    {avail > 0
                      ? <button class="btn btn-primary btn-block" type="submit" disabled={avail <= 0}>Buy — {formatMinor(orig + mnm + ad, LAUNCH_TERMS.currency)} each</button>
                      : <button class="btn btn-ghost btn-block" type="button" disabled>Sold out</button>}
                  </div>
                </div>
              </form>
            </div>
          );
        })}
        <section class="panel">
          <h3>Refunds &amp; transfers</h3>
          <p class="hint">
            Tickets are verified online at the gate and can be shown on any phone. Refund, transfer and cancellation
            conditions for each event are agreed with the organiser and stated on the ticket page; the event contact
            above handles questions about an event before purchase.
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
