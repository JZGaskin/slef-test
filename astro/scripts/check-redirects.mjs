#!/usr/bin/env node
/**
 * check-redirects.mjs — the executable redirect gate for a bundle's `_redirects`.
 *
 *   node scripts/check-redirects.mjs <path/to/_redirects> [--require-vendor] [--quiet]
 *
 * Exit 0 = every rule in the file is one Netlify will actually serve, and each
 * retired About/Fields URL resolves to a 301 to `/`.
 * Exit 1 = at least one rule would be DROPPED by Netlify, or a retired URL does
 *          not resolve. A dropped rule is a 404 for a real visitor.
 *
 * WHY IT EXISTS
 * -------------
 * The preview shipped eight rules written as
 *
 *     /about    "/#about"    301!
 *
 * Every one of those was a live 404: Netlify's parser requires the destination
 * token to start with `/` (or be an absolute http/https URL), so a quoted token is
 * rejected and the line is dropped. Our own harness had (a) invented a quote syntax,
 * (b) asserted the quoted form was REQUIRED, and (c) let the publisher's bundle check
 * treat the quotes as optional — three places more permissive than production.
 *
 * This gate is deliberately paranoid and platform-anchored: when Netlify's own
 * parser and engine are installed it runs them side by side with our model and
 * fails if the two disagree. `--require-vendor` turns "vendor not installed" into a
 * failure (used by the release gate).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import { parseRedirectsFile, findRedirectLoops } from './lib/redirects.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const REQUIRE_VENDOR = args.includes('--require-vendor');
const QUIET = args.includes('--quiet');

if (!file) {
  console.error('usage: check-redirects.mjs <_redirects file> [--require-vendor] [--quiet]');
  process.exit(2);
}
const show = (...a) => { if (!QUIET) console.log(...a); };

let pass = 0;
let fail = 0;
const ok = (n) => { pass += 1; show(`  ok    ${n}`); };
const no = (n, d = '') => { fail += 1; console.error(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); };
const eq = (n, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? ok(n) : no(n, `${JSON.stringify(a)} != ${JSON.stringify(b)}`));

// The retired About/Fields URLs, in every spelling a visitor or a search engine may
// still hold, and the routes that must keep working.
const RETIRED = [
  '/about', '/about/', '/about.html',
  '/pages/about', '/pages/about/', '/pages/about.html',
  '/fields', '/fields/', '/fields.html',
  '/pages/fields', '/pages/fields/', '/pages/fields.html',
];
const OTHER_REDIRECTS = {
  '/index.html': '/',
  '/pages/register': '/register', '/pages/register/': '/register', '/pages/register.html': '/register',
  '/pages/physical': '/physical', '/pages/physical.html': '/physical',
  '/pages/contact': '/contact', '/pages/contact.html': '/contact',
  '/pages/thankyou': '/thankyou', '/pages/thankyou.html': '/thankyou',
};
const TOP_LEVEL = ['/register', '/physical', '/contact', '/thankyou'];

show(`check-redirects: ${file}`);

// --- 1. our model of Netlify's _redirects parser ------------------------------
const text = fs.readFileSync(file, 'utf8');
const { rules, errors } = parseRedirectsFile(text);

for (const e of errors) no('no rule would be DROPPED by Netlify', e);
if (errors.length === 0) ok(`all ${rules.length} rules parse (none dropped)`);
eq('no destination contains a fragment (a fragment is not a legal destination)',
  rules.filter((r) => r.to.includes('#')).map((r) => `${r.from} -> ${r.to}`), []);
eq('no rule uses quotes (Netlify has no quote syntax)',
  rules.filter((r) => /["']/.test(r.to) || /["']/.test(r.from)).map((r) => `${r.from} -> ${r.to}`), []);
eq('no redirect loops', findRedirectLoops(rules), []);
eq('every rule is a forced 301', rules.filter((r) => r.status !== 301 || !r.force).map((r) => `${r.from} ${r.status}`), []);

for (const from of ['/about', '/about.html', '/pages/about', '/pages/about.html',
  '/fields', '/fields.html', '/pages/fields', '/pages/fields.html']) {
  const r = rules.find((x) => x.from === from);
  eq(`rule ${from} -> /`, r ? [r.to, r.status, r.force] : null, ['/', 301, true]);
}

// --- 2. Netlify's own parser, and OUR model must agree ------------------------
const vendor = (() => {
  try {
    const nm = [
      process.env.NETLIFY_CLI_NODE_MODULES,
      '/usr/lib/node_modules/netlify-cli/node_modules',
      (() => { try { return path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'netlify-cli/node_modules'); } catch { return null; } })(),
    ].filter(Boolean).find((d) => fs.existsSync(path.join(d, '@netlify/redirect-parser/lib/all.js')) && fs.existsSync(path.join(d, 'netlify-redirector/index.js')));
    return nm ? {
      parser: pathToFileURL(path.join(nm, '@netlify/redirect-parser/lib/all.js')).href,
      engine: pathToFileURL(path.join(nm, 'netlify-redirector/index.js')).href,
    } : null;
  } catch { return null; }
})();

let vendorRules = null;
if (!vendor) {
  show('  skip  Netlify parser/engine cross-check — netlify-cli not installed (set NETLIFY_CLI_NODE_MODULES)');
  if (REQUIRE_VENDOR) no('--require-vendor: Netlify\'s parser must be available', 'not found');
} else {
  const { parseAllRedirects } = await import(vendor.parser);
  const parsed = await parseAllRedirects({ redirectsFiles: [path.resolve(file)] });
  vendorRules = parsed.redirects;
  eq("Netlify's parser keeps every rule (no dropped line)", parsed.errors.map(String), []);
  eq("Netlify's parser and our model agree rule-for-rule",
    vendorRules.map((r) => [r.from, r.to, r.status, r.force]).sort(),
    rules.map((r) => [r.from, r.to, r.status, r.force]).sort());

  const redirector = (await import(vendor.engine)).default;
  const matcher = await redirector.parseJSON(JSON.stringify(vendorRules), {});
  const reqFor = (p) => ({ scheme: 'https', host: 'x.netlify.app', path: p, query: '', headers: {}, cookieValues: {}, getHeader: () => '', getCookie: () => '' });
  const engineFailures = [];
  for (const p of RETIRED) {
    const hit = await matcher.match(reqFor(p));
    if (!hit || hit.status !== 301 || hit.to !== '/') engineFailures.push(`${p} -> ${hit ? `${hit.status} ${hit.to}` : 'NO MATCH (404)'}`);
  }
  for (const [p, want] of Object.entries(OTHER_REDIRECTS)) {
    const hit = await matcher.match(reqFor(p));
    if (!hit || hit.status !== 301 || hit.to !== want) engineFailures.push(`${p} -> ${hit ? `${hit.status} ${hit.to}` : 'NO MATCH (404)'} (want ${want})`);
  }
  eq("Netlify's engine sends every retired URL to a 301 /", engineFailures, []);
  const shadow = [];
  for (const p of TOP_LEVEL) { const hit = await matcher.match(reqFor(p)); if (hit) shadow.push(`${p} -> ${hit.to}`); }
  eq('no rule shadows the new top-level routes', shadow, []);
}

console.log(`check-redirects: ${fail === 0 ? 'OK' : 'FAILED'} — ${pass} passed / ${fail} failed` + (vendor ? '' : ' (vendor cross-check skipped)'));
process.exit(fail ? 1 : 0);
