#!/usr/bin/env node
/**
 * Final launch gate — `SITE_LAUNCH_PROCESS.md` §9, mechanically.
 *
 *   node scripts/launch-gate.mjs --dir build/dist-prod
 *   node scripts/launch-gate.mjs --url https://littleeaglefootball.com --production
 *
 * It checks the ARTIFACT and, when --url is given, the SERVED site. It does not
 * replace the rendered QA (`qa-redesign.mjs`) or the browser launch suite: those
 * prove interaction, this proves the launch conditions that must never be true.
 *
 * Exit 0 = every check passed. Exit 1 = at least one failed (named on stdout).
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseRedirectsFile } from './lib/redirects.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const DIR = arg('dir', 'build/dist-prod');
const URL = arg('url', null);
const PRODUCTION = process.argv.includes('--production');

let pass = 0; const fails = [];
const ok = (c, label, detail = '') => { if (c) pass++; else fails.push(`${label}${detail ? ` — ${detail}` : ''}`); };
const read = (p) => fs.readFileSync(p, 'utf8');

if (DIR) {
  const dir = path.resolve(DIR);
  if (!fs.existsSync(dir)) { console.error(`no bundle at ${dir}`); process.exit(2); }
  const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.html')).sort();
  const html = Object.fromEntries(pages.map((p) => [p, read(path.join(dir, p))]));

  ok(pages.length >= 6, 'public pages built', pages.join(', '));
  ok(pages.every((p) => /data-z33-build="little-eagle-redesign"/.test(html[p])), 'build identity on every page');
  ok(!pages.some((p) => p !== '404.html' && /noindex, nofollow/.test(html[p])), 'no draft noindex in production pages');
  ok(/noindex/.test(html['404.html'] ?? ''), '404 stays noindex');

  ok(!fs.existsSync(path.join(dir, 'styleguide.html')), 'no /styleguide in the production bundle');

  const robots = read(path.join(dir, 'robots.txt'));
  ok(/^Allow: \/$/m.test(robots), 'robots allows crawling');
  ok(/^Disallow: \/thankyou$/m.test(robots), 'robots keeps /thankyou out');
  ok(/^Sitemap: https:\/\/littleeaglefootball\.com\/sitemap-index\.xml$/m.test(robots), 'robots points at the sitemap');

  const sm = fs.readdirSync(dir).filter((f) => f.startsWith('sitemap'));
  ok(sm.length >= 2, 'sitemap published', sm.join(', '));
  const smBody = sm.filter((f) => f.endsWith('.xml')).map((f) => read(path.join(dir, f))).join('\n');
  ok(!/styleguide|thankyou|\/404/.test(smBody), 'sitemap excludes styleguide, thankyou, 404');
  ok(smBody.includes('https://littleeaglefootball.com/'), 'sitemap advertises the production host');

  for (const p of ['index.html', 'register.html', 'physical.html', 'contact.html', 'thankyou.html', '404.html']) {
    ok(fs.existsSync(path.join(dir, p)), `route built: ${p}`);
  }

  const redirects = read(path.join(dir, '_redirects'));
  ok(redirects === read('public/_redirects'), '_redirects matches the source map');
  const { rules, errors: redirectErrors } = parseRedirectsFile(redirects);
  ok(redirectErrors.length === 0, 'redirect map parses cleanly', redirectErrors.join('; '));
  ok(rules.length >= 17, 'redirect map covers the retired routes', `${rules.length} rule(s)`);
  for (const { from, to, status } of rules) {
    ok(status === 301, `redirect ${from} -> ${to} is 301`, `status ${status}`);
  }

  const allHtml = Object.values(html).join('\n');
  const imgs = [...allHtml.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  ok(imgs.length > 0, 'photographs present');
  ok(imgs.every((t) => /data-asset-status="approved"/.test(t)), 'every <img> is approved');
  ok(!imgs.some((t) => /temporary-facebook-asset/.test(t)), 'no temporary imagery');
  // alt="" is legitimate for a decorative logo paired with a text wordmark; the
  // requirement is that the attribute is DECLARED, never omitted.
  ok(imgs.every((t) => /alt="[^"]*"/.test(t) && /width="\d+"/.test(t) && /height="\d+"/.test(t)), 'every <img> declares alt + dimensions');

  const og = html['index.html'].match(/property="og:image" content="([^"]+)"/)?.[1] ?? '';
  const ogFile = og.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '');
  ok(og.includes('littleeaglefootball.com'), 'og:image uses the production host', og);
  ok(ogFile && fs.existsSync(path.join(dir, ogFile)), 'og:image resolves to a built file', ogFile || '(none)');
  ok(/hero-cover/.test(og), 'og:image is an approved asset (fieldNight)', og);

  ok(!/coming soon|photography to come/i.test(allHtml), 'no visible placeholder copy');

  // The only permitted placeholder is the hidden, empty internal declaration.
  let hiddenOnly = true; let declared = 0;
  for (const [name, body] of Object.entries(html)) {
    for (const m of body.matchAll(/data-asset-status="temporary-placeholder"[^>]*/g)) {
      declared++;
      const open = body.lastIndexOf('<', m.index), close = body.indexOf('>', m.index);
      if (!/\shidden(\s|>)/.test(body.slice(open, close + 1))) hiddenOnly = false;
    }
  }
  ok(hiddenOnly, 'every declared placeholder is hidden (not visitor-facing)', `${declared} declaration(s)`);

  console.log(`launch-gate: bundle ${DIR} — ${pages.length} pages, ${imgs.length} images`);
}

if (URL) {
  const base = URL.replace(/\/$/, '');
  const get = async (p) => {
    const r = await fetch(base + p, { redirect: 'manual', headers: { 'cache-control': 'no-cache' } });
    return { status: r.status, headers: r.headers, body: await r.text() };
  };
  for (const p of ['/', '/register', '/physical', '/contact', '/thankyou']) {
    const r = await get(p);
    ok(r.status === 200, `live ${p} returns 200`, `got ${r.status}`);
  }
  const sg = await get('/styleguide');
  ok(sg.status === 404, 'live /styleguide is not served', `got ${sg.status}`);

  for (const legacy of ['/pages/about', '/pages/fields', '/about', '/fields', '/index.html']) {
    const r = await get(legacy);
    ok([301, 308].includes(r.status), `live ${legacy} redirects`, `got ${r.status}`);
    if (r.status === 301 || r.status === 308) {
      const loc = r.headers.get('location') ?? '';
      ok(loc.endsWith('/') || loc === '/', `live ${legacy} lands on /`, loc);
    }
  }
  const nf = await get('/this-page-does-not-exist-31337');
  ok(nf.status === 404, 'live unknown route is 404', `got ${nf.status}`);

  const home = await get('/');
  ok(/data-z33-build="little-eagle-redesign"/.test(home.body), 'live homepage is the Astro build, not the legacy site');
  ok(!/noindex, nofollow/.test(home.body), 'live homepage is indexable');
  ok(!/font-awesome/.test(home.body), 'live homepage no longer serves the legacy stylesheet');
  ok(/<h1[^>]*>/.test(home.body), 'live homepage carries an H1');

  if (PRODUCTION) {
    ok(base.startsWith('https://'), 'production URL is HTTPS');
    ok(/max-age=31536000/.test(home.headers.get('strict-transport-security') ?? ''), 'HSTS present');
    ok(!/noindex/i.test(home.headers.get('x-robots-tag') ?? ''), 'no draft X-Robots-Tag on production');
  }
  console.log(`launch-gate: url ${base}`);
}

console.log(`\nlaunch-gate: ${pass} passed / ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('LAUNCH GATE PASSED');
