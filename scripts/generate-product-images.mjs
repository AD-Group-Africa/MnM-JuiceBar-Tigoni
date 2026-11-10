#!/usr/bin/env node
/**
 * Generates the SAMPLE product illustrations used by the demonstration dataset.
 * Drawn at the storefront's 4:3 card ratio (640×480).
 *
 * These are deliberately drawn placeholders, not photographs:
 *  - every file is an SVG illustration (no binary assets in the repo),
 *  - every file carries a visible "SAMPLE IMAGE" tag so nobody can mistake
 *    it for a real photo of the product,
 *  - every file carries the product initials so the catalogue grid reads well.
 *
 * The owner replaces these with real photographs from the staff product
 * screen (the storefront reads `product_images.storage_path`).
 *
 * Run: npm run images        (idempotent — safe to re-run)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "menu");

/** sku -> [name, liquid colour, background tint] */
const ITEMS = {
  "FJ-001": ["Fresh Orange Juice", "#ff9f2e", "#fff2dd"],
  "FJ-002": ["Fresh Pineapple Juice", "#f5c518", "#fff9dd"],
  "FJ-003": ["Fresh Sugar Cane Juice", "#b6d97a", "#f1f8e2"],
  "FJ-004": ["Fresh Watermelon Juice", "#ef476f", "#ffe7ec"],
  "SM-001": ["Mango Smoothie", "#ffb703", "#fff5dc"],
  "SM-002": ["Banana Smoothie", "#ffe08a", "#fffaeb"],
  "SM-003": ["Berry Smoothie", "#8d3b8f", "#f5e8f6"],
  "FB-001": ["Tropical Blend", "#ff9f1c", "#fff3e0"],
  "FB-002": ["Citrus Splash", "#ffd166", "#fff8e4"],
  "OD-001": ["Fresh Soya Milk", "#f3ead0", "#fbf7ea"],
  "OD-002": ["Fresh Guava Juice", "#f2768e", "#fdecef"],
  "MS-001": ["Strawberry Milkshake", "#f28482", "#fdeceb"],
  "MS-002": ["Chocolate Milkshake", "#6f4518", "#efe6dc"],
  "MK-001": ["Mango Mocktail", "#2a9d8f", "#e3f4f1"],
  "MK-002": ["Passion Fruit Mocktail", "#e76f51", "#fdeee9"],
  "SN-001": ["Mandazi (3 pcs)", "#d99a4e", "#f8efe1"],
  "SN-002": ["Fresh Fruit Cup", "#7fb069", "#eef6e7"],
  "SN-003": ["Roasted Groundnuts", "#b5651d", "#f5ece3"],
  "WC-001": ["Sliced Watermelon Bowl", "#e63946", "#fdeaea"],
};

function initials(name) {
  return name
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/*
 * Drawn at 640×480 (4:3) to match the storefront card box exactly, so the
 * artwork is never cropped and the "SAMPLE IMAGE" tag always fits inside the
 * badge rectangle (text-anchor=middle with room to spare).
 */
function svg(name, liquid, bg) {
  const ini = initials(name);
  const label = name.length > 26 ? `${name.slice(0, 25)}…` : name;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="640" height="480" role="img" aria-label="${label} — sample illustration">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${bg}"/>
      <stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
    <linearGradient id="juice" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${liquid}"/>
      <stop offset="1" stop-color="${liquid}" stop-opacity="0.78"/>
    </linearGradient>
  </defs>
  <rect width="640" height="480" fill="url(#bg)"/>
  <circle cx="320" cy="225" r="165" fill="#ffffff" opacity="0.55"/>
  <g transform="translate(320 248) scale(0.78)">
    <path d="M-62 -170 L62 -170 L52 170 L-52 170 Z" fill="#ffffff" opacity="0.92"/>
    <path d="M-57 -120 L57 -120 L48 158 L-48 158 Z" fill="url(#juice)"/>
    <ellipse cx="0" cy="-120" rx="57" ry="14" fill="#ffffff" opacity="0.5"/>
    <rect x="16" y="-250" width="14" height="140" rx="7" fill="${liquid}" opacity="0.9" transform="rotate(14 23 -180)"/>
    <text x="0" y="55" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="72" font-weight="700" fill="#ffffff" opacity="0.92">${ini}</text>
  </g>
  <text x="320" y="446" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="27" font-weight="600" fill="#3a3a3a">${label}</text>
  <g>
    <rect x="440" y="20" width="180" height="42" rx="21" fill="#3a3a3a" opacity="0.82"/>
    <text x="530" y="49" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="20" font-weight="700" fill="#ffffff" letter-spacing="0.5">SAMPLE IMAGE</text>
  </g>
</svg>
`;
}

fs.mkdirSync(outDir, { recursive: true });
let written = 0;
for (const [sku, [name, liquid, bg]] of Object.entries(ITEMS)) {
  const file = path.join(outDir, `${sku.toLowerCase()}.svg`);
  fs.writeFileSync(file, svg(name, liquid, bg), "utf8");
  written++;
}
console.log(`[images] wrote ${written} sample product illustrations to public/menu/`);
