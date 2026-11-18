/**
 * Shared page shell (server-rendered JSX). Deliberately small and fast:
 * system fonts, two CSS files, no client framework.
 *
 * Chrome variants:
 *  - "customer" (default) — MnM Juice Bar site header + footer.
 *  - "staff"               — compact operations header (no customer marketing chrome).
 *  - "plain"               — no header/footer (sign-in, receipts, print views).
 *
 * Business copy (address, phone, social links) is read from business_settings
 * so the owner can change it from the staff Settings screen without a deploy.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { businessSetting } from "../juice.ts";
import { cartInteractivityScript } from "./juice-cart-script.ts";

/**
 * Stylesheet cache-buster, derived from each file's mtime when the process
 * starts. The server is restarted on every change (tsx watch in dev, a fresh
 * process per deploy), so the browser is always pointed at the current CSS
 * instead of a stale cached copy.
 */
function cssVersion(file: string): string {
  try {
    const p = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public", file);
    return String(Math.floor(fs.statSync(p).mtimeMs));
  } catch {
    return "1";
  }
}
const CSS_VERSION = { styles: cssVersion("styles.css"), juice: cssVersion("juice.css") };

/** Settings lookup that degrades gracefully if the storefront tables are absent. */
function setting(key: string, fallback = ""): string {
  try {
    return businessSetting(key) || fallback;
  } catch {
    return fallback;
  }
}

const BUS = {
  name: "M&M Juice Bar",
  by: "Afrika Digitalis",
  phone: "+254 705 687 273",
  address: "Kabuku, opposite St. Paul's University, Limuru",
};

export interface NavItem { href: string; label: string }

const CUSTOMER_LINKS: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/menu", label: "Menu" },
  { href: "/about", label: "Our story" },
  { href: "/catering", label: "Catering" },
  { href: "/events", label: "Events" },
  { href: "/contact", label: "Visit" },
  { href: "/account", label: "Account" },
];

/** Main customer-facing site header. One header per page — never two. */
export function SiteHeader({ active }: { active?: string }) {
  const phone = setting("contact_phone", BUS.phone);
  return (
    <header class="site-header" data-site-header>
      <div class="announce">
        <div class="announce-inner">
          <span>Tigoni, Limuru</span>
          <span class="announce-dot" aria-hidden="true">·</span>
          <span>Pressed fresh daily</span>
          <span class="announce-dot" aria-hidden="true">·</span>
          <span>Pickup &amp; delivery</span>
          <a class="announce-link" href="/events">Tickets on sale <span aria-hidden="true">→</span></a>
        </div>
      </div>
      <div class="nav-shell">
        <a class="brand" href="/" aria-label="M&M Juice Bar home">
          <span class="brand-mark">M&amp;M</span>
          <span class="brand-text">
            <span class="brand-name">Juice Bar</span>
            <span class="brand-locale">Tigoni · Limuru</span>
          </span>
        </a>

        <button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-nav">
          <span class="nav-toggle-bars" aria-hidden="true"><i /><i /></span>
          <span>Menu</span>
        </button>

        <nav class="site-nav" id="site-nav" data-site-nav aria-label="Main">
          {CUSTOMER_LINKS.map((l) => (
            <a
              href={l.href}
              class={active === l.href ? "nav-link is-active" : "nav-link"}
              aria-current={active === l.href ? "page" : undefined}
            >{l.label}</a>
          ))}
          <a class="nav-link nav-link-phone" href={`tel:${phone.replace(/\s+/g, "")}`}>{phone}</a>
        </nav>

        <div class="nav-actions">
          <a class="nav-cart" href="/cart" aria-label="View your order">
            <span class="nav-cart-label">Bag</span>
            <span class="nav-cart-count" id="cart-count-mini" data-cart-count>0</span>
          </a>
          <a class="btn btn-primary btn-sm nav-cta" href="/menu">Order now</a>
        </div>
      </div>
    </header>
  );
}

const STAFF_LINKS: NavItem[] = [
  { href: "/staff", label: "Overview" },
  { href: "/staff/juice", label: "Juice bar" },
  { href: "/staff/juice/orders", label: "Orders" },
  { href: "/staff/juice/products", label: "Menu" },
  { href: "/staff/events", label: "Tickets" },
  { href: "/staff/scan", label: "Scan" },
  { href: "/staff/juice/settings", label: "Settings" },
];

