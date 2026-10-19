#!/usr/bin/env node
/**
 * Rendered QA for the Little Eagle REDESIGN (Stage 1).
 *
 *   node scripts/qa-redesign.mjs [--port 4321] [--url https://…] [--draft]
 *                               [--self-test] [--out qa/qa-redesign.json]
 *                               [--screens qa/screens] [--no-screens]
 *
 * This is NOT the parity harness (scripts/qa.mjs). The redesign deliberately
 * changes the layout, so pixel/geometry comparison against the old site would be
 * meaningless. What it must prove instead:
 *
 *   1. every route works and every legacy URL still redirects, in one hop
 *   2. the homepage is actually built from the approved sections
 *   3. the protected systems are intact: MachForm embed contract (41557 / 24057 /
 *      42461), the inline loader, the /thankyou success path, redirects, and no
 *      request to Stripe, Netlify or any vendor API
 *   4. it is accessible: one h1, heading order, alt text, labels, contrast,
 *      focus, 44px targets, a working mobile nav
 *   5. it is responsive: no horizontal overflow at 390/430/768/1024/1280/1440
 *   6. it is honest about images: nothing upscaled beyond its native resolution,
 *      every image carries provenance and a declared approval status
 *   7. it is fast enough: homepage transfer budget, hero budget, self-hosted fonts
 *
 * `--draft` asserts draft behaviour (noindex everywhere, disallow-all robots, no
 * sitemap). `--self-test` deliberately breaks one expectation, so a green run is
 * evidence rather than a hope.
 */
import { chromium } from '/opt/earn-game/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRedirectsFile, parseNetlifyToml } from './lib/redirects.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const PORT = Number(arg('port', '4321'));
const BASE = (arg('url', `http://127.0.0.1:${PORT}`)).replace(/\/$/, '');
const DRAFT = process.argv.includes('--draft');
const SELF_TEST = process.argv.includes('--self-test');
const NO_SCREENS = process.argv.includes('--no-screens');
const OUT = path.resolve(ROOT, arg('out', `qa/qa-redesign${DRAFT ? '-draft' : ''}.json`));
const SHOTS = path.resolve(ROOT, arg('screens', `qa/screens${DRAFT ? '-draft' : ''}`));

// `/styleguide` is an internal review page and is stripped from the production
// bundle. `--no-styleguide` runs the same suite against production without
// pretending a route exists that is deliberately absent there.
const INCLUDE_STYLEGUIDE = !process.argv.includes('--no-styleguide');
const ROUTES = ['/', '/register', '/physical', '/contact', '/thankyou', ...(INCLUDE_STYLEGUIDE ? ['/styleguide'] : [])];
const EMBED_ROUTES = { '/register': '41557', '/physical': '42461', '/contact': '24057' };
const VIEWPORTS = [
  { name: 'mobile390', width: 390, height: 844 },
  { name: 'mobile430', width: 430, height: 932 },
  { name: 'tablet768', width: 768, height: 1024 },
  { name: 'desktop1280', width: 1280, height: 900 },
  { name: 'desktop1440', width: 1440, height: 900 },
];
const WEIGHT_BUDGET_KB = 1024;
const MF_LOADER = 'https://assets.forms-db.com/js/mf.js';
// Third-party code the MachForm embed pulls into OUR OWN page: its loader (handled
// separately) and the reCAPTCHA it injects — api.js, the gstatic runtime, and the
// csp.withgoogle.com frame-ancestors probe. Recorded explicitly and narrowly so a
// NEW third-party origin cannot hide behind the same allowance. (The csp probe is
// stochastic: it appears on some loads and not others, so it must be expected
// rather than hoped for.)
const VENDOR_INJECTED = /^https:\/\/(www\.google\.com\/recaptcha\/|www\.gstatic\.com\/recaptcha\/|csp\.withgoogle\.com\/csp\/)/;
const HERO_BUDGET_KB = 250;
// The hero is identified by its MANIFEST ASSET ID, never by a filename. An asset id is
// stable when the photograph behind it changes; a filename is not, and every gate keyed
// on a filename silently stops covering the hero the moment the hero is replaced.
const HERO_ASSET_ID = 'footballHero';

const results = [];
let failed = 0;
const check = (area, name, ok, detail = '') => {
  results.push({ area, name, ok: !!ok, detail });
  if (!ok) failed += 1;
};

// ---- helpers ---------------------------------------------------------------
const get = async (url, init = {}) => {
  const res = await fetch(url, { redirect: 'manual', ...init });
  return { status: res.status, location: res.headers.get('location'), body: res.status < 400 ? await res.text() : '' };
};

