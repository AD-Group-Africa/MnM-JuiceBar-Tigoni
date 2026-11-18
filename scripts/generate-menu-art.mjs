/**
 * Generates the menu's sample illustrations.
 * These are deliberately text-free: the UI supplies names, prices and badges,
 * so the artwork never duplicates or contradicts live product data.
 * Run: node scripts/generate-menu-art.mjs
 */
import { writeFileSync } from "node:fs";

const OUT = "public/menu";

const palettes = {
  fj: { bg: "#FFF3E4", liquid: "#F79225", deep: "#E87A2D", light: "#FFC078", garnish: "#F97316" },
  fb: { bg: "#FFF1E2", liquid: "#F26522", deep: "#C2410C", light: "#FDBA74", garnish: "#F59E0B" },
  sm: { bg: "#FFF7E6", liquid: "#F5A524", deep: "#D97706", light: "#FDE68A", garnish: "#FBBF24" },
  ms: { bg: "#FBF1E3", liquid: "#E9C08A", deep: "#B45309", light: "#FDE7C5", garnish: "#DC2626" },
  mk: { bg: "#FDEDEA", liquid: "#E85D5D", deep: "#B91C1C", light: "#FCA5A5", garnish: "#FB7185" },
  sn: { bg: "#FAF0E1", liquid: "#D99A4E", deep: "#B45309", light: "#F3D3A2", garnish: "#92400E" },
  od: { bg: "#EAF5F1", liquid: "#2F8F7B", deep: "#0F766E", light: "#99D6C8", garnish: "#34D399" },
  wc: { bg: "#EDF6FB", liquid: "#7CC5E8", deep: "#0369A1", light: "#C7E8F8", garnish: "#38BDF8" },
};

// Per-drink accents so a category row never looks like the same glass repeated.
const overrides = {
  "fj-001": { liquid: "#F79225", deep: "#E87A2D", light: "#FFC078", garnish: "#F97316", bg: "#FFF3E4" },
  "fj-002": { liquid: "#F2C230", deep: "#D99E05", light: "#FBE38A", garnish: "#EAB308", bg: "#FFFAE4" },
  "fj-003": { liquid: "#93C24A", deep: "#5F8F2A", light: "#CDE6A4", garnish: "#65A30D", bg: "#F5F9EA" },
  "fj-004": { liquid: "#F2A93B", deep: "#D97706", light: "#FBD38D", garnish: "#F59E0B", bg: "#FFF6E8" },
  "fb-001": { liquid: "#F26522", deep: "#C2410C", light: "#FDBA74", garnish: "#F59E0B", bg: "#FFF1E2" },
  "fb-002": { liquid: "#E85D75", deep: "#BE123C", light: "#FECDD3", garnish: "#FB7185", bg: "#FDF0F2" },
  "sm-001": { liquid: "#F2A93B", deep: "#D97706", light: "#FBD38D", garnish: "#F59E0B", bg: "#FFF7E6" },
  "sm-002": { liquid: "#C2416B", deep: "#9D174D", light: "#F9A8D4", garnish: "#DB2777", bg: "#FDF1F6" },
  "sm-003": { liquid: "#E8C766", deep: "#B48A12", light: "#F7E7AE", garnish: "#EAB308", bg: "#FFFAEA" },
  "ms-001": { liquid: "#E4C49A", deep: "#B45309", light: "#F7E5CC", bg: "#FBF3E8" },
  "ms-002": { liquid: "#8B5E3C", deep: "#5D4037", light: "#C9A98B", bg: "#F7EDE6" },
  "mk-001": { liquid: "#E0576B", deep: "#B91C1C", light: "#FCA5A5", garnish: "#FB7185", bg: "#FDEDEA" },
  "mk-002": { liquid: "#2F8F7B", deep: "#0F766E", light: "#99D6C8", garnish: "#34D399", bg: "#EAF5F1" },
  "od-001": { liquid: "#2F8F7B", deep: "#0F766E", light: "#99D6C8", bg: "#EAF5F1" },
  "od-002": { liquid: "#8B5E3C", deep: "#5D4037", light: "#C9A98B", bg: "#F7EDE6" },
};

const base = (bg) => `
  <rect width="800" height="800" fill="${bg}"/>
  <circle cx="400" cy="352" r="292" fill="#fff" opacity="0.38"/>
  <ellipse cx="400" cy="694" rx="176" ry="24" fill="#2C2A27" opacity="0.10"/>`;

const leaf = (x, y, rot, color) =>
  `<ellipse cx="${x}" cy="${y}" rx="34" ry="15" fill="${color}" transform="rotate(${rot} ${x} ${y})"/>`;

