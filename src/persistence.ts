/**
 * Production database persistence guard.
 *
 * SQLite is a file. On a platform that recreates the application directory on
 * every deploy (Render without a mounted disk, most container hosts), a file at
 * a relative path such as `data/mnm-dev.sqlite` is silently discarded whenever
 * the service redeploys, restarts or spins down from idle. Every order, ticket
 * and customer account written there is lost.
 *
 * This module classifies the configured location without touching data:
 *
 *   persistent-configured  DATABASE_FILE is inside the declared persistent root
 *                          (default /var/data — a Render disk mount).
 *   ephemeral-risk         A relative path, the development default, or a
 *                          temporary directory. Data will be lost on restart.
 *   unverified             An absolute path outside the declared root; it may be
 *                          persistent, but this code cannot prove it.
 *   development            Non-production; persistence is not a deployment claim.
 *
 * The default policy is to warn loudly and keep serving, because a boot refusal
 * on an already-running service would take the storefront offline. Setting
 * `DATABASE_REQUIRE_PERSISTENT=1` upgrades the warning to a startup failure for
 * owners who prefer a dead service over silent data loss.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type StorageMode = "persistent-configured" | "ephemeral-risk" | "unverified" | "development";

export interface StorageAssessment {
  mode: StorageMode;
  /** Absolute resolved path — for operator logs only, never for public output. */
  databasePath: string;
  directory: string;
  exists: boolean;
  sizeBytes: number;
  writable: boolean;
  /** DATABASE_REQUIRE_PERSISTENT=1 turns a non-persistent location into a boot failure. */
  strict: boolean;
  reasons: string[];
}

const DEFAULT_DB_FILE = "data/mnm-dev.sqlite";

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isTempPath(target: string): boolean {
  return isInside(target, os.tmpdir());
}

/** Assess the configured database location. Pure inspection; creates no data. */
export function assessStorage(
  databaseFile: string,
  opts: { production: boolean; env?: NodeJS.ProcessEnv } = { production: false },
): StorageAssessment {
  const env = opts.env ?? process.env;
  const resolved = path.resolve(databaseFile);
  const directory = path.dirname(resolved);
  const exists = fs.existsSync(resolved);
  let sizeBytes = 0;
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      sizeBytes += fs.statSync(`${resolved}${suffix}`).size;
    } catch {
      // Missing sidecar files are normal.
    }
  }
  let writable = true;
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.accessSync(directory, fs.constants.W_OK);
  } catch {
    writable = false;
  }

  const strict = /^(1|true|yes)$/i.test(String(env.DATABASE_REQUIRE_PERSISTENT ?? "").trim());
  const persistentRoot = String(env.DATABASE_PERSISTENT_ROOT ?? "/var/data").trim() || "/var/data";
  const relativeConfigured = !path.isAbsolute(databaseFile);
  const usingDevelopmentDefault = path.resolve(databaseFile) === path.resolve(DEFAULT_DB_FILE);
  const reasons: string[] = [];

  let mode: StorageMode;
  if (!opts.production) {
    mode = "development";
    reasons.push("NODE_ENV is not production; persistence is not a deployment claim.");
  } else if (isInside(resolved, persistentRoot)) {
    mode = "persistent-configured";
    reasons.push(`DATABASE_FILE is inside the persistent root ${persistentRoot}.`);
  } else {
    mode = "ephemeral-risk";
    if (relativeConfigured) reasons.push("DATABASE_FILE is a relative path inside the application directory.");
    if (usingDevelopmentDefault) reasons.push(`DATABASE_FILE is the development default (${DEFAULT_DB_FILE}).`);
    if (isTempPath(resolved)) reasons.push("DATABASE_FILE resolves inside the operating-system temporary directory.");
    if (!relativeConfigured && !usingDevelopmentDefault && !isTempPath(resolved)) {
      mode = "unverified";
      reasons.length = 0;
      reasons.push(`DATABASE_FILE is absolute but outside the declared persistent root ${persistentRoot}.`);
    }
    reasons.push("On a host without a mounted disk this file is discarded on deploy, restart or idle spin-down.");
  }
  if (!writable) reasons.push("The database directory is not writable by this process.");

  return { mode, databasePath: resolved, directory, exists, sizeBytes, writable, strict, reasons };
}

export class PersistenceError extends Error {}

/**
 * Log the assessment and apply the configured policy. Returns the assessment.
 * Throws only when DATABASE_REQUIRE_PERSISTENT is set and storage is not proven
 * persistent — never because of a warning alone.
 */
export function enforceStoragePolicy(assessment: StorageAssessment, log: Pick<Console, "warn" | "log"> = console): StorageAssessment {
  const { mode, databasePath } = assessment;
  if (mode === "persistent-configured") {
    log.log(`[storage] database at ${databasePath} (persistent root confirmed; ${assessment.sizeBytes} bytes on disk)`);
    return assessment;
  }
  const detail = assessment.reasons.map((r) => `  - ${r}`).join("\n");
  if (mode === "development") return assessment;
  if (assessment.strict) {
    throw new PersistenceError(
      `[storage] DATABASE_REQUIRE_PERSISTENT=1 but the database location is "${mode}" (${databasePath}).\n${detail}\n` +
        "Mount a persistent disk and set DATABASE_FILE to a file inside it before deploying.",
    );
  }
  log.warn(
    `[storage] WARNING: database storage is "${mode}" (${databasePath}).\n${detail}\n` +
      "  Existing records WILL be lost on the next deploy, restart or idle spin-down.\n" +
      "  Set DATABASE_FILE to a file on a mounted persistent disk (/var/data/mnm.sqlite on Render) " +
      "after taking a verified backup (npm run db:backup). Set DATABASE_REQUIRE_PERSISTENT=1 to make this fatal.",
  );
  return assessment;
}

/** Public, path-free storage summary for /health. */
export function storageHealth(assessment: StorageAssessment): {
  mode: StorageMode;
  persistent: boolean;
  strict: boolean;
  sizeBytes: number;
} {
  return {
    mode: assessment.mode,
    persistent: assessment.mode === "persistent-configured",
    strict: assessment.strict,
    sizeBytes: assessment.sizeBytes,
  };
}
