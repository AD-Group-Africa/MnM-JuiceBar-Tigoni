/**
 * In-memory fixed-window rate limiter.
 *
 * Scope: one Node process. The service runs a single instance against a single
 * SQLite file, so an in-memory counter is effective. A future multi-instance
 * deployment must move these counters to shared storage (or the platform edge).
 *
 * Limits are deliberately generous enough for real customers on shared mobile
 * networks (carrier NAT puts many people behind one IPv4 address) while still
 * stopping automated abuse. A blocked request gets HTTP 429 and Retry-After.
 */
import type { Context, MiddlewareHandler } from "hono";

interface Bucket {
  n: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 20_000;

/** First hop of X-Forwarded-For (Render's proxy), else the socket address. */
export function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return c.req.header("x-real-ip")?.trim() || "local";
}

function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: number;
}

/** Record one hit against `name:key` and report whether it is allowed. */
export function consumeRateLimit(
  name: string,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  const bucketKey = `${name}:${key}`;
  if (buckets.size > MAX_TRACKED_KEYS) prune(now);
  let bucket = buckets.get(bucketKey);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { n: 0, resetAt: now + windowMs };
    buckets.set(bucketKey, bucket);
  }
  bucket.n += 1;
  const allowed = bucket.n <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - bucket.n),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    resetAt: bucket.resetAt,
  };
}

/** Test helper: clear every counter so suites do not bleed into each other. */
export function resetRateLimitsForTests(): void {
  buckets.clear();
}

export interface RateLimitOptions {
  /** Stable bucket name, e.g. "checkout". */
  name: string;
  limit: number;
  windowMs: number;
  /** Key within the bucket; defaults to the client IP. */
  key?: (c: Context) => string;
}

/**
 * Middleware. Apply it only to the routes that need protection — never to
 * static assets or ordinary page views.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    const key = opts.key ? opts.key(c) : clientIp(c);
    const result = consumeRateLimit(opts.name, key, opts.limit, opts.windowMs);
    c.header("X-RateLimit-Limit", String(opts.limit));
    c.header("X-RateLimit-Remaining", String(result.remaining));
    if (!result.allowed) {
      c.header("Retry-After", String(result.retryAfterSeconds));
      console.warn(`[security] rate limit hit for ${opts.name} (retry in ${result.retryAfterSeconds}s)`);
      return c.text("Too many requests. Please wait a few minutes and try again.", 429);
    }
    await next();
  };
}