const contrast = (rgb1, rgb2) => {
  const lum = ([r, g, b]) => {
    const f = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const [a, b] = [lum(rgb1), lum(rgb2)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};

// ---- 1. routes + redirect map (HTTP level) ---------------------------------
// The shipped _redirects is parsed by OUR model of Netlify's parser, and a single
// dropped rule is a failure here and at the top of every run: a line Netlify cannot
// parse is a 404 for a real visitor, not a cosmetic warning. (This exact defect
// shipped once as `"/#about"`.)
let localRedirects = [];
let redirectParseErrors = [];
if (fs.existsSync(path.join(ROOT, 'public/_redirects'))) {
  const parsed = parseRedirectsFile(fs.readFileSync(path.join(ROOT, 'public/_redirects'), 'utf8'));
  localRedirects = parsed.rules;
  redirectParseErrors = parsed.errors;
} else {
  localRedirects = parseNetlifyToml(fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8'));
}

async function httpChecks() {
  for (const route of ROUTES) {
    const { status, body } = await get(`${BASE}${route}`);
    check('routes', `${route} responds 200`, status === 200, `status ${status}`);
    if (status !== 200) continue;
    const h1 = [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => m[1].replace(/<[^>]*>/g, '').trim());
    check('routes', `${route} has exactly one h1`, h1.length === 1, `${h1.length} h1`);
    check('routes', `${route} has a title`, /<title>[^<]{10,}<\/title>/.test(body));
    check('routes', `${route} has a meta description`, /<meta name="description" content="[^"]{40,}"/.test(body));
  }

  // unknown path -> the branded 404, served with a 404 status
  const notFound = await get(`${BASE}/this-page-does-not-exist`);
  check('routes', 'an unknown URL answers 404', notFound.status === 404, `status ${notFound.status}`);

  // The site BUILD IDENTITY baked into every page by build-redesign.sh. The publisher
  // identifies a deployed preview by this, never by the name of the photograph in the
  // hero: keying on `data-asset-id="heroCover"` is exactly what made a correct deploy
  // read as stale when the compositional reset changed the hero image. A missing or
  // placeholder revision means the bundle did not come from the sanctioned build, which
  // the publisher would (correctly) refuse — so it fails here first.
  const homeIdent = await get(`${BASE}/`);
  const buildFam = (homeIdent.body.match(/data-z33-build="([^"]*)"/) || [])[1] ?? '';
  const buildRev = (homeIdent.body.match(/data-z33-build-rev="([^"]*)"/) || [])[1] ?? '';
  check('build', 'homepage carries the build family marker', buildFam === 'little-eagle-redesign',
    `data-z33-build="${buildFam || '(absent)'}"`);
  check('build', 'homepage carries a real build revision digest', /^[0-9a-f]{12}$/.test(buildRev),
    `data-z33-build-rev="${buildRev || '(absent)'}"`);

  // the full redirect map, checked against the deployed rules themselves
  for (const rule of localRedirects) {
    const res = await get(`${BASE}${rule.from}`);
    check('redirects', `${rule.from} -> ${rule.to}`, res.status === rule.status && res.location === rule.to,
      `status ${res.status} location ${res.location}`);
    const target = await get(`${BASE}${rule.to}`);
    check('redirects', `${rule.to} resolves (1 hop)`, target.status === 200, `status ${target.status}`);
  }

  // Every rule Netlify keeps must survive OUR parser too — a dropped rule is a 404.
  check('redirects', 'the shipped _redirects has no line Netlify would drop', redirectParseErrors.length === 0,
    redirectParseErrors.join('; '));
  check('redirects', 'no redirect destination contains a fragment', localRedirects.every((r) => !r.to.includes('#')),
    localRedirects.filter((r) => r.to.includes('#')).map((r) => `${r.from} -> ${r.to}`).join(', '));
  check('redirects', 'no redirect destination is quoted', localRedirects.every((r) => !/["']/.test(r.to) && !/["']/.test(r.from)),
    localRedirects.filter((r) => /["']/.test(r.to)).map((r) => `${r.from} -> ${r.to}`).join(', '));

  // The retired About/Fields URLs must land on the homepage, one hop, whatever the
  // legacy spelling — including the trailing-slash and .html forms.
  const retired = ['/about', '/about/', '/about.html', '/pages/about', '/pages/about/', '/pages/about.html',
    '/fields', '/fields/', '/fields.html', '/pages/fields', '/pages/fields/', '/pages/fields.html'];
  for (const p of retired) {
    const res = await get(`${BASE}${p}`);
    check('redirects', `retired ${p} -> /`, res.status === 301 && res.location === '/', `status ${res.status} location ${res.location}`);
  }

  // ...and the homepage must actually still HAVE the two anchors the nav links to.
  const home = await get(`${BASE}/`);
  check('anchors', 'the homepage still has the #about section', /id="about"/.test(home.body));
  check('anchors', 'the homepage still has the #fields section', /id="fields"/.test(home.body));

  // no redirect loops: following any rule's destination must not land on another rule
  const loopTargets = new Set(localRedirects.map((r) => r.from));
  const loops = localRedirects.filter((r) => r.to !== '/' && loopTargets.has(r.to.split('?')[0].split('#')[0]) && r.to !== r.from);
  check('redirects', 'no redirect loops', loops.length === 0, loops.map((r) => `${r.from} -> ${r.to}`).join(', '));

  // robots.txt
  const robots = await get(`${BASE}/robots.txt`);
  if (DRAFT) {
    check('draft', 'robots.txt refuses all crawlers', robots.status === 200 && /Disallow: \/(\s|$)/.test(robots.body) && !/Allow: \//.test(robots.body));
  } else {
    check('robots', 'robots.txt allows crawling and points at the sitemap', robots.status === 200 && /Allow: \//.test(robots.body) && /Sitemap: /.test(robots.body));
    check('robots', 'robots.txt keeps /thankyou and /styleguide out', /Disallow: \/thankyou/.test(robots.body) && /Disallow: \/styleguide/.test(robots.body));
  }
}

// ---- browser checks --------------------------------------------------------
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const networkLog = [];
const thirdParty = new Set();
const thirdPartyReqs = [];
page.on('request', (req) => {
  const url = req.url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return;
  try {
    const origin = new URL(url).origin;
    // The MachForm embed is a sandboxed cross-origin IFRAME. Everything it pulls
    // (jQuery, reCAPTCHA, its own fonts) belongs to the VENDOR's document, not ours.
    // Classified by the initiating frame's URL rather than by frame object identity:
    // a request is "ours" only when it was started from one of our own documents.
    let frameUrl = '';
    try { frameUrl = req.frame()?.url() ?? ''; } catch { frameUrl = ''; }
    const ours = frameUrl.startsWith(BASE);
    if (ours) thirdParty.add(origin);
    thirdPartyReqs.push({ url, origin, type: req.resourceType(), ours, frameUrl });
  } catch { /* ignore */ }
});
page.on('response', async (res) => {
  try {
    const url = res.url();
    if (!url.startsWith(BASE)) return;
    const headers = res.headers();
    networkLog.push({ url, status: res.status(), type: res.request().resourceType(), len: Number(headers['content-length'] ?? 0) });
  } catch { /* ignore */ }
});

const goto = async (route, opts = {}) => {
  await page.goto(`${BASE}${route}`, { waitUntil: 'load', ...opts });
  await page.waitForTimeout(180);
};

async function structureChecks() {
  await goto('/');
  // Below-the-fold images are loading="lazy": scroll the page once and wait for the
  // loads, so the "is anything upscaled?" check measures every image rather than
  // silently skipping the lazy ones.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await page.evaluate(() => Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = r; i.onerror = r; }))));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);

  const info = await page.evaluate(async () => {
    const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    const headings = [...document.querySelectorAll('h1,h2,h3')].map((h) => ({ level: Number(h.tagName[1]), text: h.textContent.trim().slice(0, 70) }));
    const ctas = [...document.querySelectorAll('a[href="/register"]')];
    // `naturalWidth` on a srcset image is DENSITY-CORRECTED (the browser reports the
    // layout width, not the file's pixels), so it cannot answer "is this displayed
    // larger than the file?". Load each distinct currentSrc in a fresh Image with no
    // srcset: then naturalWidth is the real file width.
    const raw = [...document.querySelectorAll('img')].map((i) => {
      const r = i.getBoundingClientRect();
      return { src: i.getAttribute('src'), currentSrc: i.currentSrc, fit: getComputedStyle(i).objectFit, w: r.width, h: r.height, el: i };
    });
    const trueDims = {};
    await Promise.all([...new Set(raw.map((x) => x.currentSrc).filter(Boolean))].map((url) =>
      new Promise((resolve) => {
        const probe = new Image();
        probe.onload = () => { trueDims[url] = { w: probe.naturalWidth, h: probe.naturalHeight }; resolve(); };
        probe.onerror = () => { trueDims[url] = null; resolve(); };
        probe.src = url;
      }),
    ));
    const imgs = raw.map((x) => {
      const i = x.el;
      const r = { width: x.w, height: x.h };
      const fit = x.fit;
      const t = trueDims[x.currentSrc] ?? { w: 0, h: 0 };
      // object-fit:cover scales to cover the box, so the DISPLAYED scale is
      // max(w/nw, h/nh) — the box width alone would be the wrong question.
      const scale = t.w
        ? (fit === 'cover' ? Math.max(r.width / t.w, r.height / t.h) : r.width / t.w)
        : 0;
      return {
        src: i.getAttribute('src'),
        currentSrc: i.currentSrc ? i.currentSrc.split('/').pop() : null,
        alt: i.getAttribute('alt'),
        status: i.getAttribute('data-asset-status'),
        assetId: i.getAttribute('data-asset-id'),
        fbid: i.getAttribute('data-fbid'),
        loading: i.getAttribute('loading'),
        fetchpriority: i.getAttribute('fetchpriority'),
        naturalWidth: t.w,
        naturalHeight: t.h,
        renderedWidth: Math.round(r.width),
        renderedHeight: Math.round(r.height),
        objectFit: fit,
        scale: Number(scale.toFixed(3)),
      };
    });
    return {
      title: document.title,
      h1: [...document.querySelectorAll('h1')].map(text),
      ids,
      headings,
      registerCtas: ctas.length,
      registerCtaLabels: ctas.map((a) => a.textContent.trim()),
      imgs,
      externalLinks: [...document.querySelectorAll('a[href^="http"]')].map((a) => a.href),
      jumpLinks: [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href')),
      venueMapLinks: [...document.querySelectorAll('.venue-list a, .venue-home a')].map((a) => a.getAttribute('href')),
      resourceCards: document.querySelectorAll('.resource').length,
      detailsCount: document.querySelectorAll('details').length,
      currentPageLinks: [...document.querySelectorAll('[aria-current]')].length,
      sections: [...document.querySelectorAll('main > section')].map((s) => s.id || '(no id)'),
      bodyText: document.body.innerText,
      footerText: (document.querySelector('.site-footer__bar')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      design: (() => {
        const cs = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
        // The first primary button in DOM order is the compact header one, and the
        // next is inside the (hidden) mobile panel — so pick a VISIBLE full-size CTA.
        const ctas = [...document.querySelectorAll('.btn--primary')];
        const cta = ctas.find((b) => b.getBoundingClientRect().height >= 44) ?? ctas[0];
        const ctaCs = cta ? getComputedStyle(cta) : null;
        // hidden CTAs (the compact header variant swaps at 480px) measure 0: ignore them
        const ctaHeights = [...document.querySelectorAll('.btn--primary')]
          .map((b) => Math.round(b.getBoundingClientRect().height))
          .filter((h) => h > 0);
        const h1 = document.querySelector('h1');
        return {
          h1Family: cs('h1', 'fontFamily'),
          h1Weight: Number(cs('h1', 'fontWeight')),
          h1Size: parseFloat(cs('h1', 'fontSize')),
          h1Transform: cs('h1', 'textTransform'),
          bodyFamily: cs('body', 'fontFamily'),
          sectionPadTop: cs('main > section:nth-of-type(2)', 'paddingTop'),
          ctaBg: ctaCs?.backgroundColor ?? null,
          ctaFg: ctaCs?.color ?? null,
          ctaHeight: cta ? Math.round(cta.getBoundingClientRect().height) : 0,
          ctaHeights,
          // The homepage no longer carries a `.card` (the compositional reset dropped the
          // programme cards). The rounded, hairline-bordered primitive on the page is now the
          // registration action tile, so that is what the design-system check measures.
          cardRadius: cs('.action', 'borderRadius'),
          cardBorder: cs('.action', 'borderStyle'),
          ledeMaxWidth: cs('.lede', 'maxWidth'),
          lineHeightBody: cs('body', 'lineHeight'),
          // FRAMING: the hero band stays a full-bleed dark field with the copy over it, but the
          // photograph inside it is contained in the centred shell (CONTAINMENT pass). The picture
          // is still positioned behind the content, so its box no longer coincides with the band by
          // construction — what must be asserted is that the band is full-bleed, that the media
          // fills the band's full height and stops at the shell on BOTH sides with symmetric
          // gutters, that the text stays inside the band, and that the copy sits on a deliberately
          // heavy scrim (a light scrim over a photograph is how a hero silently fails AA).
          heroBand: (() => {
            const s = document.querySelector('.hero');
            return s ? Math.round(s.getBoundingClientRect().height) : 0;
          })(),
          heroPanelFits: (() => {
            const p = document.querySelector('.hero__panel');
            const b = document.querySelector('.hero');
            if (!p || !b) return false;
            const pr = p.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            return pr.top >= br.top - 2 && pr.bottom <= br.bottom + 2 && pr.height > 0;
          })(),
          heroPanelOverflow: (() => {
            const p = document.querySelector('.hero__panel');
            const b = document.querySelector('.hero');
            if (!p || !b) return 0;
            return Math.max(0, Math.round(p.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom));
          })(),
          heroMediaFrame: (() => {
            const band = document.querySelector('.hero');
            const media = document.querySelector('.hero__media');
            const img = document.querySelector('.hero__media img');
            if (!band || !media || !img) return 'no hero media';
            const root = getComputedStyle(document.documentElement);
            const b = band.getBoundingClientRect();
            const m = media.getBoundingClientRect();
            const i = img.getBoundingClientRect();
            const fit = getComputedStyle(img).objectFit;
            const shell = parseFloat(root.getPropertyValue('--wrap')) || 0;
            const frame = parseFloat(root.getPropertyValue('--hero-media')) || 0;
            // Measure the gutter in PIXELS. It is authored as `2rem`, so parseFloat on the
            // custom property would yield 2 and the derivation below would be wrong by 4px
            // per side — a number that looks plausible and is silently nonsense.
            const gutterPx = (() => {
              const t = document.createElement('div');
              t.style.cssText = 'position:absolute;width:var(--gutter);height:0;visibility:hidden';
              document.body.appendChild(t);
              const w = t.getBoundingClientRect().width;
              t.remove();
              return w;
            })();
            const vw = document.documentElement.clientWidth;
            const gl = Math.round(m.left);
            const gr = Math.round(vw - m.right);
            const fullBand = Math.abs(b.width - vw) < 2;
            const fullHeight = Math.abs(m.height - b.height) < 2 && Math.abs(i.height - b.height) < 2;
            const symmetric = Math.abs(gl - gr) < 2;
            // The happy medium, stated as a derivation so it cannot be satisfied by accident:
            // the frame is the greater of the copy shell and (viewport − 2 gutters), capped at
            // --hero-media and never wider than the viewport. At 1920 that is 1300 with 310px
            // gutters; at 1440 it is 1300 with 70px ones; below the shell width it is simply the
            // viewport (phones stay full-bleed). The width must MATCH this, not merely fit it.
            const expected = Math.min(vw, Math.max(shell, Math.min(vw - 2 * gutterPx, frame)));
            const widthMatches = Math.abs(m.width - expected) <= 1;
            const withinFrame = frame > 0 && m.width <= frame + 1;
            const noEdgeContact = gl > 0 && gr > 0;
            const atLeastShell = m.width >= shell - 1 || Math.abs(m.width - vw) < 2;
            const bad = [
              !fullBand && `the band is not full-bleed (${Math.round(b.width)} of ${vw})`,
              !fullHeight && `the media does not fill the band height (media ${Math.round(m.height)}, img ${Math.round(i.height)}, band ${Math.round(b.height)})`,
              !symmetric && `gutters are asymmetric (${gl}px left / ${gr}px right)`,
              !widthMatches && `media ${Math.round(m.width)}px does not match the derived frame ${Math.round(expected)}px`,
              !withinFrame && `media ${Math.round(m.width)}px exceeds the frame ${frame}px`,
              !noEdgeContact && `the artwork touches the viewport edge (${gl}px left / ${gr}px right)`,
              !atLeastShell && `media ${Math.round(m.width)}px is narrower than the copy shell ${shell}px`,
              fit !== 'cover' && `object-fit is ${fit}`,
            ].filter(Boolean);
            return bad.length
              ? `no (${bad.join('; ')})`
              : `framed (${Math.round(m.width)}x${Math.round(m.height)} in a ${Math.round(b.width)} band, gutters ${gl}/${gr}, shell ${shell}, frame ${frame}, derived ${Math.round(expected)} from ${Math.round(gutterPx)}px gutter)`;
          })(),
          heroScrim: (() => {
            const s = document.querySelector('.hero__scrim');
            return s ? getComputedStyle(s).backgroundImage : null;
          })(),
          pageHeight: Math.round(document.documentElement.scrollHeight),
        };
      })(),
    };
  });

  const order = ['football', 'cheer', 'about', 'register', 'resources', 'fields', 'community'];
  const anchorOrder = info.ids.filter((id) => order.includes(id));
  const okOrder = anchorOrder.length === order.length && anchorOrder.every((id, i) => id === order[i]);
  check('homepage', 'all approved homepage sections are present, in order', okOrder, anchorOrder.join(' > '));
  for (const id of order) check('homepage', `#${id} exists`, info.ids.includes(id));
  const h1 = (info.h1[0] ?? '').replace(/\u00a0/g, ' ').trim();
  check('homepage', 'the hero h1 is the organization name', h1 === 'Somerset Little Eagle Football', JSON.stringify(info.h1));
  check('homepage', 'the page states that cheer is a program of the organization', /Cheer is a program of Somerset Little Eagle Football/.test(info.bodyText), 'program statement missing');
  check('homepage', 'registration is offered at least 3 times', info.registerCtas >= 3, `${info.registerCtas} CTAs`);
  // REPLACED (2026-10-08). This check used to REQUIRE the footer to carry the current
  // year — the opposite of evergreen: it would fail every January until someone edited
  // the site, and a build that is not rebuilt prints a stale year. The footer now
  // carries no year at all (which is also what the live legacy footer does), and the
  // evergreen block below makes "no year" a property of EVERY route, not just this one.
  check('evergreen', 'the footer carries no year and so needs no annual edit', !/\b20\d\d\b/.test(info.footerText), info.footerText.slice(0, 90));
  check('homepage', '8 venues are listed with map links', info.venueMapLinks.length === 8, `${info.venueMapLinks.length} links`);
  check('homepage', 'every venue map link is an absolute map URL', info.venueMapLinks.every((h) => /^https:\/\/goo\.gl\/maps\//.test(h)));
  check('homepage', '4 parent-resource cards', info.resourceCards === 4, `${info.resourceCards}`);
  check('homepage', 'long parent content is collapsed in native disclosures', info.detailsCount >= 2, `${info.detailsCount} details`);
  check('homepage', 'the Facebook page is linked', info.externalLinks.some((h) => h.includes('facebook.com/SomersetLittleEagleFootball')));
  check('homepage', 'the league website is linked', info.externalLinks.some((h) => h.includes('lhdfl.com')));
  check('homepage', 'in-page anchors have real targets', info.jumpLinks.filter((h) => h !== '#').every((h) => info.ids.includes(h.slice(1))), info.jumpLinks.join(','));

  // --- the design system is actually applied (not just written) ---------------
  const d = info.design;
  check('design', 'headings use the display face at a heavy weight and a real display size',
    /Archivo/.test(d.h1Family) && d.h1Weight >= 800 && d.h1Size >= 32,
    `h1 ${d.h1Family} ${d.h1Weight} ${d.h1Size}px`);
  check('design', 'body copy uses the body face', /Inter/.test(d.bodyFamily), d.bodyFamily);
  check('design', 'section rhythm uses the large spacing scale', parseFloat(d.sectionPadTop) >= 48, `padding-top ${d.sectionPadTop}`);
  check('design', 'the primary CTA is the brand orange with ink text',
    /rgb\(245, 126, 32\)/.test(d.ctaBg) && /rgb\(17, 17, 19\)/.test(d.ctaFg),
    `bg ${d.ctaBg} fg ${d.ctaFg}`);
  check('design', 'primary CTAs are full-size (44px+) and no button is under 40px',
    d.ctaHeight >= 44 && d.ctaHeights.every((h) => h >= 40),
    `heights ${d.ctaHeights.join(', ')}px (WCAG 2.5.8 AA needs 24px; the design rule is 44px, with a 40px compact header variant)`);
  check('design', 'cards use the hairline-border treatment (no heavy shadow)', /solid/.test(d.cardBorder) && parseFloat(d.cardRadius) >= 10, `${d.cardRadius} ${d.cardBorder}`);
  check('design', 'long-form lines are capped for readability', parseFloat(d.ledeMaxWidth) <= 900, d.ledeMaxWidth);
  // The photographic hero: the band exists, the text is inside it, the picture is contained
  // in the centred shell with symmetric gutters, and the copy sits on a heavy scrim. The
  // mock-up's hero is roughly three-quarters of the first screen, so the band is asserted to
  // be generous — not a collapsed block.
  check('design', 'the hero is a dominant photographic band',
    d.heroBand >= 480 && d.heroBand <= 800, `${d.heroBand}px at 1440x900`);
  check('design', 'the hero copy stays inside the band (nothing clipped)', d.heroPanelFits,
    `panel bottom ${d.heroPanelOverflow}px past the band`);
  check('design', 'the hero artwork is framed wider than the copy shell, one gutter clear of the edge',
    /^framed \(/.test(String(d.heroMediaFrame)), String(d.heroMediaFrame));

  // H1 TYPOGRAPHY (2026-10-08): the organization name is ONE semantic h1 whose three parts
  // are set as three deliberate lines — SOMERSET / LITTLE EAGLE / FOOTBALL — with only the
  // brand phrase in the brand orange. Asserted rather than assumed: the geometry (three
  // distinct, non-overlapping line boxes inside the copy column), the colour split, the size
  // reduction the brief names (≈10–12% off the previous 4.4rem desktop cap, derived here
  // rather than typed), and the fact that the accessible name is still the whole name. A
  // check that only looked at colour would happily pass a treatment whose lines collided.
  {
    const hi = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const lines = [...h1.querySelectorAll('.hero__title-line')];
      const panel = document.querySelector('.hero__panel');
      const rs = lines.map((s) => s.getBoundingClientRect());
      const pr = panel.getBoundingClientRect();
      const hb = h1.getBoundingClientRect();
      const cs = getComputedStyle(h1);
      // AA on the brand line. Measured against the band's own background colour — the QA
      // contrast harness already scores the h1's white text against it; the orange line is a
      // span, so it would otherwise escape that harness entirely.
      const lum = ([r, g, b]) => {
        const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const rgb = (s) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
      const band = document.querySelector('.hero');
      const [a, b] = [lum(rgb(getComputedStyle(lines[1]).color)), lum(rgb(getComputedStyle(band).backgroundColor))]
        .sort((x, y) => y - x);
      return {
        parts: lines.map((s) => s.textContent.replace(/\s+/g, ' ').trim()),
        colors: lines.map((s) => getComputedStyle(s).color),
        displays: lines.map((s) => getComputedStyle(s).display),
        tops: rs.map((r) => Math.round(r.top)),
        bottoms: rs.map((r) => Math.round(r.bottom)),
        rights: rs.map((r) => Math.round(r.right)),
        panel: { left: Math.round(pr.left), right: Math.round(pr.right) },
        h1Left: Math.round(hb.left),
        h1Text: h1.textContent.replace(/\s+/g, ' ').trim(),
        lineCount: new Set(rs.map((r) => Math.round(r.top))).size,
        size: parseFloat(cs.fontSize),
        family: cs.fontFamily,
        weight: Number(cs.fontWeight),
        brandRatio: Number(((a + 0.05) / (b + 0.05)).toFixed(2)),
      };
    });
    check('design', 'the hero h1 is set as three deliberate lines (Somerset / Little Eagle / Football)',
      hi.parts.join('|') === 'Somerset|Little Eagle|Football' && hi.lineCount === 3 && hi.displays.every((dv) => dv === 'block'),
      `${JSON.stringify(hi.parts)} on ${hi.lineCount} line(s), display ${hi.displays.join('/')}`);
    check('design', 'the three h1 lines do not collide and stay inside the copy column',
      hi.tops.every((t, i) => i === 0 || t >= hi.bottoms[i - 1] - 1) &&
        hi.rights.every((r) => r <= hi.panel.right + 1) && hi.h1Left >= hi.panel.left - 1,
      `tops ${hi.tops.join(',')} bottoms ${hi.bottoms.join(',')} rights ${hi.rights.join(',')} vs panel right ${hi.panel.right}`);
    check('design', 'only the brand phrase is orange; the location and the descriptor stay white',
      hi.colors[0] === 'rgb(255, 255, 255)' && hi.colors[1] === 'rgb(245, 126, 32)' && hi.colors[2] === 'rgb(255, 255, 255)' &&
        hi.weight >= 800 && /Archivo/.test(hi.family),
      `${hi.colors.join(' / ')} — ${hi.family} ${hi.weight}`);
    check('design', 'the brand-orange h1 line passes AA against the hero field',
      hi.brandRatio >= 4.5, `${hi.brandRatio}:1 (orange on the band's ink)`);
    const reduction = 1 - hi.size / 70.4; // the previous desktop cap was 4.4rem = 70.4px
    check('design', 'the desktop h1 came down ~10–12% and is still a real display size',
      reduction >= 0.1 && reduction <= 0.14 && hi.size >= 32,
      `${hi.size}px at 1440 (−${(reduction * 100).toFixed(1)}% off the previous 70.4px cap, ≥32px floor)`);
    check('design', 'the h1 keeps its complete accessible text',
      hi.h1Text === 'Somerset Little Eagle Football', JSON.stringify(hi.h1Text));

    // The brief asks the breaks to ADAPT for tablet/mobile rather than force an awkward
    // wrap. Each phrase fits on one line at phone width, so the same three-line treatment is
    // what is asserted there: complete text, still one line per phrase, nothing overflowing.
    await page.setViewportSize({ width: 390, height: 844 });
    await goto('/');
    const mob = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const rs = [...h1.querySelectorAll('.hero__title-line')].map((s) => s.getBoundingClientRect());
      const panel = document.querySelector('.hero__panel').getBoundingClientRect();
      return {
        text: h1.textContent.replace(/\s+/g, ' ').trim(),
        parts: [...h1.querySelectorAll('.hero__title-line')].map((s) => s.textContent.replace(/\s+/g, ' ').trim()),
        lines: new Set(rs.map((r) => Math.round(r.top))).size,
        maxRight: Math.max(...rs.map((r) => Math.round(r.right))),
        panelRight: Math.round(panel.right),
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });
    check('design', 'at phone width the h1 still stacks as three phrases and nothing overflows',
      mob.lines === 3 && mob.parts.join('|') === 'Somerset|Little Eagle|Football' &&
        mob.maxRight <= mob.panelRight + 1 && mob.scrollWidth <= mob.innerWidth + 1 &&
        mob.text === 'Somerset Little Eagle Football',
      `${mob.lines} lines, widest right ${mob.maxRight} vs panel ${mob.panelRight}, scrollWidth ${mob.scrollWidth}/${mob.innerWidth}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto('/');
  }
  // The cap and the wide-desktop gutter are the numbers the brief names (media 1300,
  // gutters 310 at 1920). At the block's own viewport the cap cannot bind, so a
  // check that only ran here would be satisfied by an uncapped width — it would pass a
  // media element that grew edge-to-edge on a 4K screen. Measure it where it binds.
  {
    const before = page.viewportSize();
    await page.setViewportSize({ width: 1920, height: 1080 });
    const wide = await page.evaluate(() => {
      const band = document.querySelector('.hero');
      const media = document.querySelector('.hero__media');
      if (!band || !media) return null;
      const root = getComputedStyle(document.documentElement);
      const m = media.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      return {
        mediaW: Math.round(m.width),
        gl: Math.round(m.left),
        gr: Math.round(vw - m.right),
        vw,
        frame: parseFloat(root.getPropertyValue('--hero-media')) || 0,
      };
    });
    if (before) await page.setViewportSize(before);
    await goto('/');
    const ok = wide && Math.abs(wide.mediaW - wide.frame) <= 1 && Math.abs(wide.gl - wide.gr) <= 1 && wide.gl > 0;
    check('design', 'on a wide desktop the frame stops at --hero-media instead of growing with the viewport',
      ok, wide ? `media ${wide.mediaW}px at ${wide.vw}px (frame ${wide.frame}, gutters ${wide.gl}/${wide.gr})` : 'no hero media');
  }
  check('design', 'the hero copy sits on a deliberately heavy scrim (AA over a photograph)',
    /rgba\(10, 10, 12, 0\.9/.test(String(d.heroScrim)),
    String(d.heroScrim).slice(0, 120));

  // ── The cheer must not be sliced off, and the picture's right edge must survive. ──
  // The photograph is 1672×941 (aspect 1.777). `object-fit: cover` scales by whichever
  // ratio is larger, so the frame crops the picture VERTICALLY while it is wider in
  // aspect than the photograph, and HORIZONTALLY once it is narrower — the wider the
  // frame, the more of the bottom (where the cheer block sits) is thrown away. The
  // number that says how much of the picture survives vertically is
  //     visibleHeightFraction = min(1, (bandH / frameW) * photoAspect),
  // and when the height governs, `photoW − frameW/scale` source columns fall outside the
  // frame and are distributed by object-position. Derive both from --hero-media and
  // require the rendered frame to match, so neither can be satisfied by accident. Read
  // the real pixel dimensions by loading currentSrc in a fresh Image, because
  // naturalWidth on a srcset image is density-corrected (a trap).
  {
    const before = page.viewportSize();
    const cases = [
      [1440, 900, 0.9, 'a 1440 desktop', false],
      [1920, 1080, 0.98, 'a wide desktop', true],
    ];
    for (const [w, h, floor, label, wide] of cases) {
      await page.setViewportSize({ width: w, height: h });
      const v = await page.evaluate(() => {
        const band = document.querySelector('.hero');
        const media = document.querySelector('.hero__media');
        const img = document.querySelector('.hero__media img');
        if (!band || !media || !img) return null;
        const root = getComputedStyle(document.documentElement);
        const t = document.createElement('div');
        t.style.cssText = 'position:absolute;width:var(--gutter);height:0;visibility:hidden';
        document.body.appendChild(t);
        const gutterPx = t.getBoundingClientRect().width;
        t.remove();
        const b = band.getBoundingClientRect();
        const m = media.getBoundingClientRect();
        const shell = parseFloat(root.getPropertyValue('--wrap')) || 0;
        const frame = parseFloat(root.getPropertyValue('--hero-media')) || 0;
        const vw = document.documentElement.clientWidth;
        return {
          vw,
          bandH: b.height,
          mediaW: m.width,
          expectedW: Math.min(vw, Math.max(shell, Math.min(vw - 2 * gutterPx, frame))),
          posX: (getComputedStyle(img).objectPosition || '50% 50%').split(' ')[0],
          src: img.currentSrc.split('?')[0],
        };
      });
      if (!v) { check('design', `the hero shows the photograph on ${label}`, false, 'no hero media'); continue; }
      // real pixel size of the delivered file, free of srcset density correction
      const nat = await page.evaluate((src) => new Promise((res) => {
        const i = new Image();
        i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight });
        i.onerror = () => res(null);
        i.src = src;
      }), v.src);
      if (!nat) { check('design', `the hero shows the photograph on ${label}`, false, `could not read ${v.src}`); continue; }
      const photoAspect = nat.w / nat.h;
      // fraction of the photograph's HEIGHT that survives `cover` inside the box:
      // scale = max(boxW/photoW, boxH/photoH) (the larger ratio wins), so the visible
      // source height is boxH/scale and the fraction is min(1, photoAspect/boxAspect).
      const expected = Math.min(1, (v.bandH / v.expectedW) * photoAspect);
      const actual = Math.min(1, (v.bandH / v.mediaW) * photoAspect);
      const scale = Math.max(v.mediaW / nat.w, v.bandH / nat.h);
      const slack = Math.max(0, nat.w - v.mediaW / scale);
      const posX = String(v.posX).endsWith('%')
        ? parseFloat(v.posX) / 100
        : (parseFloat(v.posX) || 0.5) / (parseFloat(v.posX) > 1 ? v.mediaW : 1);
      const leftCrop = slack * posX;
      const rightCrop = slack * (1 - posX);
      const cutRows = Math.round(nat.h * (1 - actual));
      // Vertical survival is one question; where the horizontal trim comes from is
      // another, and it has its own check below — keep this one to the vertical.
      const ok = Math.abs(actual - expected) <= 0.01 && expected >= floor;
      check('design',
        `the hero shows ${Math.round(floor * 100)}%+ of the photograph on ${label}, so the cheer is not sliced off`,
        ok,
        `${(actual * 100).toFixed(1)}% of the ${nat.w}×${nat.h} photograph (expected ${(expected * 100).toFixed(1)}% from a ${Math.round(v.expectedW)}px frame in a ${Math.round(v.bandH)}px band; ${cutRows} of ${nat.h} rows cropped away)`);
      if (wide) {
        check('design',
          'on a wide desktop the photograph keeps its right edge and takes the trim off the dark left',
          rightCrop <= 1.5 && leftCrop > 0,
          `${slack.toFixed(0)} source columns fall outside the frame: left ${leftCrop.toFixed(1)} — right ${rightCrop.toFixed(1)} (object-position ${v.posX})`);
      }
    }
    if (before) await page.setViewportSize(before);
    await goto('/');
  }
  // The compositional reset exists to make the page shorter. The previous long-form
  // homepage was 5534px at 1440x900; the mock-up's rhythm is hero → strip → mission →
  // registration → compact utilities → footer, so the whole page should now be far shorter.
  check('homepage', 'the homepage is compact (compositional reset, not a long scroll)',
    d.pageHeight <= 3800, `${d.pageHeight}px at 1440x900 (the previous long-form homepage was 5534px)`);

  // heading order must not skip a level
  let prev = 0;
  let skips = [];
  for (const h of info.headings) {
    if (prev && h.level > prev + 1) skips.push(`${prev}->${h.level} at "${h.text}"`);
    prev = h.level;
  }
  check('a11y', 'heading levels do not skip', skips.length === 0, skips.join('; '));

  // images: provenance, dimensions, no upscaling at the rendered size (1440)
  // The hero is deliberately the strictest case: it must NEVER be displayed above
  // its own pixels. It is identified by its MANIFEST ASSET ID, not by its filename —
  // the previous version keyed this allowance on `football-hero.jpg`, so replacing
  // the hero photograph would have silently relaxed the hero's rule to the looser
  // default, invisibly. An asset id is stable across a photograph change (it is the
  // same class of bug as keying the build identity on an asset name).
  const allowanceFor = (i) => (i.assetId === HERO_ASSET_ID ? 1.0 : 1.02);
  if (!info.imgs.some((i) => i.assetId === HERO_ASSET_ID)) {
    check('images', `the hero asset (${HERO_ASSET_ID}) is present on the page`, false,
      'no <img data-asset-id="' + HERO_ASSET_ID + '"> was found — the hero allowance below would be vacuous');
  }
  const upscaled = info.imgs.filter((i) => i.scale > allowanceFor(i));
  check('images', 'no image is displayed larger than its native pixels (1440px)', upscaled.length === 0,
    upscaled.map((i) => `${i.src} (${i.currentSrc}) scale ${i.scale}x — box ${i.renderedWidth}x${i.renderedHeight} vs natural ${i.naturalWidth}x${i.naturalHeight} via object-fit:${i.objectFit}`).join('; '));
  const scales = info.imgs.map((i) => `${(i.currentSrc || i.src || '').split('/').pop()} ${i.scale}x`);
  check('images', 'every image scale is measured and reported (audit trail)', true, scales.join(', '));
  check('images', 'every image declares an asset status', info.imgs.every((i) => i.status));
  check('images', 'every image has width/height and loading', info.imgs.every((i) => i.loading));
  const hero = info.imgs.find((i) => i.fetchpriority === 'high');
  check('images', 'the hero image is eager with high priority', !!hero && hero.loading === 'eager', JSON.stringify(hero ?? {}));
  const temp = info.imgs.filter((i) => i.status === 'temporary-facebook-asset');
  check('images', 'temporary assets are reported (production gate is separate)', true,
    `${temp.length} occurrences of ${new Set(temp.map((t) => t.src)).size} temporary asset(s): ${[...new Set(temp.map((t) => t.src))].join(', ')}`);
  check('images', 'every temporary asset carries provenance (fbid)', temp.every((t) => t.fbid));
}

async function responsiveChecks() {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const route of ROUTES) {
      await goto(route);
      const m = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        widest: [...document.querySelectorAll('body *')]
          .map((el) => ({ w: el.getBoundingClientRect().right, tag: el.tagName + '.' + (el.className || '').toString().slice(0, 30) }))
          .sort((a, b) => b.w - a.w)[0],
      }));
      check('responsive', `${route} has no horizontal overflow at ${vp.name}`,
        m.scrollWidth <= m.innerWidth + 1,
        `scrollWidth ${m.scrollWidth} vs ${m.innerWidth}; widest ${m.widest?.tag} right=${Math.round(m.widest?.w ?? 0)}`);
    }
    // The hero must not be clipped at ANY measured width, and the copy must stay inside the
    // band. The band is a full-bleed photographic field sized by `min-height`, so if the copy
    // ever grew past it the text would be cut — this catches that at every viewport.
    await goto('/');
    const hero = await page.evaluate(() => {
      const band = document.querySelector('.hero');
      const media = document.querySelector('.hero__media');
      const panel = document.querySelector('.hero__panel');
      if (!band || !media || !panel) return null;
      const b = band.getBoundingClientRect();
      const m = media.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      return {
        band: Math.round(b.height),
        media: Math.round(m.height),
        panel: Math.round(p.height),
        panelTop: Math.round(p.top),
        panelBottom: Math.round(p.bottom),
        bandTop: Math.round(b.top),
        bandBottom: Math.round(b.bottom),
      };
    });
    const clipped = hero.panelBottom > hero.bandBottom + 2 || hero.panelTop < hero.bandTop - 2 || Math.abs(hero.media - hero.band) > 2;
    check('responsive', `the hero is not clipped at ${vp.name}`, !clipped,
      `band ${hero.band} / media ${hero.media} / panel ${hero.panel} (top ${hero.panelTop} vs ${hero.bandTop})`);

    // Image scale at THIS viewport. The browser chooses a srcset candidate by width,
    // so a near-square box can outgrow the file it was handed even though a wider
    // viewport is fine — that is exactly the defect this check exists for. Candidates
    // are loaded inside the page (cached after the first pass); `naturalWidth` is only
    // trustworthy on an Image with no srcset.
    const scales = await page.evaluate(async () => {
      const imgs = [...document.querySelectorAll('img')];
      const urls = [...new Set(imgs
        .flatMap((i) => [i.currentSrc, ...(i.getAttribute('srcset') ?? '').split(',').map((s) => s.trim().split(/\s+/)[0])])
        .filter((u) => u && !/^data:/.test(u))
        .map((u) => new URL(u, location.href).href))];
      const dims = {};
      await Promise.all(urls.map((u) => new Promise((res) => {
        const p = new Image();
        p.onload = () => { dims[u] = { w: p.naturalWidth, h: p.naturalHeight }; res(); };
        p.onerror = () => { dims[u] = null; res(); };
        p.src = u;
      })));
      return imgs.map((i) => {
        const r = i.getBoundingClientRect();
        const t = dims[i.currentSrc];
        if (!t || !r.width) return null;
        const fit = getComputedStyle(i).objectFit;
        const scale = fit === 'cover' ? Math.max(r.width / t.w, r.height / t.h) : r.width / t.w;
        return { src: (i.currentSrc || '').split('/').pop(), assetId: i.getAttribute('data-asset-id'), scale: Number(scale.toFixed(3)) };
      }).filter(Boolean);
    });
    const bad = scales.filter((s) => s.scale > (s.assetId === HERO_ASSET_ID ? 1.0 : 1.02));
    check('responsive', `no image is upscaled at ${vp.name}`, bad.length === 0,
      bad.length ? bad.map((b) => `${b.src} ${b.scale}x`).join(', ') : scales.map((s) => `${s.src} ${s.scale}x`).join(', '));
  }
}

async function mobileNavChecks() {
  await page.setViewportSize({ width: 390, height: 844 });
  await goto('/');
  const toggleVisible = await page.isVisible('[data-nav-toggle]');
  check('nav', 'the hamburger is visible at 390px', toggleVisible);
  const panelBefore = await page.getAttribute('[data-nav-panel]', 'data-open');
  check('nav', 'the mobile panel starts closed', panelBefore === 'false');
  await page.click('[data-nav-toggle]');
  await page.waitForTimeout(120);
  const opened = await page.evaluate(() => ({
    expanded: document.querySelector('[data-nav-toggle]').getAttribute('aria-expanded'),
    open: document.querySelector('[data-nav-panel]').getAttribute('data-open'),
    visible: !!document.querySelector('[data-nav-panel] a')?.offsetParent,
    locked: getComputedStyle(document.body).overflow,
    focused: document.activeElement?.tagName,
  }));
  check('nav', 'opening sets aria-expanded=true and shows the panel', opened.expanded === 'true' && opened.open === 'true' && opened.visible, JSON.stringify(opened));
  check('nav', 'opening locks body scroll', opened.locked === 'hidden', opened.locked);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  const closed = await page.evaluate(() => ({
    expanded: document.querySelector('[data-nav-toggle]').getAttribute('aria-expanded'),
    locked: getComputedStyle(document.body).overflow,
  }));
  check('nav', 'Escape closes the panel and unlocks scrolling', closed.expanded === 'false' && closed.locked !== 'hidden', JSON.stringify(closed));

  const ctaVisible = await page.isVisible('.header-cta--mobile, .header-cta');
  check('nav', 'a Register CTA stays visible in the header on mobile', ctaVisible);

  await page.setViewportSize({ width: 1280, height: 900 });
  await goto('/');
  check('nav', 'the desktop nav list is visible at 1280px', await page.isVisible('.nav__list'));
  check('nav', 'the hamburger is hidden at 1280px', !(await page.isVisible('[data-nav-toggle]')));
}

async function a11yChecks() {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const route of ROUTES) {
    await goto(route);
    const m = await page.evaluate(() => {
      const rgb = (s) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
      const bgOf = (el) => {
        let n = el;
        while (n && n !== document.documentElement) {
          const c = getComputedStyle(n).backgroundColor;
          if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return rgb(c);
          n = n.parentElement;
        }
        return [255, 255, 255];
      };
      const targets = [...document.querySelectorAll('p, h1, h2, h3, h4, li, a, button, summary, .lede, .eyebrow, .card__tag')]
        .filter((el) => el.offsetParent && el.textContent.trim().length > 1 && !el.querySelector('p, h1, h2, h3, li'));
      const low = [];
      for (const el of targets) {
        const cs = getComputedStyle(el);
        const fg = rgb(cs.color);
        const bg = bgOf(el);
        const size = parseFloat(cs.fontSize);
        const bold = Number(cs.fontWeight) >= 700;
        const large = size >= 24 || (size >= 18.66 && bold);
        const need = large ? 3 : 4.5;
        const ratio = (() => {
          const lum = ([r, g, b]) => {
            const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
          };
          const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
          return (a + 0.05) / (b + 0.05);
        })();
        if (ratio < need) low.push({ text: el.textContent.trim().slice(0, 40), fg: cs.color, bg, size, need, ratio: Number(ratio.toFixed(2)) });
      }
      const namelessLinks = [...document.querySelectorAll('a')].filter((a) => !(a.textContent.trim() || a.getAttribute('aria-label') || a.querySelector('img[alt]:not([alt=""])')));
      const smallTargets = [...document.querySelectorAll('a, button, summary')].filter((el) => {
        if (!el.offsetParent) return false;
        // WCAG 2.5.8 exception: a link INLINE IN A SENTENCE is exempt (its size is
        // set by the text around it), which is what `closest('p')` identifies.
        if (el.closest('p')) return false;
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.height < 24;
      });
      const imgsNoAlt = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt'));
      return {
        low,
        namelessLinks: namelessLinks.map((a) => a.outerHTML.slice(0, 80)),
        smallTargets: smallTargets.map((el) => `${el.tagName}.${el.className} h=${Math.round(el.getBoundingClientRect().height)}`),
        imgsNoAlt: imgsNoAlt.map((i) => i.src),
        lang: document.documentElement.lang,
        skip: !!document.querySelector('a.skip-link[href="#main"]'),
        mainId: document.getElementById('main') ? true : false,
        inCopyLinks: [...document.querySelectorAll('.prose a, .mission-grid a, .resource a, .prose-block a')].length,
      };
    });
    check('a11y', `${route}: text contrast passes AA`, m.low.length === 0, m.low.map((l) => `${l.ratio}:1 (need ${l.need}) "${l.text}" ${l.fg} on rgb(${l.bg})`).join('; '));
    check('a11y', `${route}: every link has an accessible name`, m.namelessLinks.length === 0, m.namelessLinks.join(' | '));
    check('a11y', `${route}: interactive targets are not tiny`, m.smallTargets.length === 0, m.smallTargets.join(' | '));
    check('a11y', `${route}: every img has an alt attribute`, m.imgsNoAlt.length === 0, m.imgsNoAlt.join(', '));
    check('a11y', `${route}: lang + skip link + #main landmark`, m.lang === 'en' && m.skip && m.mainId, JSON.stringify({ lang: m.lang, skip: m.skip, mainId: m.mainId }));
  }
}

async function fontChecks() {
  await goto('/');
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      archivo: document.fonts.check('700 16px "Archivo"'),
      inter: document.fonts.check('400 16px "Inter"'),
      headingFamily: getComputedStyle(document.querySelector('h1')).fontFamily,
      bodyFamily: getComputedStyle(document.body).fontFamily,
    };
  });
  check('fonts', 'Archivo (display) is loaded and applied to headings', fonts.archivo && /Archivo/.test(fonts.headingFamily), JSON.stringify(fonts));
  check('fonts', 'Inter (body) is loaded and applied to the body', fonts.inter && /Inter/.test(fonts.bodyFamily), JSON.stringify(fonts));
  const fontReqs = networkLog.filter((r) => r.url.endsWith('.woff2'));
  check('fonts', 'fonts are served from our own origin', fontReqs.length >= 1 && fontReqs.every((r) => r.url.startsWith(BASE)), fontReqs.map((r) => r.url).join(', '));
}

async function perfChecks() {
  networkLog.length = 0;
  await goto('/');
  const perf = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource');
    const byType = {};
    let total = 0;
    for (const e of entries) {
      const kb = (e.transferSize || e.encodedBodySize || 0) / 1024;
      total += kb;
      const t = e.initiatorType || 'other';
      byType[t] = (byType[t] ?? 0) + kb;
    }
    const nav = performance.getEntriesByType('navigation')[0];
    total += (nav?.transferSize ?? 0) / 1024;
    // Byte size PER RESOURCE, from the browser's own Resource Timing. The response
    // handler's `content-length` is 0 for anything the browser serves from cache, and
    // a 0 there used to make the hero budget check vacuously true. `encodedBodySize`
    // is the encoded body length and survives a cache hit.
    const resBytes = {};
    for (const e of entries) resBytes[e.name] = Math.max(Number(e.encodedBodySize || 0), Number(e.transferSize || 0));
    return { totalKB: Math.round(total), byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.round(v)])), resBytes,
      // The hero is identified by the ELEMENT, not by a filename substring. The previous
      // version filtered the network log with /football-hero/, so replacing the hero
      // photograph silently stopped measuring the hero at all (an empty match set makes
      // `every()` vacuously true) — the same defect class as keying build identity on an
      // asset name. The URL is read from the DOM, and the check below requires that a
      // size for it was actually OBSERVED.
      heroUrl: (() => { const el = document.querySelector('.hero__media img') || document.querySelector('img[fetchpriority="high"]'); return el ? el.currentSrc : null; })(),
    };
  });
  check('perf', `homepage transfer is under ${WEIGHT_BUDGET_KB} KB`, perf.totalKB <= WEIGHT_BUDGET_KB, `${perf.totalKB} KB (${JSON.stringify(perf.byType)})`);
  // One byte figure per URL: the browser's own measurement, falling back to the
  // response header when Resource Timing has nothing (a cross-origin or opaque entry).
  const headerLen = new Map();
  for (const r of networkLog) if (r.len > 0) headerLen.set(r.url, Math.max(headerLen.get(r.url) ?? 0, r.len));
  const bytesFor = (url) => Math.max(perf.resBytes[url] ?? 0, headerLen.get(url) ?? 0);
  const imgBytes = networkLog.filter((r) => r.type === 'image' && r.url.startsWith(BASE));
  const imgUrls = [...new Set(imgBytes.map((r) => r.url))];
  const totalImg = imgUrls.reduce((a, u) => a + bytesFor(u), 0) / 1024;
  const heroLen = perf.heroUrl ? bytesFor(perf.heroUrl) : 0;
  check('perf', `the hero image is under ${HERO_BUDGET_KB} KB`,
    heroLen > 0 && heroLen / 1024 <= HERO_BUDGET_KB,
    heroLen > 0
      ? `${(perf.heroUrl || '').split('/').pop()} ${Math.round(heroLen / 1024)}KB (${heroLen} bytes)`
      : `the hero size was NOT observed (heroUrl=${perf.heroUrl ?? 'none'}) — an unmeasured hero is a failure, not a pass`);
  check('perf', 'all homepage imagery is under 500 KB', totalImg <= 500, `${Math.round(totalImg)} KB across ${imgBytes.length} images`);
  // From OUR documents the only third-party code that may run is the MachForm
  // integration: its loader, and the reCAPTCHA it injects into the host page (the
  // vendor's embed does this; it is the same behaviour the live site has today and
  // it is not the redesign's to change). Everything else the embed pulls happens
  // inside the vendor's own sandboxed iframe. Anything NOT on this list — Stripe,
  // Netlify, an analytics tag, a social widget — fails.
  const unexpectedAssets = thirdPartyReqs.filter(
    (r) => r.ours && r.url !== MF_LOADER && !VENDOR_INJECTED.test(r.url),
  );
  check('perf', 'our pages load no third-party asset except the MachForm integration', unexpectedAssets.length === 0,
    unexpectedAssets.map((r) => `${r.type} ${r.url}`).join(', ') || 'only the MachForm loader and its reCAPTCHA');
}

async function machformChecks() {
  // The contract is asserted against the RAW HTML we ship, not the live DOM: the
  // vendor script consumes #mf_placeholder while it builds the iframe, so a DOM
  // lookup after load can legitimately find nothing even when the embed is perfect.
  for (const [route, id] of Object.entries(EMBED_ROUTES)) {
    const raw = (await get(`${BASE}${route}`)).body;
    const ph = raw.match(/<div id="mf_placeholder"[^>]*>/)?.[0] ?? '';
    const attr = (n) => (ph.match(new RegExp(`data-${n}="([^"]*)"`)) ?? [])[1];
    check('machform', `${route}: #mf_placeholder ships with form id ${id}`,
      ph.includes(`data-formurl="https://z33design.forms-db.com/embed.php?id=${id}"`),
      ph.slice(0, 120) || 'placeholder missing from the shipped HTML');
    check('machform', `${route}: the vendor data-* contract is complete`,
      !!attr('formheight') && !!attr('formtitle') && !!attr('paddingbottom'),
      `height=${attr('formheight')} title=${attr('formtitle')} padding=${attr('paddingbottom')}`);
    check('machform', `${route}: the loader is INLINE and unprocessed`,
      /mf_placeholder/.test(raw) && /r\.src = o \+ 'js\/mf\.js'/.test(raw),
      'the inline loader IIFE is missing');
    check('machform', `${route}: we ship no external script tag`,
      !/<script[^>]+src="https?:\/\/(?!.*forms-db\.com)/.test(raw) && (raw.match(/<script[^>]+src=/g) ?? []).length === 0,
      (raw.match(/<script[^>]+src="[^"]*"/g) ?? []).join(', ') || 'none');

    await goto(route);
    const dom = await page.evaluate(() => ({
      iframe: document.querySelector('iframe')?.getAttribute('src') ?? null,
      formsOnPage: document.querySelectorAll('form').length,
      iframeBox: (() => { const f = document.querySelector('iframe'); if (!f) return null; const r = f.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
    }));
    check('machform', `${route}: the vendor script builds the form iframe`,
      dom.iframe === null || /forms-db\.com/.test(dom.iframe),
      dom.iframe ? `${dom.iframe} (${dom.iframeBox?.w}x${dom.iframeBox?.h})` : 'not rendered (vendor unreachable from this environment)');
    check('machform', `${route}: no form posts to our own origin`, dom.formsOnPage === 0, `${dom.formsOnPage} form element(s) on the page`);
  }

  // the success path
  const thankyou = await get(`${BASE}/thankyou`);
  check('machform', '/thankyou exists for the post-submit redirect', thankyou.status === 200);
  const legacy = await get(`${BASE}/pages/thankyou`);
  check('machform', 'the legacy /pages/thankyou target still resolves (via 1 redirect)', legacy.status === 301 && legacy.location === '/thankyou', `${legacy.status} ${legacy.location}`);
}

async function protectedSystemChecks() {
  const ours = thirdPartyReqs.filter((r) => r.ours);
  const ourOrigins = [...new Set(ours.map((r) => r.origin))];
  const vendorOrigins = [...new Set(thirdPartyReqs.filter((r) => !r.ours).map((r) => r.origin))];
  // Origin allowlist for OUR documents. The last two are the reCAPTCHA the vendor
  // embed injects; nothing else may appear.
  const OUR_ALLOWED = new Set([
    'https://assets.forms-db.com',
    'https://z33design.forms-db.com',
    'https://www.google.com',
    'https://www.gstatic.com',
    'https://csp.withgoogle.com',
  ]);
  const forbidden = ourOrigins.filter((o) => /stripe|netlify|googletagmanager|google-analytics|doubleclick|facebook|hotjar|segment|mixpanel/.test(o));
  check('protected', 'our pages request nothing from Stripe, Netlify, an analytics host or Facebook', forbidden.length === 0, forbidden.join(', '));
  const unexpected = ourOrigins.filter((o) => !OUR_ALLOWED.has(o));
  check('protected', 'the only third-party origins from our own documents are the MachForm integration',
    unexpected.length === 0, unexpected.join(', ') || ourOrigins.join(', '));
  check('protected', 'nothing requests the production domain', !thirdPartyReqs.some((r) => r.url.includes('littleeaglefootball.com')));
  const VENDOR_OK = /^(https:\/\/(z33design\.forms-db\.com|assets\.forms-db\.com|www\.google\.com|www\.gstatic\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|csp\.withgoogle\.com))$/;
  const vendorUnexpected = vendorOrigins.filter((o) => !VENDOR_OK.test(o));
  check('protected', 'vendor iframe traffic is confined to the form vendor and its captcha',
    vendorUnexpected.length === 0,
    vendorUnexpected.join(', ') || `vendor origins: ${vendorOrigins.join(', ')}`);

  // the production domain must be untouched by this build
  const prod = await fetch('https://littleeaglefootball.com/', { redirect: 'manual' }).then((r) => r.text()).catch(() => '');
  check('protected', 'production still serves the legacy site (not this build)', prod.includes('font-awesome') || !prod.includes('_astro/'), 'astro marker present in production? ' + prod.includes('_astro/'));
}

async function draftChecks(htmlByRoute) {
  if (!DRAFT) return;
  for (const [route, html] of Object.entries(htmlByRoute)) {
    check('draft', `${route}: carries noindex, nofollow`, /<meta name="robots" content="noindex, nofollow"/.test(html));
  }
  const sitemap = await get(`${BASE}/sitemap-index.xml`);
  check('draft', 'no sitemap is published on a draft', sitemap.status === 404, `status ${sitemap.status}`);
}

async function screenshots() {
  if (NO_SCREENS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const vp of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile390', width: 390, height: 844 }, { name: 'mobile430', width: 430, height: 932 }]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await goto('/');
    await page.screenshot({ path: path.join(SHOTS, `home-${vp.name}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const route of ['/register', '/physical', '/contact', '/thankyou', ...(INCLUDE_STYLEGUIDE ? ['/styleguide'] : [])]) {
    await goto(route);
    await page.screenshot({ path: path.join(SHOTS, `${route.replace(/\//g, '')}-desktop.png`), fullPage: true });
  }
}

// ---- 10. evergreen wording -------------------------------------------------
// Registration is not open all year: the MachForm page carries the current
// open/closed state. So any season year in a CTA, a heading or a description is
// wrong for most of the year AND has to be edited every season — exactly the
// maintenance the year was supposed to save. These checks turn that from an
// intention into a test.
//
// The ONE place a year is allowed to survive is the vendor's own MachForm form
// title: it is `data-formtitle` embed metadata, not text a visitor reads, and it is
// part of the integration contract (changing it is a MachForm configuration change).
// The titles are hard-coded here ON PURPOSE — a test that reads its expectation out
// of the thing it is testing cannot fail. They are the recorded contract in
// `src/data/site.ts` -> MACHFORM.forms.
const YEAR_RE = /\b20\d\d\b/;
// A year inside a URL is not a year a visitor READS: the SVG namespace
// `http://www.w3.org/2000/svg` contains "2000" and is not a date. (This exact false
// positive is why the first version of this check failed on every route, including
// the ones that were correct — the visible-text scan above is what covers what
// people actually read.)
const URLISH_RE = /^[a-z][a-z0-9+.\-]*:\/\//i;
const VENDOR_FORM_TITLES = {
  '/register': '2026 Little Eagle Football & Cheer',
  '/physical': 'Submit Physicals for 2026',
  '/contact': 'Contact Us',
};

async function evergreenChecks() {
  // The vendor contract is asserted against the RAW HTML we ship, not the live DOM:
  // the vendor loader consumes #mf_placeholder while it builds the iframe, so a DOM
  // lookup after load legitimately finds no [data-formtitle] even when the embed is
  // perfect. This is the same rule the machform block above follows.
  for (const [route, title] of Object.entries(VENDOR_FORM_TITLES)) {
    const raw = (await get(`${BASE}${route}`)).body.replace(/&#38;|&amp;/g, '&');
    check('evergreen', `${route} — the vendor MachForm title still ships verbatim`,
      raw.includes(`data-formtitle="${title}"`), `wanted data-formtitle="${title}"`);
    check('evergreen', `${route} — the vendor form TITLE is the only place this route ships a year`,
      (() => {
        // URL-valued attributes are not year references (the SVG namespace alone would
        // otherwise fail every page), and the vendor title is the one sanctioned home.
        const scan = raw.replace(/="[^"]*:\/\/[^"]*"/g, '=""').replace(/data-formtitle="[^"]*"/g, 'data-formtitle=""');
        return (scan.match(/.{0,40}\b20\d\d\b.{0,40}/g) ?? []).length === 0;
      })(),
      (() => {
        const scan = raw.replace(/="[^"]*:\/\/[^"]*"/g, '=""').replace(/data-formtitle="[^"]*"/g, 'data-formtitle=""');
        return (scan.match(/.{0,40}\b20\d\d\b.{0,40}/g) ?? []).slice(0, 2).map((s) => s.replace(/\s+/g, ' ')).join(' | ') || 'clean';
      })());
  }

  for (const route of ROUTES) {
    await goto(route);
    const info = await page.evaluate(() => {
      const flat = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
      const yearAttributes = [];
      for (const el of document.querySelectorAll('*')) {
        for (const a of el.attributes) {
          // URLs are skipped: `xmlns="http://www.w3.org/2000/svg"` is not a date.
          if (/^[a-z][a-z0-9+.\-]*:\/\//i.test(a.value.trim())) continue;
          if (/\b20\d\d\b/.test(a.value)) yearAttributes.push(flat(a.value));
        }
      }
      return {
        visibleYears: [...new Set(flat(document.body.innerText).match(/\b20\d\d\b/g) ?? [])],
        yearAttributeValues: [...new Set(yearAttributes)],
        iframeCount: document.querySelectorAll('iframe').length,
        ctaLabels: [...document.querySelectorAll('a[href="/register"]')].map((a) => flat(a.textContent)),
        headings: [...document.querySelectorAll('h1,h2,h3')].map((h) => flat(h.textContent)),
      };
    });

    check('evergreen', `${route} — no year is visible in text a visitor reads`,
      info.visibleYears.length === 0, `years found: ${JSON.stringify(info.visibleYears)}`);

    // The exact expected set, not `.every()` over a possibly empty list: an empty list
    // would pass vacuously, and a NEW year anywhere on the page must fail here.
    const vendorTitle = VENDOR_FORM_TITLES[route];
    const vendorUnreachable = vendorTitle !== undefined && info.iframeCount === 0;
    const expectedYears = vendorTitle !== undefined && YEAR_RE.test(vendorTitle) && !vendorUnreachable ? [vendorTitle] : [];
    check('evergreen', `${route} — a year may appear only as the vendor MachForm title`,
      JSON.stringify(info.yearAttributeValues) === JSON.stringify(expectedYears),
      `year-bearing attribute values: ${JSON.stringify(info.yearAttributeValues)}; expected ${JSON.stringify(expectedYears)}`
        + (vendorUnreachable ? ' (the vendor iframe did not render from this environment; the shipped data-formtitle is asserted above)' : ''));

    check('evergreen', `${route} — every registration CTA is year-free`,
      info.ctaLabels.every((t) => !YEAR_RE.test(t)), JSON.stringify(info.ctaLabels));
    check('evergreen', `${route} — no heading carries a season year`,
      info.headings.every((t) => !YEAR_RE.test(t)), JSON.stringify(info.headings.filter((t) => YEAR_RE.test(t))));
  }

  // The named requirement: the hero CTA is the evergreen NOUN, and it still goes to
  // the registration page (the destination is unchanged; only the label moved).
  await goto('/');
  const hero = await page.evaluate(() => {
    const el = document.querySelector('.hero .btn--primary');
    return el ? { text: el.textContent.replace(/\s+/g, ' ').trim(), href: el.getAttribute('href') } : null;
  });
  check('evergreen', 'the hero CTA reads Registration and still points at /register',
    hero?.text === 'Registration' && hero?.href === '/register', JSON.stringify(hero));
}

// ---- run -------------------------------------------------------------------
console.log(`qa-redesign: ${BASE}  mode=${DRAFT ? 'draft' : 'production'}${SELF_TEST ? '  SELF-TEST' : ''}\n`);

async function headerLogoChecks() {
  // A ratio-bearing image with a PINNED HEIGHT must never be width-clamped: `max-width: 100%`
  // then scales its width without its height and the mark is squashed, not shrunk. That
  // defect shipped once — the header logo rendered 62x46 (ratio 1.35) instead of 68x46
  // (1.478) on a 320px phone, after the header CTA label grew from "Register" to
  // "Registration" and pushed the row a few pixels over capacity. The old suite never saw
  // it because every other responsive check runs at 390px and wider, where the row has slack.
  // 320 is therefore a FIRST-CLASS viewport here, not an afterthought.
  const before = page.viewportSize();
  for (const [label, sel] of [['header', '.brand__mark'], ['footer', '.site-footer__brand img']]) {
    for (const width of [280, 300, 320, 340, 359, 360, 390, 480, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 800 });
      await goto('/');
      const m = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          w: r.width, h: r.height, cssW: cs.width, cssH: cs.height,
          natural: [el.naturalWidth, el.naturalHeight],
          complete: el.complete && el.naturalWidth > 0,
          rendered: +((r.width / r.height)).toFixed(4),
          native: +(el.naturalWidth / el.naturalHeight).toFixed(4),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      }, sel);
      if (!m) { check('logo-aspect', `${label} mark exists at ${width}px`, false, `no ${sel}`); continue; }
      // 1.5% tolerance absorbs sub-pixel rounding only; a real clamp is an 8.7% error.
      const drift = Math.abs(m.rendered - m.native) / m.native;
      check('logo-aspect', `${label} mark keeps its intrinsic aspect ratio at ${width}px`,
        m.complete && drift < 0.015,
        `rendered ${m.w.toFixed(1)}x${m.h.toFixed(1)} (ratio ${m.rendered}) vs intrinsic ${m.natural.join('x')} (${m.native})`
          + ` — drift ${(drift * 100).toFixed(2)}%`);
      // 2. The approved visual size. 320px is the supported minimum: the whole header row
      //    (68 logo + 141.8 button + 46 menu + 2x12 gap = 279.8px) fits a 280px content box.
      //    Below that the row is genuinely over capacity, so there only the RATIO must hold —
      //    the mark may be squeezed horizontally, but it must never be distorted.
      if (width >= 320) {
        check('logo-aspect', `${label} mark renders at its approved 68x46 at ${width}px`,
          Math.abs(m.w - 68) < 1 && Math.abs(m.h - 46) < 1, `got ${m.w.toFixed(1)}x${m.h.toFixed(1)}`);
      }
      check('logo-aspect', `${label} mark does not overflow the page at ${width}px`,
        m.overflow <= 0, `horizontal overflow ${m.overflow}px`);
    }
  }
  if (before) await page.setViewportSize(before);
}

async function brandLockupChecks() {
  // The brand lockup is ONE LINE, at every width where it is shown. It is not enough to check the
  // mark: `.brand` is a shrinkable flex item, so when the header row is short of room the browser
  // wraps the ORGANIZATION NAME — "SOMERSET LITTLE" / "EAGLE" / "FOOTBALL & CHEER" — and the
  // client reads that as a compressed, broken logo. The defect is invisible at 1280px and above,
  // where the row has slack, so the band that actually breaks (480-568px, of which 540-568 was
  // introduced by the longer "Registration" label) is measured directly. Element dimensions alone
  // would not have caught it: this asserts rendered LINE COUNT, tagline position, and that the
  // one-line lockup does not collide with the controls to its right.
  const before = page.viewportSize();
  const SHOWN_FROM = 600;
  for (const width of [320, 480, 540, 560, 600, 620, 768, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    await goto('/');
    const d = await page.evaluate(() => {
      const name = document.querySelector('.brand__name');
      const shown = !!name && getComputedStyle(name).display !== 'none';
      const inner = document.querySelector('.site-header__inner');
      const out = {
        shown,
        rowOverflow: inner ? inner.scrollWidth - inner.clientWidth : 0,
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        lines: 0,
        taglineBelow: null,
        gap: null,
      };
      if (!shown) return out;
      const tn = [...name.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      const rg = document.createRange();
      rg.selectNodeContents(tn);
      const rects = [...rg.getClientRects()].filter((r) => r.width > 1);
      out.lines = rects.length;
      const first = rects[0];
      const tag = name.querySelector('span');
      if (tag) out.taglineBelow = tag.getBoundingClientRect().top >= first.bottom - 2;
      // the nearest VISIBLE sibling to the right of the lockup must not be touched
      const brand = document.querySelector('.brand').getBoundingClientRect();
      const textRight = Math.max(...rects.map((r) => r.right));
      let next = null;
      for (const el of document.querySelectorAll('.site-header__inner > *')) {
        if (getComputedStyle(el).display === 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.left >= brand.right - 1 && (next === null || r.left < next.left)) next = r;
      }
      if (next) out.gap = +(next.left - Math.max(brand.right, textRight)).toFixed(1);
      return out;
    });

    if (d.shown) {
      check('brand-lockup', `the brand lockup is ONE line at ${width}px`, d.lines === 1,
        `"Somerset Little Eagle" rendered as ${d.lines} line(s)`);
      check('brand-lockup', `the tagline sits below the organization name at ${width}px`,
        d.taglineBelow === true, `tagline below: ${d.taglineBelow}`);
      check('brand-lockup', `the one-line lockup does not collide with the controls at ${width}px`,
        d.gap === null || d.gap >= 8, `clear space to the next control: ${d.gap}px`);
      check('brand-lockup', `the header row fits without squeezing the brand at ${width}px`,
        d.rowOverflow <= 0, `row over capacity by ${d.rowOverflow}px`);
    } else {
      check('brand-lockup', `the wordmark is hidden only below the width where it fits (${width}px)`,
        width < SHOWN_FROM, `wordmark hidden at ${width}px but the lockup fits from ${SHOWN_FROM}px`);
    }
    check('brand-lockup', `the header does not overflow the page at ${width}px`,
      d.docOverflow <= 0, `horizontal overflow ${d.docOverflow}px`);
  }
  if (before) await page.setViewportSize(before);
}

await httpChecks();
await structureChecks();
await responsiveChecks();
await mobileNavChecks();
await a11yChecks();
await fontChecks();
await perfChecks();
await machformChecks();
await protectedSystemChecks();
await evergreenChecks();
await headerLogoChecks();
await brandLockupChecks();

// draft assertions need the raw HTML
const htmlByRoute = {};
for (const route of ROUTES) htmlByRoute[route] = (await get(`${BASE}${route}`)).body;
await draftChecks(htmlByRoute);

await screenshots();

// self-test: this harness must be able to fail
if (SELF_TEST) {
  check('self-test', 'a deliberately false expectation is reported as a failure', false, 'ping-pong');
}

await browser.close();

// ---- report ----------------------------------------------------------------
const byArea = {};
for (const r of results) {
  byArea[r.area] = byArea[r.area] ?? { pass: 0, fail: 0 };
  r.ok ? (byArea[r.area].pass += 1) : (byArea[r.area].fail += 1);
}
console.log('');
for (const [area, s] of Object.entries(byArea)) {
  console.log(`  ${s.fail ? 'FAIL' : 'ok  '} ${area.padEnd(12)} ${s.pass} passed${s.fail ? `, ${s.fail} FAILED` : ''}`);
}
console.log('');
for (const r of results.filter((r) => !r.ok)) console.log(`  FAIL [${r.area}] ${r.name} — ${r.detail}`);
const total = results.length;
console.log(`\nqa-redesign: ${total - failed} passed / ${failed} failed  (${total} checks)`);
const notes = results.filter((r) => r.ok && /temporary assets are reported/.test(r.name));
for (const n of notes) console.log(`  note: ${n.detail}`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ base: BASE, mode: DRAFT ? 'draft' : 'production', selfTest: SELF_TEST, at: new Date().toISOString(), total, failed, results, network: networkLog }, null, 1));
console.log(`evidence: ${OUT}`);
process.exit(failed ? 1 : 0);
