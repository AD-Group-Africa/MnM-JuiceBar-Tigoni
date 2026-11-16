/**
 * Phase 2A.1 — production sandbox rejection (known-defect suite).
 *
 * No provider calls: these are pure loadConfig() checks. The production +
 * sandbox case is expected to FAIL until src/config.ts enforces production
 * MPESA_ENV. The other cases record the fail-closed contract that already works.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mnm-p2a1-config-"));
const base = {
  NODE_ENV: "test",
  PAYMENT_PROVIDER: "dev",
  APP_SECRET_KEY: "phase2a1-config-secret-0123456789abcdef",
  DATABASE_FILE: path.join(tmp, "config.sqlite"),
  PUBLIC_ORIGINS: "http://localhost:8787",
};
const daraja = {
  ...base,
  PAYMENT_PROVIDER: "daraja",
  MPESA_ENV: "sandbox",
  MPESA_SHORTCODE: "123456",
  MPESA_CONSUMER_KEY: "test-consumer-key",
  MPESA_CONSUMER_SECRET: "test-consumer-secret",
  MPESA_PASSKEY: "test-passkey",
  MPESA_CALLBACK_BASE: "https://example.test",
};

const { loadConfig } = await import("../../src/config.ts");

after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

test("production + MPESA_ENV=sandbox must fail configuration", () => {
  assert.throws(
    () => loadConfig({ ...daraja, NODE_ENV: "production", MPESA_ENV: "sandbox" }),
    /sandbox|production/i,
    "production must never point at Safaricom sandbox",
  );
});

test("production + missing MPESA_ENV must not silently default to sandbox", () => {
  const { MPESA_ENV: _ignored, ...env } = daraja;
  assert.throws(
    () => loadConfig({ ...env, NODE_ENV: "production" }),
    /MPESA_ENV|sandbox|production/i,
    "the implicit sandbox default must not be accepted in production",
  );
});

test("production + missing Daraja credentials fails closed", () => {
  assert.throws(
    () => loadConfig({ ...base, NODE_ENV: "production", PAYMENT_PROVIDER: "daraja" }),
    /missing required credentials/,
  );
});

test("unknown provider values are rejected", () => {
  assert.throws(() => loadConfig({ ...base, PAYMENT_PROVIDER: "daraja-typo" }), /Unknown PAYMENT_PROVIDER/);
});

test("unknown MPESA_ENV values are rejected", () => {
  assert.throws(
    () => loadConfig({ ...daraja, MPESA_ENV: "staging" }),
    /MPESA_ENV must be 'sandbox' or 'production'/,
  );
});

test("development/test sandbox configuration remains possible", () => {
  const config = loadConfig({ ...daraja, NODE_ENV: "test", MPESA_ENV: "sandbox" });
  assert.equal(config.paymentProvider, "daraja");
  assert.equal(config.mpesa.env, "sandbox");
});

test("production never falls back to the simulator", () => {
  assert.throws(
    () => loadConfig({ ...base, NODE_ENV: "production", PAYMENT_PROVIDER: "dev" }),
    /not allowed in production/,
  );
});

test("valid production Daraja configuration is accepted", () => {
  const config = loadConfig({ ...daraja, NODE_ENV: "production", MPESA_ENV: "production" });
  assert.equal(config.paymentProvider, "daraja");
  assert.equal(config.mpesa.env, "production");
});

test("configuration checks make no provider network call", () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("network call forbidden"); }) as typeof fetch;
  try {
    loadConfig({ ...daraja, NODE_ENV: "test", MPESA_ENV: "sandbox" });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
