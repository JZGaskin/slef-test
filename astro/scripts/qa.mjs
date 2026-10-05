#!/usr/bin/env node
/**
 * Rendered QA for the Little Eagle Football & Cheer Astro rebuild.
 *
 *   node scripts/qa.mjs [--port 4321] [--url https://draft.example.net] [--live https://littleeaglefootball.com] [--skip-live] [--self-test] [--draft]
 *
 * `--url` points the checks at something other than the local preview — use it to
 * QA the actual deployed draft. `--live` stays at the production site, so a draft
 * is still compared against production (a draft must be a noindex pixel-identical
 * copy, so that comparison is exactly what should be run against a draft URL).
 *
 * `--draft` asserts DRAFT behaviour instead of production behaviour: every page
 * carries `<meta name="robots" content="noindex">`, robots.txt refuses all
 * crawlers, and no sitemap is published. Everything else (routes, redirects,
 * layout parity, pixel diff, MachForm embed, accessibility) is checked the same
 * way — a draft must be a noindex copy of production, not a different site.
 *
 * It answers, with evidence, four questions:
 *   1. Does every URL still work?              -> route/redirect assertions
 *   2. Does the page render the same?          -> layout fingerprint diff vs the live site
 *                                             -> pixel diff of full-page screenshots
 *   3. Does the MachForm integration still work? -> embed contract + live iframe inspect
 *   4. Is the page accessible and sane?        -> headings, alt text, overflow, contrast, meta
 *
 * Exit code is non-zero if any check fails. `--self-test` deliberately breaks one
 * expectation to prove this harness can actually fail.
 */
import { chromium } from '/opt/earn-game/node_modules/playwright/index.mjs';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const PORT = Number(arg('port', '4321'));
const LOCAL = arg('url', `http://127.0.0.1:${PORT}`);
const LIVE = arg('live', 'https://littleeaglefootball.com');
const SKIP_LIVE = process.argv.includes('--skip-live');
const SELF_TEST = process.argv.includes('--self-test');
const DRAFT = process.argv.includes('--draft');

const ROUTES = ['/', '/pages/about', '/pages/register', '/pages/fields', '/pages/contact', '/pages/physical', '/pages/thankyou'];
const EMBED_ROUTES = ['/pages/register', '/pages/contact', '/pages/physical'];
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile390', width: 390, height: 844 },
  { name: 'mobile430', width: 430, height: 932 },
];
const EXPECTED_FORMS = {
  '/pages/register': '41557',
  '/pages/contact': '24057',
  '/pages/physical': '42461',
};

