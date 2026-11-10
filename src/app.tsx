import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppConfig } from "./config.ts";
import { publicRoutes } from "./routes/public.tsx";
import { juicePublicRoutes } from "./routes/juice-public.tsx";
import { authRoutes } from "./routes/staff.tsx";
import { checkoutRoutes } from "./routes/checkout.tsx";
import { ticketRoutes } from "./routes/tickets.tsx";
import { verifyScanRoutes, scanRoutes } from "./routes/verify-scan.tsx";
import { staffAreaRoutes } from "./routes/staff-area.tsx";
import { juiceStaffRoutes } from "./routes/juice-staff.tsx";
import { adminRoutes } from "./routes/admin.tsx";
import { parseDarajaNotify } from "./payments/notify.ts";
import { handleCallback } from "./payments/index.ts";

/**
 * Application assembly (no listener) — reused by the production server and by
 * integration tests via node:test + fetch.
 */
export function createApp(config: AppConfig): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    // Full detail for the operator log only; responses are generic.
    console.error("[error]", c.req.method, c.req.url, err);
    if (wantsJson(c.req.path)) return c.json({ error: "Something went wrong", code: "internal" }, 500);
    return c.text("Something went wrong", 500);
  });

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "same-origin");
    if (config.env === "production") {
      c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    c.header("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'");
    // Development only: stylesheets, the inline cart script and the sample
    // illustrations are edited constantly, and a stale browser cache silently
    // shows an old design. Development responses are never cached.
    if (config.env === "development") c.header("Cache-Control", "no-store");
  });

  // Order matters: the first handler registered for a path wins. The juice
  // storefront is the primary business, so "/" must resolve to the MnM Juice
  // Bar homepage — the ticketing platform lives under /events and /tickets.
  app.route("/", juicePublicRoutes(config));
  app.route("/", publicRoutes(config));
  app.route("/", authRoutes(config));
  app.route("/", checkoutRoutes(config));
  app.route("/", ticketRoutes(config));
  app.route("/", verifyScanRoutes(config));
  app.route("/", scanRoutes(config));
  app.route("/", staffAreaRoutes(config));
  app.route("/", adminRoutes(config));
  app.route("/", juiceStaffRoutes(config));

  app.post("/pay/notify/daraja", async (c) => {
    const raw = await c.req.text();
    const parsed = parseDarajaNotify(raw);
    if (!parsed) return c.json({ ResultCode: 1, ResultDesc: "bad payload" }, 400);
    const res = handleCallback({ provider: "daraja", raw, ...parsed });
    if (!res.ok) return c.json({ ResultCode: 1, ResultDesc: res.detail }, res.httpStatus as ContentfulStatusCode);
    return c.json({ ResultCode: 0, ResultDesc: res.detail });
  });

  return app;
}

function wantsJson(path: string): boolean {
  return path.startsWith("/api/") || path.startsWith("/staff/scan") || path.startsWith("/pay/notify");
}
