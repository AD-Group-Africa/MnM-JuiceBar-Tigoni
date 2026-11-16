/**
 * Payment/provider configuration is fail-closed. These tests do not contact
 * Safaricom: they only validate startup configuration and adapter selection.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mnm-config-"));
const base = {
  NODE_ENV: "test",
  PAYMENT_PROVIDER: "dev",
  APP_SECRET_KEY: "test-secret-please-ignore-0123456789abcdef",
  DATABASE_FILE: path.join(tmp, "config.sqlite"),
  PUBLIC_ORIGINS: "http://localhost:8787",
};

const { loadConfig } = await import("../src/config.ts");
const { getProvider } = await import("../src/payments/index.ts");

after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

test("missing provider is rejected instead of selecting the simulator", () => {
  const { PAYMENT_PROVIDER: _ignored, ...env } = base;
  assert.throws(() => loadConfig(env), /PAYMENT_PROVIDER is required/);
});

test("unknown provider values are rejected explicitly", () => {
  assert.throws(() => loadConfig({ ...base, PAYMENT_PROVIDER: "daraja-typo" }), /Unknown PAYMENT_PROVIDER/);
  assert.throws(() => loadConfig({ ...base, PAYMENT_PROVIDER: "production" }), /Unknown PAYMENT_PROVIDER/);
});

test("production rejects the dev simulator", () => {
  assert.throws(
    () => loadConfig({ ...base, NODE_ENV: "production", PAYMENT_PROVIDER: "dev" }),
    /not allowed in production/,
  );
});

test("daraja requires all credentials even outside production", () => {
  assert.throws(
    () => loadConfig({ ...base, PAYMENT_PROVIDER: "daraja" }),
    /missing required credentials/,
  );
});

test("valid explicit dev configuration selects only the labelled simulator", () => {
  const config = loadConfig(base);
  assert.equal(config.paymentProvider, "dev");
  assert.equal(config.env, "development");
  assert.equal(getProvider(config).name, "dev-simulator");
});

test("valid development daraja configuration selects daraja and keeps sandbox explicit", () => {
  const config = loadConfig({
    ...base,
    NODE_ENV: "development",
    PAYMENT_PROVIDER: "daraja",
    MPESA_ENV: "sandbox",
    MPESA_SHORTCODE: "123456",
    MPESA_CONSUMER_KEY: "test-consumer-key",
    MPESA_CONSUMER_SECRET: "test-consumer-secret",
    MPESA_PASSKEY: "test-passkey",
    MPESA_CALLBACK_BASE: "https://example.test",
  });
  assert.equal(config.paymentProvider, "daraja");
  assert.equal(config.env, "development");
  assert.equal(config.mpesa.env, "sandbox");
  assert.equal(getProvider(config).name, "daraja");
});

// Production + MPESA_ENV=sandbox is currently accepted by src/config.ts. That is
// a known defect, not intended behaviour; it is exercised in the separate red
// suite tests/phase2a1/production-config.test.ts so this main suite cannot be
// mistaken for confirmation that production sandbox selection is safe.

test("dev-only force status cannot leak into a live provider configuration", () => {
  assert.throws(
    () => loadConfig({ ...base, PAYMENT_DEV_FORCE_STATUS: "maybe" }),
    /must be empty, 'success' or 'failure'/,
  );
  assert.throws(
    () => loadConfig({
      ...base,
      PAYMENT_PROVIDER: "daraja",
      MPESA_SHORTCODE: "123456",
      MPESA_CONSUMER_KEY: "k",
      MPESA_CONSUMER_SECRET: "s",
      MPESA_PASSKEY: "p",
      MPESA_CALLBACK_BASE: "https://example.test",
      PAYMENT_DEV_FORCE_STATUS: "success",
    }),
    /only valid with PAYMENT_PROVIDER=dev/,
  );
});
