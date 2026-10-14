/**
 * Shared page shell (server-rendered JSX). Deliberately small and fast:
 * system fonts, one CSS file, no client framework.
 */
const BUS = { name: "MnM Tickets", by: "Afrika Digitalis", phone: "+254 705 687 273" };

export interface NavItem { href: string; label: string }
export function Topbar({ extra, active }: { extra?: NavItem[]; active?: string }) {
  return (
    <header class="topbar">
      <div class="topbar-inner">
        <a class="wordmark" href="/">
          <span class="dot">MnM</span>
          <span>MnM&nbsp;Tickets</span>
        </a>
        <nav class="topnav">
          <a href="/events">Events</a>
          <a href="/staff">Staff</a>
          {active ? <a href={active} class="tag ok">on</a> : null}
          {extra?.map((n) => <a href={n.href}>{n.label}</a>)}
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer class="footer container">
      <p class="muted">
        {BUS.name} · operated by MnM Juice Bar, Kabuku (Limuru) · platform by {BUS.by}.
        <br />
        Support: {BUS.phone} · Tickets are verified online at the gate. Authorised resale only.
      </p>
    </footer>
  );
}

export interface PageProps {
  title: string;
  active?: string;
  extraNav?: NavItem[];
  children: unknown; // JSX children
}

export function Page({ title, active, extraNav, children }: PageProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} · MnM Tickets</title>
        <link rel="stylesheet" href="/styles.css" />
        <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23e8781e'/%3E%3Ctext x='16' y='22' font-size='16' font-family='sans-serif' font-weight='800' fill='white' text-anchor='middle'%3EM%3C/text%3E%3C/svg%3E" />
      </head>
      <body>
        <Topbar active={active} />
        <main class="container">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
