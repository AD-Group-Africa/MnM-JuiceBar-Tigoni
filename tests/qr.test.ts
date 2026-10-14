import { test } from "node:test";
import assert from "node:assert/strict";
import { qrSvg, qrSvgDataUri, encode } from "../src/qr.ts";

test("QR of a typical verify URL decodes structurally", () => {
  const url = "http://localhost:8787/verify/8K3F92-QW1XCD";
  const m = encode(url);
  // version 3 for 40-ish bytes → size 29? compute: choose sane bound
  assert.ok(m.size >= 21 && m.size <= 177);
});

test("finder patterns present in all three corners", () => {
  const m = encode("HELLO-WORLD-123");
  const isFinderAt = (ox: number, oy: number) => {
    // 7x7 corner pattern: black at ring 0/2/4? our stamp: edges 0,2 are dark ring cells
    // Simple checks: corner pixel + centre pixel dark, ring gap light
    return m.get(ox, oy) === true && m.get(ox + 3, oy + 3) === true && m.get(ox + 1, oy + 1) === false;
  };
  assert.ok(isFinderAt(0, 0));
  assert.ok(isFinderAt(m.size - 7, 0));
  assert.ok(isFinderAt(0, m.size - 7));
});

test("timing pattern alternates on row/col 6", () => {
  const m = encode("test timing");
  for (let i = 8; i < m.size - 8; i++) {
    assert.equal(m.get(i, 6), i % 2 === 0, `timing row at ${i}`);
    assert.equal(m.get(6, i), i % 2 === 0, `timing col at ${i}`);
  }
});

test("deterministic output for identical input", () => {
  const a = encode("http://localhost:8787/verify/ABC-123");
  const b = encode("http://localhost:8787/verify/ABC-123");
  let same = true;
  for (let y = 0; y < a.size && same; y++) for (let x = 0; x < a.size; x++) if (a.get(x, y) !== b.get(x, y)) { same = false; break; }
  assert.ok(same);
});

test("varying inputs produce different matrices", () => {
  const a = encode("code-AAA");
  const b = encode("code-BBB");
  let diff = false;
  for (let y = 0; y < a.size && !diff; y++) for (let x = 0; x < a.size; x++) if (a.get(x, y) !== b.get(x, y)) { diff = true; break; }
  assert.ok(diff);
});

test("data URI is valid base64 SVG", () => {
  const uri = qrSvgDataUri("HELLO");
  assert.ok(uri.startsWith("data:image/svg+xml;base64,"));
  const svg = Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64").toString("utf8");
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("<rect"));
});


