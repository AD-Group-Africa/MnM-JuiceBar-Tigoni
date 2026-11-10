/**
 * One-off maintenance script: removes the per-page <nav class="topbar"> and
 * <footer class="site-footer"> blocks from the customer storefront, because
 * src/views/layout.tsx now renders a single site header and footer for every
 * page. Balanced-tag aware (counts nested open/close of the same tag).
 *
 * Usage: node scripts/strip-duplicate-chrome.mjs src/routes/juice-public.tsx
 */
import fs from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/strip-duplicate-chrome.mjs <file>");
  process.exit(1);
}

let src = fs.readFileSync(file, "utf8");

function stripBlock(text, openTag) {
  let out = text;
  let removed = 0;
  for (;;) {
    const start = out.indexOf(openTag);
    if (start === -1) break;
    const tagName = openTag.match(/^<([a-z0-9-]+)/i)[1];
    const closeTag = `</${tagName}>`;
    // Find the matching close, counting same-name nested opens.
    let depth = 0;
    let i = start;
    let end = -1;
    const openRe = new RegExp(`<${tagName}(\\s|>)`, "gi");
    const closeRe = new RegExp(closeTag, "gi");
    while (i < out.length) {
      openRe.lastIndex = i;
      closeRe.lastIndex = i;
      const o = openRe.exec(out);
      const c = closeRe.exec(out);
      if (!c) break;
      if (o && (!c || o.index < c.index)) {
        depth++;
        i = o.index + o[0].length;
      } else {
        depth--;
        i = c.index + c[0].length;
        if (depth === 0) {
          end = c.index + c[0].length;
          break;
        }
      }
    }
    if (end === -1) {
      console.error(`[strip] unbalanced ${openTag} — stopping`);
      break;
    }
    // Also swallow the trailing newline + indentation after the block.
    let tail = end;
    const after = out.slice(end);
    const m = after.match(/^\r?\n[ \t]*/);
    if (m) tail = end + m[0].length;
    out = out.slice(0, start) + out.slice(tail);
    removed++;
  }
  return { out, removed };
}

for (const tag of ['<nav class="topbar">', '<footer class="site-footer">']) {
  const r = stripBlock(src, tag);
  src = r.out;
  console.log(`[strip] removed ${r.removed} block(s) of ${tag}`);
}

fs.writeFileSync(file, src);
console.log(`[strip] rewrote ${file}`);