const citrus = (cx, cy, r, outer, inner) => `
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${outer}"/>
  <circle cx="${cx}" cy="${cy}" r="${r - 9}" fill="${inner}"/>
  ${[0, 60, 120].map((a) => `<path d="M${cx} ${cy - (r - 11)} A ${r - 11} ${r - 11} 0 0 1 ${cx + (r - 11) * Math.sin((a * Math.PI) / 180)} ${cy - (r - 11) * Math.cos((a * Math.PI) / 180)}" stroke="#FFF7E8" stroke-width="5" fill="none"/>`).join("")}
  <circle cx="${cx}" cy="${cy}" r="7" fill="#FFF7E8"/>`;

function glass(p, { creamy = false } = {}) {
  const top = creamy ? 330 : 300;
  return `
  <g>
    <path d="M304 268 H496 L470 646 Q467 676 438 676 H362 Q333 676 330 646 Z" fill="#FFFFFF" opacity="0.62" stroke="#FFFFFF" stroke-width="7"/>
    <path d="M318 ${top + 34} H482 L462 638 Q460 662 438 662 H362 Q340 662 338 638 Z" fill="${p.liquid}"/>
    <path d="M318 ${top + 34} H482 L478 430 H322 Z" fill="${p.deep}" opacity="0.18"/>
    <ellipse cx="400" cy="${top + 34}" rx="82" ry="13" fill="${p.light}"/>
    <rect x="348" y="${top + 78}" width="54" height="54" rx="11" fill="#FFFFFF" opacity="0.34" transform="rotate(-13 375 ${top + 105})"/>
    <rect x="410" y="${top + 128}" width="46" height="46" rx="10" fill="#FFFFFF" opacity="0.26" transform="rotate(16 433 ${top + 151})"/>
    <g transform="rotate(17 452 ${top})">
      <rect x="440" y="112" width="22" height="268" rx="11" fill="${p.deep}"/>
      <rect x="446" y="112" width="7" height="268" fill="#FFFFFF" opacity="0.35"/>
    </g>
    ${creamy ? `<circle cx="400" cy="292" r="66" fill="#FFF9EF"/><circle cx="352" cy="312" r="44" fill="#FFF9EF"/><circle cx="448" cy="312" r="44" fill="#FFF9EF"/><circle cx="400" cy="250" r="18" fill="#DC2626"/>` : ""}
    ${citrus(292, 330, 46, p.deep, p.light)}
    ${leaf(322, 292, -32, "#4C7A3F")}
  </g>`;
}

function shake(p) {
  return `
  <g>
    <path d="M318 300 H482 L466 650 Q464 676 438 676 H362 Q336 676 334 650 Z" fill="#FFFFFF" opacity="0.7" stroke="#FFFFFF" stroke-width="7"/>
    <path d="M330 372 H470 L458 642 Q457 662 438 662 H362 Q343 662 342 642 Z" fill="${p.liquid}"/>
    <ellipse cx="400" cy="372" rx="70" ry="12" fill="${p.light}"/>
    <g transform="rotate(14 456 330)"><rect x="444" y="140" width="22" height="240" rx="11" fill="${p.deep}"/></g>
    <circle cx="400" cy="300" r="70" fill="#FFF9EF"/>
    <circle cx="352" cy="322" r="46" fill="#FFF9EF"/>
    <circle cx="448" cy="322" r="46" fill="#FFF9EF"/>
    <circle cx="400" cy="246" r="34" fill="#FFF9EF"/>
    <circle cx="400" cy="222" r="15" fill="#DC2626"/>
    ${leaf(430, 210, 24, "#4C7A3F")}
  </g>`;
}

function mocktail(p) {
  return `
  <g>
    <path d="M282 286 H518 L418 470 V612 H470 Q486 612 486 628 Q486 644 468 644 H332 Q314 644 314 628 Q314 612 330 612 H382 V470 Z" fill="#FFFFFF" opacity="0.62" stroke="#FFFFFF" stroke-width="7"/>
    <path d="M306 300 H494 L405 452 H395 Z" fill="${p.liquid}"/>
    <ellipse cx="400" cy="300" rx="94" ry="12" fill="${p.light}" opacity="0.9"/>
    <g transform="rotate(20 450 300)"><rect x="442" y="150" width="18" height="176" rx="9" fill="${p.deep}"/></g>
    ${citrus(492, 268, 40, p.deep, p.light)}
    ${leaf(520, 236, -18, "#4C7A3F")}
    <circle cx="358" cy="360" r="7" fill="#FFFFFF" opacity="0.7"/>
    <circle cx="432" cy="394" r="5" fill="#FFFFFF" opacity="0.6"/>
  </g>`;
}

