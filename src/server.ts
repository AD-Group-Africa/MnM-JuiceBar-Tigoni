/**
 * MnM Tickets server entry (Hono + @hono/node-server).
 * Assembles middleware, routes and static assets; starts the HTTP listener
 * when executed directly. Exported createApp() is reused by integration tests.
 */
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { loadConfig } from "./config.ts";
import { closeDb, migrate } from "./db.ts";
import { reconcileSoldCounts } from "./orders.ts";
import { createApp } from "./app.tsx";
import { assessStorage, enforceStoragePolicy, PersistenceError } from "./persistence.ts";

const config = loadConfig();

// Production persistence guard. A relative database path on a container host is
// silently wiped by the next deploy; surface that before migrations run. It is
// fatal only when the owner opts in with DATABASE_REQUIRE_PERSISTENT=1, because
// taking a working storefront offline is itself a business risk.
const storage = assessStorage(config.databaseFile, { production: config.env === "production" });
try {
  enforceStoragePolicy(storage);
} catch (err) {
  if (err instanceof PersistenceError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

migrate(config.databaseFile);
const reconciled = reconcileSoldCounts();
if (reconciled.updated) console.log(`[orders] reconciled sold_count for ${reconciled.updated} ticket category/categories`);
if (reconciled.failed) console.warn(`[orders] ${reconciled.failed} ticket category/categories could not be reconciled`);

const app = createApp(config);
app.use("*", serveStatic({ root: "./public" }));

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.bindHost }, (info) => {
  const host = info.address?.includes(":") ? `[${info.address}]` : info.address;
  console.log(
    `[mnm-tickets] listening on http://${host}:${info.port} (env=${config.env}, payments=${config.paymentProvider}, storage=${storage.mode})`,
  );
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[mnm-tickets] ${sig} received; shutting down.`);
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    setTimeout(() => {
      closeDb();
      process.exit(0);
    }, 3_000).unref();
  });
}
