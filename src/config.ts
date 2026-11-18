/**
 * Application configuration read from environment variables (+ optional .env file).
 * Validated once at startup. See .env.example for the documented contract.
 */
import fs from "node:fs";
import path from "node:path";

export interface AppConfig {
  env: "development" | "production";
  port: number;
  bindHost: string;
  publicOrigins: string[];
  appSecretKey: Buffer;
  databaseFile: string;
  paymentProvider: "dev" | "daraja";
  paymentDevForceStatus: "" | "success" | "failure";
  mpesa: {
    env: "sandbox" | "production";
    shortcode: string;
    consumerKey: string;
    consumerSecret: string;
    passkey: string;
    callbackBase: string;
  };
  notify: {
    emailProvider: "console";
    smsProvider: "console";
    notifyFrom: string;
  };
}

/** Minimal .env loader (KEY=VALUE lines, # comments). Real env vars win. */
function loadDotEnv(): void {
  const p = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1]!;
    let val = m[2]!.trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  loadDotEnv();
  const rawNodeEnv = (env.NODE_ENV ?? "development").trim().toLowerCase();
  if (!["development", "test", "production"].includes(rawNodeEnv)) {
    throw new Error(`[config] NODE_ENV must be development, test or production; got "${rawNodeEnv}".`);
  }
  const nodeEnv: AppConfig["env"] = rawNodeEnv === "production" ? "production" : "development";
  const isProduction = rawNodeEnv === "production";
  const appSecretKey = env.APP_SECRET_KEY ?? "";
  if (appSecretKey.length < 32 || /^(change-me|dev-secret)/i.test(appSecretKey)) {
    if (nodeEnv === "production") {
      throw new Error(
        "APP_SECRET_KEY is missing or a placeholder value. In production it must be a 32-byte+ random hex secret.",
      );
    }
    console.warn("[config] APP_SECRET_KEY missing — using a throwaway development secret (DEV ONLY).");
  }
  const databaseFile = env.DATABASE_FILE ?? "data/mnm-dev.sqlite";
  fs.mkdirSync(path.dirname(path.resolve(databaseFile)), { recursive: true });

  // Local development is reached through several equivalent loopback names
  // (localhost, 127.0.0.1, [::1]). The Origin check compares exact hosts, so a
  // browser opened at http://127.0.0.1:8787 used to be rejected as "invalid
  // request origin" when PUBLIC_ORIGINS only listed http://localhost:8787.
  // Expand loopback aliases outside production; production stays exact.
  const configuredOrigins = (env.PUBLIC_ORIGINS ?? "http://localhost:8787")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const publicOrigins = nodeEnv === "production"
    ? configuredOrigins
    : withLoopbackAliases(configuredOrigins);

  // Payment selection is deliberately explicit and fail-closed. A missing or
  // misspelled value must never silently select the development simulator.
  const rawProvider = (env.PAYMENT_PROVIDER ?? "").trim().toLowerCase();
  if (!rawProvider) {
    throw new Error("[config] PAYMENT_PROVIDER is required. Use 'dev' only for local simulation or 'daraja' for live M-Pesa.");
  }
  if (rawProvider !== "dev" && rawProvider !== "daraja") {
    throw new Error(`[config] Unknown PAYMENT_PROVIDER "${rawProvider}". Expected 'dev' or 'daraja'.`);
  }
  const provider: AppConfig["paymentProvider"] = rawProvider;
  if (isProduction && provider !== "daraja") {
    throw new Error("[config] PAYMENT_PROVIDER=dev is not allowed in production. Configure 'daraja' with live credentials.");
  }

  const rawMpesaEnv = (env.MPESA_ENV ?? "sandbox").trim().toLowerCase();
  if (rawMpesaEnv !== "sandbox" && rawMpesaEnv !== "production") {
    throw new Error(`[config] MPESA_ENV must be 'sandbox' or 'production'; got "${rawMpesaEnv}".`);
  }
  const mpesaEnv = rawMpesaEnv;
  if (provider === "daraja") {
    const missing = ["MPESA_SHORTCODE", "MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_PASSKEY", "MPESA_CALLBACK_BASE"].filter(
      (k) => !env[k],
    );
    if (missing.length) {
      throw new Error(
        `[config] PAYMENT_PROVIDER=daraja but missing required credentials: ${missing.join(", ")}. Set all five env vars or explicitly use PAYMENT_PROVIDER=dev for local simulation.`,
      );
    }
    if (isProduction && mpesaEnv !== "production") {
      throw new Error("[config] MPESA_ENV=sandbox is not allowed in production. Set MPESA_ENV=production with live Daraja credentials.");
    }
    if (isProduction) {
      const callbackBase = String(env.MPESA_CALLBACK_BASE ?? "").trim();
      if (!/^https:\/\//i.test(callbackBase) || /(^|\/\/)(localhost|127\.0\.0\.1|\[::1\])(:|\(\/|$)/i.test(callbackBase)) {
        throw new Error("[config] MPESA_CALLBACK_BASE must be a public HTTPS URL in production.");
      }
    }
  }
  const forceRaw = (env.PAYMENT_DEV_FORCE_STATUS ?? "").trim().toLowerCase();
  if (forceRaw && forceRaw !== "success" && forceRaw !== "failure") {
    throw new Error(`[config] PAYMENT_DEV_FORCE_STATUS must be empty, 'success' or 'failure'; got "${forceRaw}".`);
  }
  if (provider !== "dev" && forceRaw) {
    throw new Error("[config] PAYMENT_DEV_FORCE_STATUS is only valid with PAYMENT_PROVIDER=dev.");
  }

  return {
    env: nodeEnv,
    port: Number(env.PORT ?? 8787) || 8787,
    bindHost: env.BIND_HOST ?? "127.0.0.1",
    publicOrigins,
    appSecretKey: appSecretKey.length >= 32
      ? Buffer.from(appSecretKey, "hex").length === appSecretKey.length / 2
        ? Buffer.from(appSecretKey, "hex")
        : Buffer.from(appSecretKey, "utf8")
      : Buffer.from(`dev-${Math.random()}`, "utf8"),
    databaseFile,
    paymentProvider: provider,
    paymentDevForceStatus: forceRaw as AppConfig["paymentDevForceStatus"],
    mpesa: {
      env: mpesaEnv,
      shortcode: env.MPESA_SHORTCODE ?? "",
      consumerKey: env.MPESA_CONSUMER_KEY ?? "",
      consumerSecret: env.MPESA_CONSUMER_SECRET ?? "",
      passkey: env.MPESA_PASSKEY ?? "",
      callbackBase: env.MPESA_CALLBACK_BASE ?? "",
    },
    notify: {
      emailProvider: "console",
      smsProvider: "console",
      notifyFrom: env.NOTIFY_FROM ?? "tickets@localhost",
    },
  };
}

/** Add localhost/127.0.0.1/[::1] equivalents for any loopback origin (dev only). */
function withLoopbackAliases(origins: string[]): string[] {
  const out = new Set(origins);
  for (const entry of origins) {
    try {
      const u = new URL(entry);
      if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname)) continue;
      for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
        const alias = new URL(entry);
        alias.hostname = host;
        out.add(alias.origin);
      }
    } catch {
      // Ignore malformed entries; loadConfig already surfaces usable defaults.
    }
  }
  return [...out];
}

export const isDev = (c: AppConfig) => c.env === "development";