function snack(p, variant) {
  const plate = `<ellipse cx="400" cy="596" rx="236" ry="64" fill="#FFFFFF" opacity="0.85"/><ellipse cx="400" cy="596" rx="236" ry="64" fill="none" stroke="${p.light}" stroke-width="6"/>`;
  if (variant === 1) {
    // mandazi triangles
    const tri = (x, y, r, c) => `<path d="M${x} ${y - 62} L${x + 66} ${y + 46} Q${x} ${y + 74} ${x - 66} ${y + 46} Z" fill="${c}" transform="rotate(${r} ${x} ${y})"/>`;
    return `<g>${plate}${tri(330, 520, -12, "#D99A4E")}${tri(468, 512, 14, "#C98A3E")}${tri(398, 556, 4, "#E8B36A")}</g>`;
  }
  if (variant === 2) {
    // fries in a paper cup
    return `
    <g>
      ${plate}
      <g transform="translate(0 -6)">
        ${Array.from({ length: 9 }, (_, i) => {
          const x = 330 + i * 18;
          const h = 190 + (i % 3) * 34;
          return `<rect x="${x}" y="${500 - h}" width="15" height="${h}" rx="7" fill="${i % 2 ? "#E8B45C" : "#F0C670"}" transform="rotate(${i % 2 ? 4 : -4} ${x} 470)"/>`;
        }).join("")}
        <path d="M306 470 H494 L470 640 Q468 660 446 660 H354 Q332 660 330 640 Z" fill="${p.deep}"/>
        <path d="M306 470 H494 L488 512 H312 Z" fill="#FFFFFF" opacity="0.24"/>
      </g>
    </g>`;
  }
  // samosas / pastry
  const samosa = (x, y, r, c) => `<path d="M${x} ${y - 56} L${x + 74} ${y + 44} Q${x} ${y + 70} ${x - 74} ${y + 44} Z" fill="${c}" stroke="#B45309" stroke-width="4" transform="rotate(${r} ${x} ${y})"/>`;
  return `<g>${plate}${samosa(336, 514, -8, "#E0A44F")}${samosa(470, 508, 12, "#D8973F")}${samosa(400, 548, 2, "#EAB96B")}</g>`;
}

function bottle(p) {
  return `
  <g>
    <path d="M368 214 H432 V286 Q470 318 470 372 V636 Q470 664 442 664 H358 Q330 664 330 636 V372 Q330 318 368 286 Z" fill="#FFFFFF" opacity="0.66" stroke="#FFFFFF" stroke-width="7"/>
    <path d="M348 330 Q400 312 452 330 V628 Q452 644 434 644 H366 Q348 644 348 628 Z" fill="${p.liquid}" opacity="0.9"/>
    <rect x="366" y="196" width="68" height="34" rx="12" fill="${p.deep}"/>
    <rect x="352" y="420" width="96" height="86" rx="12" fill="#FDFBF7" opacity="0.9"/>
    <path d="M368 450 H432 M368 472 H412" stroke="${p.deep}" stroke-width="8" stroke-linecap="round" opacity="0.5"/>
    ${citrus(330, 372, 34, p.deep, p.light)}
  </g>`;
}

const files = [
  ["fj-001", "glass"], ["fj-002", "glass"], ["fj-003", "glass"], ["fj-004", "glass"],
  ["fb-001", "glass"], ["fb-002", "glass"],
  ["sm-001", "smoothie"], ["sm-002", "smoothie"], ["sm-003", "smoothie"],
  ["ms-001", "shake"], ["ms-002", "shake"],
  ["mk-001", "mocktail"], ["mk-002", "mocktail"],
  ["sn-001", "snack1"], ["sn-002", "snack2"], ["sn-003", "snack3"],
  ["od-001", "bottle"], ["od-002", "bottle"], ["wc-001", "bottle"],
];

for (const [name, kind] of files) {
  const p = { ...palettes[name.slice(0, 2)], ...(overrides[name] ?? {}) };
  let art = "";
  if (kind === "glass") art = glass(p);
  else if (kind === "smoothie") art = glass(p, { creamy: false });
  else if (kind === "shake") art = shake(p);
  else if (kind === "mocktail") art = mocktail(p);
  else if (kind.startsWith("snack")) {
    art = `<g transform="translate(400 500) scale(1.32) translate(-400 -500)">${snack(p, Number(kind.slice(-1)))}</g>`;
  }
  else art = bottle(p);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800" role="img" aria-label="MnM sample product illustration">${base(p.bg)}${art}</svg>`;
  writeFileSync(`${OUT}/${name}.svg`, svg.replace(/\n\s*/g, " ").trim() + "\n");
}
console.log(`generated ${files.length} illustrations`);
