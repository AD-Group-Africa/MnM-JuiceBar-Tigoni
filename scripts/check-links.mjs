#!/usr/bin/env node
/**
 * Link checker: crawls the app's own pages and reports any internal link that
 * does not resolve. Run against a live dev server.
 *
 *   node scripts/check-links.mjs [baseUrl]
 */
const base = process.argv[2] ?? "http://127.0.0.1:8787";

const seen = new Map();   // path -> status
const queue = ["/"];
const sources = new Map(); // path -> Set(referrer paths)

function normalise(href) {
  const u = new URL(href, base);
  if (u.origin !== new URL(base).origin) return null; // external — skipped
  return u.pathname + (u.search ? u.search : "");
}

async function get(path) {
  const res = await fetch(base + path, { redirect: "manual" });
  return { status: res.status, location: res.headers.get("location"), html: res.headers.get("content-type")?.includes("html") ? await res.text() : "" };
}

while (queue.length) {
  const path = queue.shift();
  if (seen.has(path)) continue;
  const r = await get(path);
  seen.set(path, r.status);
  if (r.status >= 300 && r.status < 400 && r.location) {
    const t = normalise(r.location);
    if (t && !seen.has(t)) queue.push(t);
    continue;
  }
  if (!r.html) continue;
  for (const m of r.html.matchAll(/href="([^"]+)"/g)) {
    const t = normalise(m[1]);
    if (!t) continue;
    if (!sources.has(t)) sources.set(t, new Set());
    sources.get(t).add(path);
    if (!seen.has(t) && !queue.includes(t)) queue.push(t);
  }
}

const broken = [...seen.entries()].filter(([, s]) => s >= 400);
console.log(`[links] checked ${seen.size} internal URL(s) from ${base}`);
if (broken.length === 0) {
  console.log("[links] OK — no broken internal links.");
} else {
  console.log(`[links] ${broken.length} BROKEN:`);
  for (const [p, s] of broken) {
    const refs = [...(sources.get(p) ?? [])].join(", ");
    console.log(`  ${s}  ${p}   (linked from: ${refs || "n/a"})`);
  }
  process.exitCode = 1;
}
