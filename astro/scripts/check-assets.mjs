#!/usr/bin/env node
/**
 * Production-readiness gate: refuses to bless a build that still uses
 * unapproved imagery.
 *
 *   node scripts/check-assets.mjs [dir]      (default: dist)
 *
 * Exit 0 = production-ready. Exit 1 = blocked, with the reason printed.
 *
 * WHY
 * ---
 * Stage 1 sources current photography from the organization's public Facebook
 * page. Public availability is NOT permission to publish. Every such asset is
 * declared `temporary-facebook-asset` in `src/data/images.ts` and rendered with
 * `data-asset-status` on the element, so this check can be exact rather than
 * hopeful: if even one temporary asset is in the build, the build is not
 * production-ready — no matter what anyone intended.
 *
 * It deliberately FAILS today. That is the point: it is a check that can fail, and
 * it will keep failing until each photograph is either approved (status flips to
 * `approved` in the manifest) or replaced with a client-supplied original.
 *
 * It also enforces provenance: every <img> must carry an explicit asset status, so
 * a new image cannot be added without declaring where it came from.
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? 'dist');
if (!fs.existsSync(dir)) {
  console.error(`check-assets: no such directory: ${dir}`);
  process.exit(2);
}

const pages = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.html'))
  .map((f) => path.join(dir, f));

const images = [];
for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0];
    const attr = (name) => (tag.match(new RegExp(`${name}="([^"]*)"`)) ?? [])[1];
    images.push({
      page: path.basename(page),
      src: attr('src'),
      status: attr('data-asset-status'),
      id: attr('data-asset-id'),
      fbid: attr('data-fbid'),
      alt: attr('alt'),
      width: attr('width'),
      height: attr('height'),
      loading: attr('loading'),
    });
  }
}

const temporary = images.filter((i) => i.status === 'temporary-facebook-asset');
const undeclared = images.filter((i) => !i.status);

// Declared placeholders are not <img> elements (they are designed panels), so they
// are found by their status marker. They are treated EXACTLY like an unapproved
// photograph: a build that still contains one is not production-ready. The cheer
// card is the reason this exists — the honest options were a false photograph or a
// visible gap, and neither may reach production unnoticed.
const placeholders = [];
for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  for (const m of html.matchAll(/data-asset-status="temporary-placeholder"[^>]*/g)) {
    const tag = m[0];
    const attr = (name) => (tag.match(new RegExp(`${name}="([^"]*)"`)) ?? [])[1];
    placeholders.push({ page: path.basename(page), id: attr('data-asset-id') || '(unnamed)', note: attr('data-asset-note') });
  }
}
const missingProvenance = images.filter(
  (i) => i.status === 'temporary-facebook-asset' && !i.fbid,
);
const missingAlt = images.filter((i) => i.alt === undefined);
const missingDims = images.filter((i) => !i.width || !i.height);
const missingLoading = images.filter((i) => !i.loading);

const byId = new Map();
for (const i of temporary) byId.set(i.id, i);

console.log(`check-assets: ${dir}`);
console.log(`  pages scanned      : ${pages.length}`);
console.log(`  <img> elements     : ${images.length}`);
console.log(`  approved assets    : ${images.filter((i) => i.status === 'approved').length}`);
console.log(`  TEMPORARY assets   : ${temporary.length}`);
console.log(`  PLACEHOLDERS       : ${placeholders.length}`);

let failed = false;
const fail = (label, items, fmt) => {
  if (!items.length) return;
  failed = true;
  console.error(`\n  FAIL ${label} (${items.length})`);
  for (const i of items.slice(0, 20)) console.error(`    ${fmt(i)}`);
};

fail('temporary (unapproved) imagery in the build', temporary, (i) => `${i.id} ${i.src} — fbid ${i.fbid}, used on ${i.page}`);
fail('declared placeholders standing in for missing photography', placeholders, (i) => `${i.id} on ${i.page}${i.note ? ` — ${i.note}` : ''}`);
fail('images with no declared asset status', undeclared, (i) => `${i.src} on ${i.page}`);
fail('temporary images with no provenance (fbid)', missingProvenance, (i) => `${i.src} on ${i.page}`);
fail('images with no alt attribute', missingAlt, (i) => `${i.src} on ${i.page}`);
fail('images with no width/height', missingDims, (i) => `${i.src} on ${i.page}`);
fail('images with no loading attribute', missingLoading, (i) => `${i.src} on ${i.page}`);

if (failed) {
  console.error(
    `\nPRODUCTION BLOCKED — ${temporary.length} temporary Facebook-sourced photograph(s)` +
      (placeholders.length ? ` and ${placeholders.length} declared placeholder(s)` : '') +
      ` are in use (${[...byId.keys(), ...placeholders.map((p) => p.id)].join(', ')}).\n` +
      'Each photograph must be either approved in writing by the organization or replaced with a\n' +
      'client-supplied original, and then flipped to status "approved" in src/data/images.ts.\n' +
      'Each placeholder must be replaced by real photography of the programme it describes.\n' +
      'This build is a PRIVATE PREVIEW and must not be promoted to production.',
  );
  process.exit(1);
}

console.log('\nPRODUCTION READY — no temporary and no undeclared imagery.');
