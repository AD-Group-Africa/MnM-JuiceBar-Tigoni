/**
 * Security hardening checks: response headers, storage-aware health output,
 * rate limiting and the existing CSRF origin rule.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mnm-security-"));
const databaseFile = path.join(tmp, "security.sqlite");
process.env.DATABASE_FILE = databaseFile;

const { migrate } = await import("../src/db.ts");
const { createApp } = await import("../src/app.tsx");
const { loadConfig } = await import("../src/config.ts");
const { consumeRateLimit, resetRateLimitsForTests } = await import("../src/ratelimit.ts");

const origin = "https://security.example.test";
const config = loadConfig({
  NODE_ENV: "production",
  PAYMENT_PROVIDER: "disabled",
  APP_SECRET_KEY: "security-suite-secret-0123456789abcdef",
  DATABASE_FILE: databaseFile,
  PUBLIC_ORIGINS: origin,
});

const app = createApp(config);

before(() => {
  migrate(databaseFile);
});

after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function req(pathname: string, init?: RequestInit): Promise<Response> {
  return app.request(new URL(pathname, origin).toString(), init);
}

test("security headers deny framing and restrict dangerous capabilities", async () => {
  const res = await req("/health");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("referrer-policy"), "same-origin");
  assert.match(res.headers.get("permissions-policy") ?? "", /camera=\(self\)/);
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /form-action 'self'/);
  assert.ok(res.headers.get("strict-transport-security"));
});

test("health reports database readiness and a path-free storage mode", async () => {
  const res = await req("/health");
  const body = await res.json() as {
    ok: boolean;
    database: string;
    storage: { mode: string; persistent: boolean };
  };
  assert.equal(body.ok, true);
  assert.equal(body.database, "ok");
  assert.equal(body.storage.mode, "ephemeral-risk");
  assert.equal(body.storage.persistent, false);
  assert.doesNotMatch(JSON.stringify(body), /security\.sqlite/);
});

test("fixed-window limiter allows the limit, blocks the next hit and resets later", () => {
  resetRateLimitsForTests();
  const first = consumeRateLimit("unit", "k", 2, 1000, 1_000);
  const second = consumeRateLimit("unit", "k", 2, 1000, 1_000);
  const third = consumeRateLimit("unit", "k", 2, 1000, 1_000);
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.ok(third.retryAfterSeconds >= 1);
  const afterWindow = consumeRateLimit("unit", "k", 2, 1000, 2_001);
  assert.equal(afterWindow.allowed, true);
});

test("order lookup returns 429 with Retry-After once the limit is exceeded", async () => {
  resetRateLimitsForTests();
  let limited: Response | null = null;
  for (let i = 0; i < 21; i++) {
    const res = await req("/juice/order/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
      body: new URLSearchParams({ ref: "MNM-J-NOPE", phone: "0712345678" }),
    });
    if (res.status === 429) {
      limited = res;
      break;
    }
  }
  assert.ok(limited, "the 21st lookup must be rate limited");
  assert.ok(Number(limited!.headers.get("retry-after")) > 0);
});

test("a foreign origin is still rejected when a request is rate-limited", async () => {
  resetRateLimitsForTests();
  const res = await req("/juice/order/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://evil.example" },
    body: new URLSearchParams({ ref: "MNM-J-NOPE", phone: "0712345678" }),
  });
  assert.equal(res.status, 403);
});
