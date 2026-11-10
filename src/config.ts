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
  const nodeEnv = (env.NODE_ENV ?? "development") as AppConfig["env"];
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

  const provider = env.PAYMENT_PROVIDER === "daraja" ? "daraja" : "dev";
  const mpesaEnv = env.MPESA_ENV === "production" ? "production" : "sandbox";
  if (provider === "daraja" && nodeEnv === "production") {
    const missing = ["MPESA_SHORTCODE", "MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_PASSKEY", "MPESA_CALLBACK_BASE"].filter(
      (k) => !env[k],
    );
    if (missing.length) {
      throw new Error(
        `[config] PAYMENT_PROVIDER=daraja in production but missing required credentials: ${missing.join(", ")}. Set all five env vars or switch PAYMENT_PROVIDER=dev to use the simulator.`,
      );
    }
  }

  return {
    env: nodeEnv,
    port: Number(env.PORT ?? 8787) || 8787,
    bindHost: env.BIND_HOST ?? "127.0.0.1",
    publicOrigins: (env.PUBLIC_ORIGINS ?? "http://localhost:8787").split(",").map((s) => s.trim()).filter(Boolean),
    appSecretKey: appSecretKey.length >= 32
      ? Buffer.from(appSecretKey, "hex").length === appSecretKey.length / 2
        ? Buffer.from(appSecretKey, "hex")
        : Buffer.from(appSecretKey, "utf8")
      : Buffer.from(`dev-${Math.random()}`, "utf8"),
    databaseFile,
    paymentProvider: provider,
    paymentDevForceStatus: (env.PAYMENT_DEV_FORCE_STATUS ?? "") as AppConfig["paymentDevForceStatus"],
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

export const isDev = (c: AppConfig) => c.env === "development";
