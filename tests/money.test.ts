import { test } from "node:test";
import assert from "node:assert/strict";
import { LAUNCH_TERMS, priceSplit, priceSplitForQty, roundPoints, formatMinor } from "../src/money.ts";

test("KSh 1,000 original → 250 MnM + 100 AD + 1,350 selling (spec example)", () => {
  const s = priceSplit(100_000);
  assert.equal(s.original, 100_000);
  assert.equal(s.mnm, 25_000);
  assert.equal(s.ad, 10_000);
  assert.equal(s.selling, 135_000);
  assert.equal(s.selling, s.original + s.mnm + s.ad);
});

test("identity S = P + M + A holds for arbitrary prices", () => {
  for (const p of [1, 2, 3, 5, 7, 137, 49_999, 123_456, 9_999_999]) {
    const s = priceSplit(p);
    assert.equal(s.selling, p + s.mnm + s.ad, `p=${p}`);
    assert.equal(s.mnm, roundPoints(p, 2500));
    assert.equal(s.ad, roundPoints(p, 1000));
  }
});

test("rounding is deterministic round-half-up", () => {
  // 3 * 25% = 0.75 → 1 (half-up)
  assert.equal(roundPoints(3, 2500), 1);
  // 4 * 10% = 0.4 → 0
  assert.equal(roundPoints(4, 1000), 0);
  // 100 * 10% = 10 exactly
  assert.equal(roundPoints(100, 1000), 10);
});

test("integer-only: 1 cent prices behave", () => {
  const s = priceSplit(1);
  assert.equal(s.mnm, 0);
  assert.equal(s.ad, 0);
  assert.equal(s.selling, 1);
});

test("qty aggregation is per-ticket rounded then summed", () => {
  const s = priceSplitForQty(1, 3);
  assert.equal(s.mnm, 0);
  assert.equal(s.selling, 3);
  const s2 = priceSplitForQty(100_000, 2);
  assert.equal(s2.selling, 270_000);
});

test("terms validation rejects inconsistent or bad input", () => {
  assert.throws(() => priceSplit(100_000, { markupPoints: 3500, mnmPoints: 2600, adPoints: 1000, currency: "KES" }));
  assert.throws(() => priceSplit(100_000, { markupPoints: 3500, mnmPoints: 2500, adPoints: 900, currency: "KES" }));
  assert.throws(() => priceSplit(-1));
  assert.throws(() => roundPoints(100, 10001));
  assert.throws(() => roundPoints(100, -1));
});

test("formatMinor renders KSh correctly", () => {
  assert.equal(formatMinor(135_000, "KES"), "KSh 1,350.00");
  assert.equal(formatMinor(1, "KES"), "KSh 0.01");
  assert.equal(formatMinor(675_00, "KES"), "KSh 675.00");
});

test("launch terms are frozen and correct", () => {
  assert.deepEqual({ ...LAUNCH_TERMS }, { markupPoints: 3500, mnmPoints: 2500, adPoints: 1000, currency: "KES" });
  assert.throws(() => { (LAUNCH_TERMS as { mnmPoints: number }).mnmPoints = 999; });
});
