/**
 * GF(256) arithmetic (QR codes use alpha = 2 primitive polynomial 0x11D) plus the
 * Reed–Solomon and BCH helpers used by the QR encoder. Pure lookup tables,
 * generated deterministically on first use (no randomness).
 */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

const PRIM = 0x11D;

(function init(): void {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= PRIM;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();

export function gmul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

export const galois = {
  exp: (i: number): number => EXP[i & 511]!,
  log: (a: number): number => LOG[a]!,
  mul: gmul,

  /**
   * Reed–Solomon generator polynomial for ecLen error-correction codewords:
   * g(x) = ∏ (x - α^i) for i = 0..ecLen-1, represented as coefficient arrays.
   */
  generatorFor(ecLen: number): number[] {
    let poly = [1]; // g(x) = 1
    for (let i = 0; i < ecLen; i++) {
      // multiply poly by (x - α^i) == (x + α^i) in GF(2^8)
      const factorRoot = EXP[i]!;
      const next: number[] = new Array<number>(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] = next[j]! ^ poly[j]!;                        // x * term
        next[j + 1] = next[j + 1]! ^ gmul(poly[j]!, factorRoot);  // α^i * term
      }
      poly = next;
    }
    return poly; // highest degree first? — no: index 0 = highest degree
  },

  /**
   * Remainder of data polynomial under generator (RS parity computation),
   * standard synthetic division. Input: data (highest-degree first, appended
   * with ecLen zeros by caller if desired). Returns ecLen parity codewords.
   */
  polynomialRemainder(data: number[], gen: number[]): number[] {
    const ecLen = gen.length - 1;
    const buf = data.slice();
    buf.push(...new Array(ecLen).fill(0));
    for (let i = 0; i < data.length; i++) {
      const factor = buf[i]!;
      if (factor !== 0) {
        for (let j = 1; j < gen.length; j++) {
          buf[i + j]! ^= gmul(gen[j]!, factor);
        }
      }
      buf[i] = 0;
    }
    return buf.slice(data.length); // parity codewords, highest-degree first
  },

  /** BCH remainder used for QR format information (15-bit BCH over data<<10). */
  bchRemainder(data: number): number {
    const G = 0b10100110111; // format generator polynomial
    let reg = data << 10;
    for (let i = 14; i >= 10; i--) {
      if ((reg >> i) & 1) reg ^= G << (i - 10);
    }
    return reg & 0x3FF;
  },
};

void 0;