/** Compact header for staff/admin areas — no customer marketing chrome. */
export function StaffHeader({ active }: { active?: string }) {
  return (
    <header class="staff-header">
      <div class="staff-bar">
        <a class="staff-brand" href="/staff/juice">
          <span class="brand-mark">M&amp;M</span>
          <span class="staff-brand-text">
            <strong>Operations</strong>
            <small>Tigoni · Limuru</small>
          </span>
        </a>
        <nav class="staff-nav" aria-label="Staff">
          {STAFF_LINKS.map((l) => (
            <a href={l.href} class={active === l.href ? "staff-link is-active" : "staff-link"}>{l.label}</a>
          ))}
        </nav>
        <div class="staff-actions">
          <a class="staff-site-link" href="/" target="_blank" rel="noopener">View site ↗</a>
          <form method="post" action="/staff/logout">
            <button class="staff-signout" type="submit">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}

/** Site-wide footer with the business details the owner controls. */
export function SiteFooter() {
  const address = setting("address_line", BUS.address);
  const phone = setting("contact_phone", BUS.phone);
  const policy = setting("footer_policy_note", "");
  const instagram = setting("instagram_url", "");
  const facebook = setting("facebook_url", "");
  const hours = setting("opening_hours", "Mon–Fri 8am–6pm · Sat 9am–5pm · Sun 10am–4pm");
  return (
    <footer class="site-footer">
      <div class="footer-top">
        <div class="footer-lead">
          <p class="kicker kicker-light">M&amp;M Juice Bar · Tigoni</p>
          <p class="footer-display">Drink something<br /><em>good.</em></p>
          <a class="btn btn-cream" href="/menu">Order now</a>
        </div>

        <div class="footer-grid">
          <div class="footer-col">
            <h4>Menu</h4>
            <a href="/menu">Everything</a>
            <a href="/menu?category=1">Fresh juices</a>
            <a href="/menu?category=2">Smoothies</a>
            <a href="/menu?category=3">Fruit blends</a>
            <a href="/menu?category=5">Snacks</a>
          </div>
          <div class="footer-col">
            <h4>Visit</h4>
            <p class="footer-address">{address}</p>
            <a class="footer-phone" href={`tel:${phone.replace(/\s+/g, "")}`}>{phone}</a>
            <div class="footer-hours">{hours.split(/<br\s*\/?>/i).map((line) => <span>{line.replace(/<[^>]*>/g, "")}</span>)}</div>
          </div>
          <div class="footer-col">
            <h4>MnM Tickets</h4>
            <a href="/events">Events on sale</a>
            <a href="/tickets">How ticketing works</a>
            <a href="/catering">Catering &amp; events</a>
            {instagram ? <a href={instagram} target="_blank" rel="noopener">Instagram ↗</a> : null}
            {facebook ? <a href={facebook} target="_blank" rel="noopener">Facebook ↗</a> : null}
          </div>
          <div class="footer-col">
            <h4>Team</h4>
            <a href="/staff/login">Staff sign-in</a>
            <a href="/contact">Contact</a>
            <a href="/about">Our story</a>
          </div>
        </div>
      </div>

      <div class="footer-bottom">
        <span>© {new Date().getFullYear()} M&amp;M Juice Bar. All rights reserved.</span>
        <span class="footer-platform">Platform by {BUS.by}</span>
      </div>
      {policy ? <p class="footer-note">{policy}</p> : null}
    </footer>
  );
}

export interface PageProps {
  title: string;
  active?: string;
  extraNav?: NavItem[];
  children: unknown; // JSX children
  chrome?: "customer" | "staff" | "plain";
}

/** Tiny progressive-enhancement script: mobile nav, sticky header shadow, reveal-on-scroll. */
const pageScript = `
(function () {
  'use strict';
  var toggle = document.querySelector('[data-nav-toggle]');
  var nav = document.querySelector('[data-site-nav]');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = document.body.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        document.body.classList.remove('nav-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }
  var header = document.querySelector('[data-site-header]');
  if (header) {
    var onScroll = function () {
      header.classList.toggle('is-scrolled', window.scrollY > 8);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    document.querySelectorAll('[data-reveal]').forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll('[data-reveal]').forEach(function (el) { el.classList.add('is-visible'); });
  }
})();
`;

export function Page({ title, active, extraNav, children, chrome = "customer" }: PageProps) {
  const head = chrome === "customer"
    ? <SiteHeader active={active} />
    : chrome === "staff"
      ? <StaffHeader active={active} />
      : null;
  const foot = chrome === "plain" ? null : <SiteFooter />;
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#FDFBF7" />
        <meta name="description" content="M&M Juice Bar Tigoni — fresh juices, smoothies, fruit blends and snacks, handmade daily. Order for pickup or delivery, and find event tickets from MnM Tickets." />
        <title>{title} · {BUS.name}</title>
        <link rel="stylesheet" href={`/styles.css?v=${CSS_VERSION.styles}`} />
        <link rel="stylesheet" href={`/juice.css?v=${CSS_VERSION.juice}`} />
        <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='9' fill='%23E87A2D'/%3E%3Ctext x='16' y='22' font-size='15' font-family='Georgia,serif' font-weight='700' fill='%23FDFBF7' text-anchor='middle'%3EM%3C/text%3E%3C/svg%3E" />
      </head>
      <body class={`page-${chrome}`}>
        <a class="skip-link" href="#main">Skip to content</a>
        {head}
        <main class="container" id="main">{children}</main>
        {foot}
        {extraNav?.length ? (
          <nav class="sr-only" aria-label="Extra">
            {extraNav.map((n) => <a href={n.href}>{n.label}</a>)}
          </nav>
        ) : null}
        <script dangerouslySetInnerHTML={{ __html: pageScript }} />
        {chrome === "customer" ? (
          // Cart interactivity (add to order, quantity, delivery toggle). Kept as a
          // single inline script so the storefront needs no client bundle.
          <script dangerouslySetInnerHTML={{ __html: cartInteractivityScript }} />
        ) : null}
      </body>
    </html>
  );
}

/** Staff-area page: staff header + site footer. */
export function StaffPage(props: Omit<PageProps, "chrome">) {
  return <Page {...props} chrome="staff" />;
}

/** Print-friendly page (receipts): no header/footer. */
export function PlainPage(props: Omit<PageProps, "chrome">) {
  return <Page {...props} chrome="plain" />;
}
