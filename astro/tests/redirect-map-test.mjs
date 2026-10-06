#!/usr/bin/env node
/**
 * Redirect-map test.
 *
 *   node tests/redirect-map-test.mjs
 *
 * Exit 0 = the redirect map is correct and the two copies agree.
 *
 * WHY THIS EXISTS
 * ---------------
 * The redirect list exists TWICE, on purpose, because the two deploy paths read
 * different files:
 *   * `public/_redirects`  -> a no-build deploy (a branch deploy of the prebuilt
 *                             output, or a direct draft deploy)
 *   * `netlify.toml`       -> a deploy that Netlify builds
 * Two copies can drift, and a drifted redirect map is a silently broken URL for a
 * family. So the copies are compared, exactly, and the coverage requirements are
 * asserted from a hard-coded list of the URLs that existed before the redesign —
 * not from the map itself (which would make the test vacuous).
 *
 * It also asserts the retired routes point at the HOMEPAGE ANCHORS and that the
 * registration success path cannot break, because those are the two decisions the
 * consolidation actually makes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRedirectsFile, parseNetlifyToml } from '../scripts/lib/redirects.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
let fail = 0;
const ok = (name) => { pass += 1; console.log(`  ok   ${name}`); };
const no = (name, detail = '') => { fail += 1; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); };
const eq = (name, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? ok(name) : no(name, `${JSON.stringify(a)} != ${JSON.stringify(b)}`));

// --- the two copies ----------------------------------------------------------
const redirectsText = fs.readFileSync(path.join(ROOT, 'public/_redirects'), 'utf8');
const tomlText = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
const rawFromRedirects = parseRedirectsFile(redirectsText);
const fromRedirects = rawFromRedirects;
const fromToml = parseNetlifyToml(tomlText);

console.log('redirect map');
console.log(`  _redirects rules : ${fromRedirects.length}`);
console.log(`  netlify.toml     : ${fromToml.length}`);

eq('the two copies list the same rules, in the same order', fromRedirects, fromToml);
eq(
  'fragment destinations are QUOTED in _redirects (an unquoted # is a comment on Netlify)',
  [...redirectsText.matchAll(/^\s*\S+\s+(")?\/#about/gm)].every((m) => m[1] === '"') &&
    [...redirectsText.matchAll(/^\s*\S+\s+(")?\/#fields/gm)].every((m) => m[1] === '"') &&
    (redirectsText.match(/\/#about/g) ?? []).length >= 4,
  true,
);

// --- the URLs that existed before this redesign -------------------------------
// Hard-coded on purpose: if the map dropped one of these, nothing else would notice.
const REQUIRED = {
  '/index.html': '/',
  '/pages/about': '/#about',
  '/pages/about.html': '/#about',
  '/about': '/#about',
  '/about.html': '/#about',
  '/pages/fields': '/#fields',
  '/pages/fields.html': '/#fields',
  '/fields': '/#fields',
  '/fields.html': '/#fields',
  '/pages/register': '/register',
  '/pages/register.html': '/register',
  '/pages/physical': '/physical',
  '/pages/physical.html': '/physical',
  '/pages/contact': '/contact',
  '/pages/contact.html': '/contact',
  '/pages/thankyou': '/thankyou',
  '/pages/thankyou.html': '/thankyou',
};

for (const [from, to] of Object.entries(REQUIRED)) {
  const rule = fromRedirects.find((r) => r.from === from);
  if (!rule) { no(`a rule exists for ${from}`); continue; }
  if (rule.to !== to) { no(`${from} points at the approved target`, `got ${rule.to}, want ${to}`); continue; }
  if (Number(rule.status) !== 301) { no(`${from} is a 301`, `got ${rule.status}`); continue; }
  if (!rule.force) { no(`${from} is FORCED`, 'Netlify shadows an unforced rule when a file exists'); continue; }
  ok(`${from} -> ${to} (301, forced)`);
}

// --- the consolidation decisions ---------------------------------------------
const retired = fromRedirects.filter((r) => ['/pages/about', '/pages/about.html', '/about', '/about.html', '/pages/fields', '/pages/fields.html', '/fields', '/fields.html'].includes(r.from));
eq('every retired About/Fields URL lands on a homepage anchor', retired.every((r) => r.to.startsWith('/#')), true);
eq('the registration success path is preserved', fromRedirects.some((r) => r.from === '/pages/thankyou' && r.to === '/thankyou'), true);
eq('no rule points at a retired page', fromRedirects.some((r) => r.to === '/pages/about' || r.to === '/pages/fields'), false);
eq('no catch-all rule (which would hide a genuine 404)', fromRedirects.some((r) => r.from === '/*'), false);

// --- _redirects must not be shadowable ---------------------------------------
const fileNames = new Set();
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else fileNames.add(path.relative(path.join(ROOT, 'public'), p).replace(/\\/g, '/'));
  }
};
walk(path.join(ROOT, 'public'));
const shadowed = fromRedirects.filter((r) => fileNames.has(r.from.replace(/^\//, '')) && !r.force);
eq('no rule that has a real file at its path is unforced', shadowed.map((r) => r.from), []);

console.log(`\nredirect map: ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
