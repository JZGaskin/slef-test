#!/usr/bin/env node
/**
 * Retired-route redirect test — the eight About/Fields URLs that must keep working.
 *
 *   node tests/redirect-retired-routes-test.mjs [--self-test] [--require-vendor]
 *
 * WHY THIS EXISTS
 * ---------------
 * A private preview shipped these eight rules in the form
 *
 *     /about    "/#about"    301!
 *
 * and every one of them was a LIVE 404. Netlify's parser requires the destination
 * token to START WITH `/` (or be an absolute http/https URL); `"/#about"` starts
 * with a quote, so the line is rejected — "The destination path/URL must start with
 * \"/\", \"http:\" or \"https:\"" — and the rule is DROPPED. Every unquoted rule on
 * the same file kept working, which is why it went unnoticed.
 *
 * The heavy lifting (running Netlify's own parser and matching engine over the real
 * file, and proving every retired URL resolves to a 301 `/`) lives in
 * `scripts/check-redirects.mjs`, so the publisher's release gate and this test check
 * the SAME code. This suite adds the source-level invariants that matter to a human
 * reader — the map's coverage, the homepage anchors, the navigation links — and a
 * mutation control proving the gate can fail.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseRedirectsFile, findRedirectLoops } from '../scripts/lib/redirects.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REDIRECTS = path.join(ROOT, 'public/_redirects');
const GATE = path.join(ROOT, 'scripts/check-redirects.mjs');
const SELF_TEST = process.argv.includes('--self-test');
const REQUIRE_VENDOR = process.argv.includes('--require-vendor');

let pass = 0;
let fail = 0;
const ok = (n, d = '') => { pass += 1; console.log(`  ok    ${n}${d ? ` — ${d}` : ''}`); };
const no = (n, d = '') => { fail += 1; console.error(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); };
const eq = (n, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? ok(n) : no(n, `${JSON.stringify(a)} != ${JSON.stringify(b)}`));

const LEGACY_SOURCES = [
  '/index.html',
  '/pages/about.html', '/pages/about', '/about.html', '/about',
  '/pages/fields.html', '/pages/fields', '/fields.html', '/fields',
  '/pages/register.html', '/pages/register',
  '/pages/physical.html', '/pages/physical',
  '/pages/contact.html', '/pages/contact',
  '/pages/thankyou.html', '/pages/thankyou',
];

// --- 1. source-level invariants -----------------------------------------------
console.log('retired-route redirects — the map and the homepage');
const { rules, errors } = parseRedirectsFile(fs.readFileSync(REDIRECTS, 'utf8'));

eq('no _redirects line is dropped by our model of Netlify\'s parser', errors, []);
eq('the map covers all 17 legacy URLs', rules.map((r) => r.from).sort(), [...LEGACY_SOURCES].sort());
eq('no destination contains a fragment', rules.filter((r) => r.to.includes('#')).map((r) => `${r.from} -> ${r.to}`), []);
eq('no redirect loop exists in the map', findRedirectLoops(rules), []);

// The homepage must still carry the anchors the navigation links to — the retired
// URLs now land on `/`, so the anchors are the only way to reach those sections.
const home = fs.readFileSync(path.join(ROOT, 'src/pages/index.astro'), 'utf8');
for (const id of ['about', 'fields', 'football', 'cheer', 'register']) {
  eq(`the homepage still defines #${id}`, new RegExp(`id="${id}"`).test(home), true);
}
const navData = fs.readFileSync(path.join(ROOT, 'src/data/site.ts'), 'utf8');
eq('the navigation still links to /#about', /['"]\/#about['"]/.test(navData), true);
eq('the navigation still links to /#fields', /['"]\/#fields['"]/.test(navData), true);

// --- 2. the release gate (Netlify's own parser + engine) ----------------------
console.log('retired-route redirects — the release gate (scripts/check-redirects.mjs)');
const gateArgs = [GATE, REDIRECTS];
if (REQUIRE_VENDOR) gateArgs.push('--require-vendor');
const gate = spawnSync(process.execPath, gateArgs, { encoding: 'utf8' });
if (gate.status === 0) ok('check-redirects passes on the shipped map');
else no('check-redirects passes on the shipped map', `exit ${gate.status}: ${(gate.stdout + gate.stderr).trim().split('\n').slice(-4).join(' | ')}`);

// --- 3. mutation control: the gate MUST fail on the form that shipped ---------
if (SELF_TEST) {
  console.log('retired-route redirects — mutation control (the gate must be able to fail)');
  const broken = path.join(ROOT, 'build', `self-test-${process.pid}.redirects`);
  fs.mkdirSync(path.dirname(broken), { recursive: true });
  fs.writeFileSync(broken, fs.readFileSync(REDIRECTS, 'utf8').replace(
    /^(\/about\s+)\/\s+301!$/m, '$1"/#about"    301!',
  ));
  const mutated = fs.readFileSync(broken, 'utf8').includes('"/#about"');
  eq('the mutation actually rewrote a rule into the shipped broken form', mutated, true);
  const res = spawnSync(process.execPath, [GATE, broken, ...(REQUIRE_VENDOR ? ['--require-vendor'] : []), '--quiet'], { encoding: 'utf8' });
  eq('the gate FAILS on the quoted-fragment form that shipped', res.status, 1);
  const out = `${res.stdout}${res.stderr}`;
  eq('the failure names the dropped rule', /DROP|dropped/i.test(out), true);
  // ...and our parser agrees it is a dropped line, not a rewrite.
  const parsed = parseRedirectsFile(fs.readFileSync(broken, 'utf8'));
  eq('our parser drops exactly that one rule', [parsed.rules.length, parsed.errors.length], [rules.length - 1, 1]);
  fs.unlinkSync(broken);
}

console.log(`\nretired-route redirects: ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
