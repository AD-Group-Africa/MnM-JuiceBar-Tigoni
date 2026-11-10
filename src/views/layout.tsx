/**
 * Shared page shell (server-rendered JSX). Deliberately small and fast:
 * system fonts, one CSS file, no client framework.
 *
 * Chrome variants:
 *  - "customer" (default) — MnM Juice Bar site header + footer.
 *  - "staff"               — compact staff header (no customer marketing chrome).
 *  - "plain"               — no header/footer (receipts, print views).
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

/** Main customer-facing site header. One header per page — never two. */
export function SiteHeader({ active }: { active?: string }) {
  const links: NavItem[] = [
    { href: "/", label: "Home" },
    { href: "/menu", label: "Menu" },
    { href: "/about", label: "About" },
    { href: "/contact", label: "Contact" },
    { href: "/catering", label: "Catering" },
    { href: "/events", label: "Events & Tickets" },
  ];
  return (
    <header class="topbar site-header">
      <div class="topbar-inner">
        <a class="brand" href="/">
          <span class="brand-mark">M&amp;M</span>
          <span class="brand-sub">Juice Bar<small class="brand-sub-locale">Tigoni</small></span>
        </a>
        <nav class="topbar-links" aria-label="Main">
          {links.map((l) => (
            <a href={l.href} class={active === l.href ? "link is-active" : "link"}>{l.label}</a>
          ))}
          <a class="btn btn-primary btn-sm" href="/menu">Order Now</a>
        </nav>
      </div>
    </header>
  );
}

/** Compact header for staff/admin areas — no customer marketing chrome. */
export function StaffHeader({ active }: { active?: string }) {
  const links: NavItem[] = [
    { href: "/staff", label: "Dashboard" },
    { href: "/staff/juice", label: "Juice Bar" },
    { href: "/staff/juice/orders", label: "Orders" },
    { href: "/staff/juice/products", label: "Products" },
    { href: "/staff/juice/delivery", label: "Delivery zones" },
    { href: "/staff/juice/catering", label: "Catering" },
    { href: "/staff/juice/reviews", label: "Reviews" },
    { href: "/staff/juice/settings", label: "Settings" },
  ];
  return (
    <header class="topbar site-header staff-header">
      <div class="topbar-inner">
        <a class="brand" href="/staff/juice">
          <span class="brand-mark">M&amp;M</span>
          <span class="brand-sub">Staff</span>
        </a>
        <nav class="topbar-links" aria-label="Staff">
          {links.map((l) => (
            <a href={l.href} class={active === l.href ? "link is-active" : "link"}>{l.label}</a>
          ))}
        </nav>
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
  return (
    <footer class="site-footer">
      <div class="footer-inner">
        <div class="footer-brand">
          <div class="brand-mark">M&amp;M</div>
          <div class="brand-sub">Juice Bar<small class="brand-sub-locale">Tigoni</small></div>
          <p class="muted small">{address}</p>
          <p class="muted small">Phone: <a class="phone-link" href={`tel:${phone.replace(/\s+/g, "")}`}>{phone}</a></p>
          {instagram || facebook ? (
            <p class="social-row">
              {instagram ? <a class="social-link" href={instagram} target="_blank" rel="noopener">Instagram</a> : null}
              {facebook ? <a class="social-link" href={facebook} target="_blank" rel="noopener">Facebook</a> : null}
            </p>
          ) : null}
        </div>
        <div class="footer-cols">
          <div class="footer-col">
            <h4>Menu</h4>
            <a href="/menu">Full menu</a>
            <a href="/menu?category=1">Fresh juices</a>
            <a href="/menu?category=2">Smoothies</a>
            <a href="/menu?category=3">Fruit blends</a>
            <a href="/menu?category=5">Snacks</a>
          </div>
          <div class="footer-col">
            <h4>Company</h4>
            <a href="/about">About MnM</a>
            <a href="/contact">Contact &amp; location</a>
            <a href="/catering">Catering</a>
            <a href="/events">Events &amp; Tickets</a>
          </div>
          <div class="footer-col">
            <h4>Help</h4>
            <a href="/contact">Questions</a>
            <a href="/contact">Delivery info</a>
            <a href="/contact">Pickup info</a>
            <a href="/staff/login">Staff sign-in</a>
          </div>
        </div>
        {policy ? <p class="footer-note">{policy}</p> : null}
        <p class="footer-brand-owner">Platform by {BUS.by} &middot; {BUS.name}</p>
      </div>
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
        <meta name="description" content="M&M Juice Bar Tigoni — fresh juices, smoothies, fruit blends and snacks, handmade daily. Order for pickup or delivery." />
        <title>{title} · {BUS.name}</title>
        <link rel="stylesheet" href={`/styles.css?v=${CSS_VERSION.styles}`} />
        <link rel="stylesheet" href={`/juice.css?v=${CSS_VERSION.juice}`} />
        <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23e8781e'/%3E%3Ctext x='16' y='22' font-size='16' font-family='sans-serif' font-weight='800' fill='white' text-anchor='middle'%3EM%3C/text%3E%3C/svg%3E" />
      </head>
      <body>
        {head}
        <main class="container">{children}</main>
        {foot}
        {extraNav?.length ? (
          <nav class="sr-only" aria-label="Extra">
            {extraNav.map((n) => <a href={n.href}>{n.label}</a>)}
          </nav>
        ) : null}
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
