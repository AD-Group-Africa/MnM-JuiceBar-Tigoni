/**
 * CENTRAL COMMISSION ENGINE — the single source of truth for MnM Tickets commercial terms.
 *
 * Business model (proposed — see docs/PRICING_AND_COMMISSIONS.md):
 *   P = original ticket price (integer minor units; KES minor unit = cent, 1 KES = 100).
 *   M = MnM gross commission                     = 25 percentage points of P.
 *   A = Afrika Digitalis gross platform fee      = 10 percentage points of P.
 *   S = customer selling price                   = P + M + A  (exactly 135% of P).
 *
 * Example for an original price of KSh 1,000 (100_000 cents):
 *   P = 100_000, M = 25_000 (KSh 250), A = 10_000 (KSh 100), S = 135_000 (KSh 1,350).
 *
 * Design rules (tested in tests/money.test.ts):
 *   1. All money arithmetic in integer minor units — floating point is never used.
 *   2. Rounding is deterministic round-half-up, applied per component/per ticket.
 *   3. S = P + M + A holds exactly; S is derived by summation, never rounded separately.
 *   4. Rates are integer percentage points (of 10_000). Client requests can never
 *      change a rate or price — authorised staff enter ORIGINAL prices only.
 */

export type Minor = number; // integer minor currency units (never floats)

export interface CommissionRates {
  /** Markup points of original price, 3500 = 35%. */
  readonly markupPoints: number;
  /** MnM share of original price, 2500 = 25%. */
  readonly mnmPoints: number;
  /** AD platform share of original price, 1000 = 10%. */
  readonly adPoints: number;
  readonly currency: string;
}

/** Agreed launch terms: 35% markup, split 25 (MnM) + 10 (AD), priced in KES. */
export const LAUNCH_TERMS: CommissionRates = Object.freeze({
  markupPoints: 3500,
  mnmPoints: 2500,
  adPoints: 1000,
  currency: "KES",
});

export interface PriceSplit {
  /** Original ticket price (minor units). */
  original: Minor;
  /** MnM gross commission. */
  mnm: Minor;
  /** AD platform gross commission. */
  ad: Minor;
  /** Customer selling price = original + mnm + ad. */
  selling: Minor;
  currency: string;
}

function assertPoints(points: number, name: string): void {
  if (!Number.isInteger(points) || points < 0 || points > 10_000) {
    throw new Error(`${name} must be an integer in 0..10000, got ${points}`);
  }
}

/** round(p * points / 10_000), deterministic round-half-up, exact integer math. */
export function roundPoints(p: Minor, points: number): Minor {
  if (!Number.isInteger(p) || p < 0) throw new Error(`price must be a non-negative integer minor unit, got ${p}`);
  assertPoints(points, "points");
  // BigInt avoids precision loss for large values; +5_000 then truncation = half-up.
  return Number((BigInt(p) * BigInt(points) + BigInt(5_000)) / BigInt(10_000));
}

/** Full price split for ONE ticket under the given commercial terms. */
export function priceSplit(original: Minor, terms: CommissionRates = LAUNCH_TERMS): PriceSplit {
  assertPoints(terms.mnmPoints, "mnmPoints");
  assertPoints(terms.adPoints, "adPoints");
  assertPoints(terms.markupPoints, "markupPoints");
  if (terms.mnmPoints + terms.adPoints !== terms.markupPoints) {
    throw new Error("inconsistent terms: mnmPoints + adPoints must equal markupPoints");
  }
  const mnm = roundPoints(original, terms.mnmPoints);
  const ad = roundPoints(original, terms.adPoints);
  const selling = original + mnm + ad;
  return { original, mnm, ad, selling, currency: terms.currency };
}

/** Aggregated split for qty tickets of unit price `original` (per-ticket rounding, then sum). */
export function priceSplitForQty(original: Minor, qty: number, terms: CommissionRates = LAUNCH_TERMS): PriceSplit {
  if (!Number.isInteger(qty) || qty < 1 || qty > 100) throw new Error(`invalid ticket quantity ${qty}`);
  const unit = priceSplit(original, terms);
  return {
    original: unit.original * qty,
    mnm: unit.mnm * qty,
    ad: unit.ad * qty,
    selling: unit.selling * qty,
    currency: unit.currency,
  };
}

/** Format minor units as an ISO-style human string, e.g. 135000 -> "KSh 1,350.00". */
export function formatMinor(minor: Minor, currency: string): string {
  if (!Number.isInteger(minor) || minor < 0) throw new Error(`invalid minor amount ${minor}`);
  const units = Math.floor(minor / 100);
  const cents = minor % 100;
  return `${currency === "KES" ? "KSh" : currency} ${units.toLocaleString("en-KE")}.${String(cents).padStart(2, "0")}`;
}
