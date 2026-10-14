/**
 * Minimal dependency-free QR encoder (byte mode, ECC level M, versions 1–10).
 * Tables are the authoritative ISO/IEC 18004 values (verified against the
 * Thonky QR tutorial and Nayuki's independent implementation). Produces SVG /
 * data-URI output for ticket QRs encoding the online verification URL.
 */
import { galois } from "./qr-tables.ts";

export interface EncodedQr { size: number; get(x: number, y: number): boolean }

// ISO/IEC 18004, level M: total codewords and block structure per version.
const BLOCKS_M: Record<number, { blocks: [count: number, dataPer: number][]; eccPer: number }> = {
  1: { blocks: [[1, 16]], eccPer: 10 },
  2: { blocks: [[1, 28]], eccPer: 16 },
  3: { blocks: [[1, 44]], eccPer: 26 },
  4: { blocks: [[2, 32]], eccPer: 18 },
  5: { blocks: [[2, 43]], eccPer: 24 },
  6: { blocks: [[4, 27]], eccPer: 16 },
  7: { blocks: [[4, 31]], eccPer: 18 },
  8: { blocks: [[2, 38], [2, 39]], eccPer: 22 },
  9: { blocks: [[3, 36], [2, 37]], eccPer: 22 },
  10: { blocks: [[4, 43], [1, 44]], eccPer: 26 },
};

// Alignment pattern centres (both axes), per version 2..10.
const ALIGN: Record<number, number[]> = {
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

function dataCodewords(v: number): number {
  return BLOCKS_M[v]!.blocks.reduce((a, [, per]) => a + per, 0);
}

export function qrSvgDataUri(text: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(qrSvg(text)).toString("base64")}`;
}

export function qrSvg(text: string, modulePx = 8, marginModules = 4): string {
  const m = encode(text);
  const n = (m.size + marginModules * 2) * modulePx;
  const rects: string[] = [];
  for (let y = 0; y < m.size; y++)
    for (let x = 0; x < m.size; x++)
      if (m.get(x, y))
        rects.push(`<rect x="${(x + marginModules) * modulePx}" y="${(y + marginModules) * modulePx}" width="${modulePx}" height="${modulePx}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/>${rects.join("")}</svg>`;
}