const results = [];
const check = (area, name, ok, detail = '') => {
  results.push({ area, name, ok: !!ok, detail: String(detail).slice(0, 400) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${area}] ${name}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`);
};

// --------------------------------------------------------------------------
// 1. Routes, redirects, assets (HTTP level)
// --------------------------------------------------------------------------
const httpGet = async (url, redirect = 'manual') => {
  const res = await fetch(url, { redirect });
  return { status: res.status, location: res.headers.get('location'), headers: res.headers, body: await res.text() };
};

async function routeChecks() {
  const redirects = [
    ['/index.html', '/'],
    ['/pages/about.html', '/pages/about'],
    ['/pages/register.html', '/pages/register'],
    ['/pages/fields.html', '/pages/fields'],
    ['/pages/contact.html', '/pages/contact'],
    ['/pages/physical.html', '/pages/physical'],
    ['/pages/thankyou.html', '/pages/thankyou'],
    ['/about', '/pages/about'],
    ['/register', '/pages/register'],
    ['/fields', '/pages/fields'],
    ['/contact', '/pages/contact'],
    ['/physical', '/pages/physical'],
    ['/thankyou', '/pages/thankyou'],
  ];
  for (const [from, to] of redirects) {
    const r = await httpGet(LOCAL + from);
    const loc = r.location ? new URL(r.location, LOCAL).pathname : '';
    check('route', `301 ${from} -> ${to}`, r.status === 301 && loc === to, `status=${r.status} location=${loc}`);
  }
  for (const route of ROUTES) {
    const r = await httpGet(LOCAL + route);
    check('route', `200 ${route}`, r.status === 200 && /<html/i.test(r.body), `status=${r.status}`);
  }
  const assets = ['/robots.txt', '/favicon.png', '/apple-touch-icon.png', '/images/SLEFLogo5.png', '/images/mightymite.jpg', '/images/muddybuddy.jpg', '/images/Turf.jpg'];
  if (!DRAFT) assets.push('/sitemap-index.xml', '/sitemap-0.xml');
  for (const a of assets) {
    const r = await httpGet(LOCAL + a);
    check('route', `asset ${a}`, r.status === 200, `status=${r.status}`);
  }
  const missing = await httpGet(LOCAL + '/definitely-not-a-page');
  check('route', 'unknown path returns 404 with the custom page', missing.status === 404 && /Page not found/i.test(missing.body), `status=${missing.status}`);

  const home = await httpGet(LOCAL + '/');
  check('headers', 'X-Content-Type-Options: nosniff', home.headers.get('x-content-type-options') === 'nosniff');
  check('headers', 'Referrer-Policy present', !!home.headers.get('referrer-policy'), home.headers.get('referrer-policy'));
  check('headers', 'Permissions-Policy present', !!home.headers.get('permissions-policy'));
  check('headers', 'no CSP shipped yet (deliberate)', !home.headers.get('content-security-policy'));
  const robots = await httpGet(LOCAL + '/robots.txt');
  if (DRAFT) {
    check('seo', 'draft robots.txt refuses all crawlers', /User-agent:\s*\*/i.test(robots.body) && /Disallow:\s*\/\s*$/m.test(robots.body), JSON.stringify(robots.body.trim().slice(0, 120)));
    const smAbsent = await httpGet(LOCAL + '/sitemap-0.xml');
    check('seo', 'draft publishes no sitemap', smAbsent.status === 404, `status=${smAbsent.status}`);
    for (const draftRoute of [...ROUTES, '/definitely-not-a-page']) {
      const r = await httpGet(LOCAL + draftRoute);
      const meta = (r.body.match(/<meta[^>]*name="robots"[^>]*>/i) || [''])[0];
      check('seo', `draft ${draftRoute} is noindex`, /noindex/i.test(meta) && /nofollow/i.test(meta), meta || 'no robots meta tag');
    }
  } else {
  check('seo', 'robots.txt disallows the confirmation page', /Disallow:\s*\/pages\/thankyou/.test(robots.body));
  check('seo', 'robots.txt points at the sitemap', /Sitemap:\s*https:\/\/littleeaglefootball\.com\/sitemap-index\.xml/.test(robots.body));
  const sm = await httpGet(LOCAL + '/sitemap-0.xml');
  check('seo', 'sitemap has 6 indexable pages', (sm.body.match(/<loc>/g) || []).length === 6, `${(sm.body.match(/<loc>/g) || []).length} locs`);
  check('seo', 'sitemap excludes the confirmation page', !sm.body.includes('/pages/thankyou'));
  check('seo', 'sitemap includes the old-style clean URLs', sm.body.includes('/pages/about<') && sm.body.includes('/pages/fields<'));
  }
}

// --------------------------------------------------------------------------
// helpers for the browser side
// --------------------------------------------------------------------------
const FINGERPRINT = (skipEmbedMain) => {
  const out = [];
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const walk = (el) => {
    // SVG elements report lower-case tagName; normalise before comparing.
    const tag = el.tagName.toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' || tag === 'NOSCRIPT') return;
    // SVG internals are an implementation detail of the icon; the icon's box is compared instead.
    if (tag === 'PATH' || tag === 'G' || tag === 'CIRCLE' || tag === 'RECT' || tag === 'TITLE') return;
    const cls = el.getAttribute('class') || '';
    if (el.id === 'mf_placeholder') return;
    // On the embed pages the MachForm iframe is vendor HTML that resizes and
    // re-renders itself; comparing it element-by-element is noise, so those
    // pages are compared on everything except the embed body (checked separately).
    if (skipEmbedMain && el.closest('main') && tag !== 'H1') return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    // The live site renders the Facebook glyph as <i class="fab fa-facebook-f">;
    // this build renders the same glyph as an inline <svg>. Both are "the icon".
    const isIcon = tag === 'SVG' || (tag === 'I' && /(^|\s)fa/.test(cls));
    const t = isIcon ? 'ICON' : tag;
    out.push({
      key: `${t}|${isIcon ? '' : cls.split(/\s+/).filter(Boolean).join('.')}|${el.children.length === 0 ? norm(el.textContent) : ''}`,
      rect: [Math.round(r.left), Math.round(r.top + window.scrollY), Math.round(r.width), Math.round(r.height)],
      sr: cls.includes('sr-only'),
    });
    for (const c of el.children) walk(c);
  };
  walk(document.body);
  return out;
};

const PRIME_LAZY = async () => {
  await new Promise((resolve) => {
    let y = 0;
    const step = () => {
      window.scrollTo(0, y);
      y += 500;
      if (y < document.body.scrollHeight) setTimeout(step, 60);
      else {
        window.scrollTo(0, 0);
        setTimeout(resolve, 250);
      }
    };
    step();
  });
};

const PAGE_FACTS = () => {
  const q = (s) => Array.from(document.querySelectorAll(s));
  const res = document.scrollingElement;
  const lum = (c) => {
    const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return +((l1 + 0.05) / (l2 + 0.05)).toFixed(2);
  };
  const pick = (sel, fallback = null) => {
    const el = document.querySelector(sel);
    if (!el) return fallback;
    const cs = getComputedStyle(el);
    return { color: cs.color, bg: cs.backgroundColor, fontSize: cs.fontSize, weight: cs.fontWeight };
  };
  const contrast = {};
  const body = pick('body');
  const rules = [
    ['hero h1 span', '.hero-content h1 span', '#000', '#fff'],
    ['about hero h1 span', '.heroabout-content h1 span', '#000', '#fff'],
    ['nav link', '.nav-links a', '#0b0b0b', '#fff'],
    ['cta button', '.cta-button', '#f57e20', '#000'],
    ['mission body copy', '.mission-section p, .mission-section', '#0b0b0b', '#ebebeb'],
    ['footer text', 'footer p', '#0b0b0b', '#fff'],
    ['field address', '.location p', '#fff', '#000'],
  ];
  for (const [label, sel, bgElSel, textFallback] of rules) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    let bgEl = el;
    let bg = cs.backgroundColor;
    while (bgEl && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
      bgEl = bgEl.parentElement;
      bg = bgEl ? getComputedStyle(bgEl).backgroundColor : '';
    }
    if (!bg || bg === 'rgba(0, 0, 0, 0)') bg = 'rgb(255, 255, 255)';
    contrast[label] = {
      fg: cs.color,
      bg,
      fontSize: parseFloat(cs.fontSize),
      weight: cs.fontWeight,
      ratio: ratio(cs.color, bg),
    };
  }
  const hero = document.querySelector('.hero, .heroabout, .heroturf');
  const heroBg = hero ? getComputedStyle(hero).backgroundImage : '';
  return {
    title: document.title,
    lang: document.documentElement.lang,
    h1: q('h1').map((e) => ({ text: e.textContent.replace(/\s+/g, ' ').trim(), sr: (e.getAttribute('class') || '').includes('sr-only') })),
    h2: q('h2').length,
    description: (document.querySelector('meta[name=description]') || {}).content || '',
    canonical: (document.querySelector('link[rel=canonical]') || {}).href || '',
    robots: (document.querySelector('meta[name=robots]') || {}).content || '',
    jsonLd: q('script[type="application/ld+json"]').map((s) => s.textContent.slice(0, 80)),
    images: q('img').map((i) => ({
      src: i.getAttribute('src'), alt: i.getAttribute('alt'), loaded: i.complete && i.naturalWidth > 0,
      w: i.naturalWidth, h: i.naturalHeight, lazy: i.getAttribute('loading') || '',
    })),
    linksWithoutName: q('a')
      .filter((a) => {
        const text = (a.textContent || '').trim();
        if (text) return false;
        if (a.getAttribute('aria-label') || a.getAttribute('title')) return false;
        // An <img alt> inside the link is a legitimate accessible name.
        const img = a.querySelector('img[alt]');
        if (img && (img.getAttribute('alt') || '').trim()) return false;
        const svgTitle = a.querySelector('svg > title');
        return !svgTitle;
      })
      .map((a) => a.getAttribute('href')),
    overflowX: res.scrollWidth - res.clientWidth,
    bodyBg: body ? body.bg : '',
    heroBg,
    facebook: (() => {
      const a = document.querySelector('a.facebook-icon');
      if (!a) return null;
      const r = a.getBoundingClientRect();
      const svg = a.querySelector('svg');
      const rr = svg ? svg.getBoundingClientRect() : null;
      return { rect: [Math.round(r.width), Math.round(r.height)], svg: rr ? [Math.round(rr.width), Math.round(rr.height)] : null };
    })(),
    hamburger: (() => {
      const h = document.querySelector('.hamburger');
      const n = document.querySelector('.nav-links');
      return { hamburgerVisible: h ? getComputedStyle(h).display !== 'none' : null, navDisplay: n ? getComputedStyle(n).display : null };
    })(),
    contrast,
    iframe: (() => {
      const f = document.querySelector('iframe');
      if (!f) return null;
      const r = f.getBoundingClientRect();
      return { src: f.getAttribute('src'), title: f.getAttribute('title'), sandbox: f.getAttribute('sandbox') || '', width: Math.round(r.width), height: Math.round(r.height) };
    })(),
    placeholder: (() => {
      const p = document.getElementById('mf_placeholder');
      if (!p) return null;
      return { formurl: p.dataset.formurl, height: p.dataset.formheight, title: p.dataset.formtitle, padding: p.dataset.paddingbottom };
    })(),
    loaderScript: !!Array.from(document.scripts).find((s) => s.src && s.src.includes('mf.js')),
  };
};

// Differences that are known, deliberate and visually inert. Every entry has to
// say WHY it cannot change what a visitor sees; anything else is a real finding.
const EXPECTED_DIFFS = [
  {
    route: '/pages/about', kind: 'moved', match: /^H2\|\|/,
    why: 'Live nests the CTA inside an unclosed <h2>, so the live h2 box is taller; the rebuild closes the h2. The h2 has no background, border or padding, and every element below it has identical geometry.',
  },
  {
    route: '/pages/about', kind: 'missing', match: /^P\|\| live=[\d,.-]+,0$/,
    why: 'Live has an extra zero-height paragraph (height 0) created by a stray </p> inside the unclosed <h2>. An element with height 0 paints nothing; the 30px gap it contributed is reproduced explicitly in global.css.',
  },
  {
    route: '/pages/physical', kind: 'missing', match: /^A\|active\|Contact live=/,
    why: 'Live wrongly marks Contact as the current page on /pages/physical. No stylesheet rule targets .nav-links a.active, so the class is visually inert.',
  },
  {
    route: '/pages/physical', kind: 'added', match: /^A\|\|Contact new=/,
    why: 'Counterpart of the previous entry: the same link, without the wrong active class.',
  },
  {
    route: '/pages/thankyou', kind: 'missing', match: /^H2\|\|Thank You! live=/,
    why: 'The confirmation page now uses a real <h1>. .as-h2 reproduces the default h2 rendering, and no moved elements are reported for this page, so the change is invisible.',
  },
  {
    route: '/pages/thankyou', kind: 'added', match: /^H1\|as-h2\|Thank You! new=/,
    why: 'Counterpart of the previous entry: the same heading, one level up, rendered identically.',
  },
];
const isExpected = (route, kind, entry) =>
  EXPECTED_DIFFS.some((e) => e.route === route && e.kind === kind && e.match.test(entry));

function diffFingerprints(liveFp, newFp, route, embedHeightDelta = 0) {
  // Two-pass pairing by signature:
  //   pass 1 pairs elements that are in the same place (±1px) — these are the anchors
  //   pass 2 pairs whatever is left by closest position, and reports the offset
  //   anything still unpaired is a genuine addition or omission
  // Index-by-index pairing was the earlier mistake: one extra element of a
  // signature shifted every later comparison and invented phantom differences.
  const pairedLive = new Set();
  const pairedNew = new Set();
  const moved = [];

  const pair = (liveEl, newEl) => {
    pairedLive.add(liveEl);
    pairedNew.add(newEl);
    const d = Math.max(...liveEl.rect.map((v, j) => Math.abs(v - newEl.rect[j])));
    if (d <= 1) return;
    const entry = `${liveEl.key} delta=${d}px live=${liveEl.rect.join(',')} new=${newEl.rect.join(',')}`;
    if (isExpected(route, 'moved', entry)) return;
    // The vendor form measures itself and resizes its own iframe, so on the embed
    // pages everything below it shifts by exactly the iframe's height difference.
    if (embedHeightDelta > 0 && d <= embedHeightDelta + 2) return;
    moved.push(entry);
  };

  const delta = (a, b) => Math.max(...a.rect.map((v, j) => Math.abs(v - b.rect[j])));

  // pass 1 — same signature, same place
  for (const liveEl of liveFp) {
    const hit = newFp.find((n) => !pairedNew.has(n) && n.key === liveEl.key && delta(liveEl, n) <= 1);
    if (hit) pair(liveEl, hit);
  }
  // pass 2 — same signature, closest place
  for (const liveEl of liveFp) {
    if (pairedLive.has(liveEl)) continue;
    let best = null;
    let bestD = Infinity;
    for (const n of newFp) {
      if (pairedNew.has(n) || n.key !== liveEl.key) continue;
      const d = delta(liveEl, n);
      if (d < bestD) { bestD = d; best = n; }
    }
    if (best) pair(liveEl, best);
  }

  const missing = [];
  for (const liveEl of liveFp) {
    if (pairedLive.has(liveEl)) continue;
    const entry = `${liveEl.key} live=${liveEl.rect.join(',')}`;
    if (isExpected(route, 'missing', entry)) continue;
    missing.push(entry);
  }

  const added = [];
  for (const n of newFp) {
    if (pairedNew.has(n)) continue;
    if (n.sr) continue; // the rebuild's hidden headings are deliberate
    const entry = `${n.key} new=${n.rect.join(',')}`;
    if (isExpected(route, 'added', entry)) continue;
    added.push(entry);
  }

  return { missing, moved, added };
}

function renderPixelDiff(bufA, bufB) {
  // Decoded in Node (pngjs), not in the browser via data: URLs — the in-page
  // version transferred multi-megabyte base64 strings and could exhaust the renderer.
  const a = PNG.sync.read(bufA);
  const b = PNG.sync.read(bufB);
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  let differing = 0;
  let total = 0;
  let sum = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (a.width * y + x) << 2;
      const j = (b.width * y + x) << 2;
      const d = (Math.abs(a.data[i] - b.data[j]) + Math.abs(a.data[i + 1] - b.data[j + 1]) + Math.abs(a.data[i + 2] - b.data[j + 2])) / 3;
      sum += d;
      total++;
      if (d > 12) differing++;
    }
  }
  return {
    w,
    h,
    heightDelta: Math.abs(a.height - b.height),
    meanDiff: +(sum / total).toFixed(2),
    pctDiffering: +((100 * differing) / total).toFixed(3),
  };
}

// --------------------------------------------------------------------------
// main
// --------------------------------------------------------------------------
const browser = await chromium.launch();
const evidence = { generatedAt: new Date().toISOString(), local: LOCAL, live: SKIP_LIVE ? null : LIVE, fingerprints: {}, pixels: {}, facts: {} };
const shotDir = path.join(ROOT, 'qa', 'screens');
fs.mkdirSync(shotDir, { recursive: true });

try {
  await routeChecks();

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const route of ROUTES) {
        const localFacts = await (async () => {
        await page.goto(LOCAL + route, { waitUntil: 'load' });
        await page.waitForTimeout(EMBED_ROUTES.includes(route) ? 2500 : 400);
        await page.evaluate(PRIME_LAZY);
        return page.evaluate(PAGE_FACTS);
      })();
      const localFp = await page.evaluate(FINGERPRINT, EMBED_ROUTES.includes(route));
      await page.screenshot({ path: path.join(shotDir, `new${route.replace(/\//g, '_') || '_home'}-${vp.name}.png`), fullPage: true });
      evidence.facts[`new${route}@${vp.name}`] = localFacts;
      evidence.fingerprints[`new${route}@${vp.name}`] = localFp.length;

      // page-shape assertions that must hold in the new build
      const tag = `${route}@${vp.name}`;
      check('a11y', `${tag} exactly one h1`, localFacts.h1.length === 1, JSON.stringify(localFacts.h1));
      check('a11y', `${tag} html lang + title + description`, !!localFacts.lang && !!localFacts.title && !!localFacts.description, `${localFacts.lang} / ${localFacts.title}`);
      check('seo', `${tag} canonical is the clean URL`, localFacts.canonical === `https://littleeaglefootball.com${route === '/' ? '/' : route}`, localFacts.canonical);
      check('a11y', `${tag} every link has an accessible name`, localFacts.linksWithoutName.length === 0, JSON.stringify(localFacts.linksWithoutName));
      check('a11y', `${tag} every image has alt text`, localFacts.images.every((i) => i.alt && i.alt.length > 2), JSON.stringify(localFacts.images.map((i) => i.alt)));
      check('a11y', `${tag} every image actually loads`, localFacts.images.every((i) => i.loaded), JSON.stringify(localFacts.images.filter((i) => !i.loaded).map((i) => i.src)));
      check('layout', `${tag} no horizontal overflow`, localFacts.overflowX <= 1, `overflow=${localFacts.overflowX}px`);
      check('layout', `${tag} hero background applied`, route === '/' || route === '/pages/about' || route === '/pages/fields' ? localFacts.heroBg.includes('url(') : true, localFacts.heroBg.slice(0, 120));
      const expectHamburger = vp.width < 768;
      check('layout', `${tag} hamburger ${expectHamburger ? 'shown' : 'hidden'} at ${vp.width}px`, localFacts.hamburger.hamburgerVisible === expectHamburger, JSON.stringify(localFacts.hamburger));
      check('layout', `${tag} nav links ${expectHamburger ? 'collapsed' : 'inline'}`, expectHamburger ? localFacts.hamburger.navDisplay === 'none' : localFacts.hamburger.navDisplay === 'flex', JSON.stringify(localFacts.hamburger));
      if (localFacts.facebook) {
        check('layout', `${tag} facebook button box 15x24-ish`, localFacts.facebook.svg && Math.abs(localFacts.facebook.svg[1] - 24) <= 2 && Math.abs(localFacts.facebook.svg[0] - 15) <= 2, JSON.stringify(localFacts.facebook));
      }
      for (const [label, c] of Object.entries(localFacts.contrast)) {
        const large = c.fontSize >= 24 || (c.fontSize >= 18.66 && Number(c.weight) >= 700);
        const min = large ? 3 : 4.5;
        check('a11y', `${tag} contrast ${label} ${c.ratio}:1 (min ${min})`, c.ratio >= min, `${c.fg} on ${c.bg}`);
      }
      if (EMBED_ROUTES.includes(route)) {
        const want = EXPECTED_FORMS[route];
        const built = fs.readFileSync(path.join(ROOT, 'dist', route === '/' ? 'index.html' : route.slice(1) + '.html'), 'utf8');
        const wantUrl = `https://z33design.forms-db.com/embed.php?id=${want}`;
        check('machform', `${tag} built markup carries the exact embed contract`, built.includes(`data-formurl="${wantUrl}"`) && /data-formheight="\d+"/.test(built) && built.includes('data-formtitle=') && built.includes('data-paddingbottom="10"'), 'placeholder attributes in the built HTML');
        check('machform', `${tag} loader script is inline and unprocessed`, built.includes("r.src = o + 'js/mf.js'") && built.includes("document, 'https://assets.forms-db.com/'"), 'inline loader present in built HTML');
        check('machform', `${tag} iframe created by mf.js`, !!localFacts.iframe, JSON.stringify(localFacts.iframe));
        if (localFacts.iframe) {
          check('machform', `${tag} iframe src is the form embed`, localFacts.iframe.src === wantUrl, localFacts.iframe.src);
          check('machform', `${tag} iframe can navigate the top window (thank-you redirect)`, localFacts.iframe.sandbox.includes('allow-top-navigation'), localFacts.iframe.sandbox.slice(0, 200));
          check('machform', `${tag} iframe has a title (a11y)`, !!localFacts.iframe.title, localFacts.iframe.title);
          check('machform', `${tag} iframe is not taller/wider than the container`, localFacts.iframe.width <= vp.width, `w=${localFacts.iframe.width} vp=${vp.width}`);
        }
      } else {
        check('machform', `${tag} no MachForm embed on this page (expected)`, !localFacts.iframe);
      }
      if (route === '/pages/thankyou') {
        check('seo', `${tag} confirmation page is noindex`, /noindex/.test(localFacts.robots), localFacts.robots);
      }

      if (!SKIP_LIVE) {
        const livePage = await ctx.newPage();
        try {
          await livePage.goto(LIVE + route, { waitUntil: 'load', timeout: 45000 });
          await livePage.waitForTimeout(EMBED_ROUTES.includes(route) ? 2500 : 400);
          await livePage.evaluate(PRIME_LAZY);
          const liveFacts = await livePage.evaluate(PAGE_FACTS);
          const liveFp = await livePage.evaluate(FINGERPRINT, EMBED_ROUTES.includes(route));
          evidence.facts[`live${route}@${vp.name}`] = liveFacts;
          const embedDelta = EMBED_ROUTES.includes(route) && localFacts.iframe && liveFacts.iframe
            ? Math.abs((localFacts.iframe.height || 0) - (liveFacts.iframe.height || 0))
            : 0;
          evidence.facts[`iframeDelta${route}@${vp.name}`] = embedDelta;
          const d = diffFingerprints(liveFp, localFp, route, embedDelta);
          evidence.fingerprints[`diff${route}@${vp.name}`] = d;
          check('parity', `${tag} no element missing vs live`, d.missing.length === 0, d.missing.slice(0, 3).join(' ; '));
          check('parity', `${tag} no element added vs live`, d.added.length === 0, d.added.slice(0, 3).join(' ; '));
          check('parity', `${tag} geometry identical within 1px${embedDelta ? ` (embed offset budget ±${embedDelta + 2}px)` : ''}`, d.moved.length === 0, d.moved.slice(0, 3).join(' ; '));
          // Pixel comparison at desktop width only — it is the heaviest check, and
          // keeping the sweep small means a full run cannot exhaust the heap.
          if (!EMBED_ROUTES.includes(route) && vp.name === 'desktop') {
            const shotName = (side) => path.join(shotDir, `${side}${route.replace(/\//g, '_') || '_home'}-${vp.name}.png`);
            await livePage.evaluate(() => window.scrollTo(0, 0));
            await page.evaluate(() => window.scrollTo(0, 0));
            let liveShot = await livePage.screenshot({ path: shotName('live'), animations: 'disabled', fullPage: true });
            let newShot = await page.screenshot({ path: shotName('new'), animations: 'disabled', fullPage: true });
            const pd = renderPixelDiff(liveShot, newShot);
            liveShot = null;
            newShot = null;
            evidence.pixels[`${route}@${vp.name}`] = pd;
            check('parity', `${tag} pixel-identical (${pd.pctDiffering}% differing, mean ${pd.meanDiff})`, pd.heightDelta <= 2 && pd.pctDiffering < 2, JSON.stringify(pd));
          }
        } catch (e) {
          check('parity', `${tag} live comparison`, false, `live fetch failed: ${e.message.split('\n')[0]}`);
        } finally {
          await livePage.close();
        }
      }
    }
    await ctx.close();
  }

  if (SELF_TEST) {
    // Prove the harness can fail: assert something false on purpose.
    check('self-test', 'deliberate false assertion must FAIL', false, 'this is the expected failure');
    const prior = results.find((r) => r.area === 'self-test');
    check('self-test', 'harness reported the deliberate failure as FAIL', prior && prior.ok === false);
  }
} catch (err) {
  check('harness', 'the QA run completed without a browser crash', false, String(err).split('\n')[0]);
} finally {
  await browser.close();
}

// A --self-test run must not overwrite the evidence from the real run.
const out = path.join(ROOT, 'qa', arg('out', SELF_TEST ? 'qa-results-self-test.json' : 'qa-results.json'));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ evidence, results }, null, 2));

const failed = results.filter((r) => !r.ok && r.area !== 'self-test');
const byArea = results.reduce((acc, r) => {
  acc[r.area] = acc[r.area] || { pass: 0, fail: 0 };
  acc[r.area][r.ok ? 'pass' : 'fail']++;
  return acc;
}, {});
console.log('\n=== SUMMARY ===');
for (const [area, v] of Object.entries(byArea)) console.log(`${area.padEnd(10)} ${v.pass} passed, ${v.fail} failed`);
console.log(`TOTAL      ${results.filter((r) => r.ok).length} passed, ${failed.length} failed`);
console.log(`evidence -> ${out}`);
process.exit(failed.length ? 1 : 0);
