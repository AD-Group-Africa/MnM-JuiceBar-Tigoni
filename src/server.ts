/**
 * MnM Tickets server entry (Hono + @hono/node-server).
 * Assembles middleware, routes and static assets; starts the HTTP listener
 * when executed directly. Exported createApp() is reused by integration tests.
 */
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { loadConfig } from "./config.ts";
import { migrate } from "./db.ts";
import { createApp } from "./app.tsx";

const config = loadConfig();
migrate(config.databaseFile);

const app = createApp(config);
app.use("*", serveStatic({ root: "./public" }));

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.bindHost }, (info) => {
  const host = info.address?.includes(":") ? `[${info.address}]` : info.address;
  console.log(
    `[mnm-tickets] listening on http://${host}:${info.port} (env=${config.env}, payments=${config.paymentProvider})`,
  );
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[mnm-tickets] ${sig} received; shutting down.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3_000).unref();
  });
}