export function encode(text: string): EncodedQr {
  const bytes = Buffer.from(text, "utf8");
  let version = 0;
  for (let v = 1; v <= 10; v++) if (bytes.length <= dataCodewords(v)) { version = v; break; }
  if (!version) throw new Error("payload too long (max 215 bytes at v10-M)");
  const spec = BLOCKS_M[version]!;
  const size = 17 + 4 * version;

  // ---- data bits ----
  const bits: number[] = [];
  const push = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  const ccBits = version < 10 ? 8 : 16;
  push(0b0100, 4);                 // byte mode
  push(bytes.length, ccBits);
  for (const b of bytes) push(b, 8);
  const dataTotal = dataCodewords(version);
  const capacity = dataTotal * 8;
  // terminator up to 4 bits
  push(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);
  let pad = 0;
  while (bits.length < capacity) push([0xEC, 0x11][pad++ % 2]!, 8);
  const dataCw: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]!;
    dataCw.push(b);
  }

  // ---- split into blocks + RS ECC ----
  const dataBlocks: number[][] = [];
  let cursor = 0;
  for (const [count, per] of spec.blocks) {
    for (let i = 0; i < count; i++) {
      dataBlocks.push(dataCw.slice(cursor, cursor + per));
      cursor += per;
    }
  }
  const ecBlocks = dataBlocks.map((d) => galois.polynomialRemainder(d, galois.generatorFor(spec.eccPer)));

  // ---- interleave ----
  const final: number[] = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) for (const b of dataBlocks) if (i < b.length) final.push(b[i]!);
  for (let i = 0; i < spec.eccPer; i++) for (const b of ecBlocks) final.push(b[i]!);

  // ---- matrix skeleton ----
  const modules: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const isFunction = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const set = (x: number, y: number, v: boolean) => { modules[y]![x] = v; isFunction[y]![x] = true; };

  // Canonical 7x7 finder pattern: black ring (r=3), white ring (r=2), black ring (r=1), centre (r=0).
  const stampFinder = (ox: number, oy: number): void => {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const r = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      set(ox + x, oy + y, r !== 2);
    }
    // white separator ring around the finder (row/col 7 where in-bounds)
    for (let i = -1; i <= 7; i++) {
      for (const [x, y] of [[i, -1], [i, 7], [-1, i], [7, i]] as const) {
        const px = ox + x, py = oy + y;
        if (px >= 0 && py >= 0 && px < size && py < size && !isFunction[py]![px]) set(px, py, false);
      }
    }
  };
  stampFinder(0, 0);
  stampFinder(size - 7, 0);
  stampFinder(0, size - 7);
  // Timing
  for (let i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
  // Dark module
  set(8, size - 8, true);
  // Alignment
  const centers = [6, ...(ALIGN[version] ?? []).filter((p) => p !== 6)];
  for (const cy of centers) for (const cx of centers) {
    if ((cx <= 8 && cy <= 8) || (cx >= size - 9 && cy <= 8) || (cx <= 8 && cy >= size - 9)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const edge = Math.max(Math.abs(dx), Math.abs(dy));
      set(cx + dx, cy + dy, edge !== 1);
    }
  }
  // Reserve format areas
  const formatPositions: [number, number][] = [];
  for (let i = 0; i < 15; i++) {
    // first copy: around top-left
    if (i < 6) formatPositions.push([8, i]);
    else if (i === 6) formatPositions.push([8, 7]);
    else if (i === 7) formatPositions.push([8, 8]);
    else if (i === 8) formatPositions.push([7, 8]);
    else formatPositions.push([14 - i, 8]);
  }
  const formatPositions2: [number, number][] = [];
  for (let i = 0; i < 15; i++) {
    if (i < 8) formatPositions2.push([size - 1 - i, 8]);
    else formatPositions2.push([8, size - 15 + i]);
  }

  // ---- data placement ----
  let bit = 0;
  const totalBits = final.length * 8;
  const getBit = () => (bit < totalBits) ? ((final[bit >> 3]! >> (7 - (bit & 7))) & 1) === 1 : false;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) { right = 5; }
    for (let y = 0; y < size; y++) {
      const yy = y;
      for (const x of [right, right - 1]) {
        if (isFunction[yy]![x]!) { bit++; continue; }
        modules[yy]![x] = getBit();
        bit++;
      }
    }
  }

  // ---- masking + format; pick lowest penalty ----
  const fmtBase = bchFormat(0 /* level M = 00 */, 0); // recompute per mask below
  let best: { score: number; m: boolean[][] } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    const m2 = modules.map((row) => row.slice());
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (isFunction[y]![x]!) continue;
      if (maskBit(x, y, mask)) m2[y]![x] = !m2[y]![x]!;
    }
    // write format info for this mask
    const fmt = bchFormat(0, mask); // level bits for M are 00
    for (let i = 0; i < 15; i++) {
      const [x1, y1] = formatPositions[i]!;
      m2[y1]![x1] = fmt[i] === 1;
      const [x2, y2] = formatPositions2[i]!;
      m2[y2]![x2] = fmt[i] === 1;
    }
    const s = penalty(m2, size);
    if (!best || s < best.score) best = { score: s, m: m2 };
  }
  void fmtBase;
  return { size, get: (x, y) => best!.m[y]![x]! };
}

function maskBit(x: number, y: number, mask: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x * y) % 2) + ((x + y) % 3)) % 2 === 0;
  }
}

/** 15-bit format code (BCH) for ECC level M (bits 00) + mask. */
function bchFormat(levelBits: number, mask: number): number[] {
  const data = (levelBits << 3) | mask;
  const rem = galois.bchRemainder(data);
  let v = ((data << 10) | rem) ^ 0b101010000010010;
  const out: number[] = [];
  for (let i = 14; i >= 0; i--) out.push((v >> i) & 1);
  return out;
}

function penalty(m: boolean[][], size: number): number {
  let score = 0;
  const runs = (getter: (i: number) => boolean): number => {
    let run = 1, t = 0;
    for (let i = 1; i < size; i++) {
      if (getter(i) === getter(i - 1)) { run++; } else { t += run >= 5 ? 3 + (run - 5) : 0; run = 1; }
    }
    t += run >= 5 ? 3 + (run - 5) : 0;
    return t;
  };
  for (let y = 0; y < size; y++) score += runs((i) => m[y]![i]!);
  for (let x = 0; x < size; x++) score += runs((i) => m[i]![x]!);
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const v = m[y]![x]!;
    if (m[y]![x + 1] === v && m[y + 1]![x] === v && m[y + 1]![x + 1] === v) score += 3;
  }
  return score;
}
