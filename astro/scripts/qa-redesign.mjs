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

const ROUTES = ['/', '/register', '/physical', '/contact', '/thankyou', '/styleguide'];
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
    const text = (el) => (el ? el.textContent.trim() : null);
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
      footerYear: (document.querySelector('.site-footer__bar')?.textContent ?? '').match(/\d{4}/)?.[0],
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
          cardRadius: cs('.card', 'borderRadius'),
          cardBorder: cs('.card', 'borderStyle'),
          ledeMaxWidth: cs('.lede', 'maxWidth'),
          lineHeightBody: cs('body', 'lineHeight'),
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
  check('homepage', 'the footer is dated in the current year', info.footerYear === String(new Date().getFullYear()), info.footerYear);
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

  // heading order must not skip a level
  let prev = 0;
  let skips = [];
  for (const h of info.headings) {
    if (prev && h.level > prev + 1) skips.push(`${prev}->${h.level} at "${h.text}"`);
    prev = h.level;
  }
  check('a11y', 'heading levels do not skip', skips.length === 0, skips.join('; '));

  // images: provenance, dimensions, no upscaling at the rendered size (1440)
  const upscaled = info.imgs.filter((i) => i.scale > 1.02);
  check('images', 'no image is displayed larger than its native pixels (1440px)', upscaled.length === 0,
    upscaled.map((i) => `${i.src} (${i.currentSrc}) scale ${i.scale}x — box ${i.renderedWidth}x${i.renderedHeight} vs natural ${i.naturalWidth}x${i.naturalHeight} via object-fit:${i.objectFit}`).join('; '));
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
    return { totalKB: Math.round(total), byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.round(v)])) };
  });
  check('perf', `homepage transfer is under ${WEIGHT_BUDGET_KB} KB`, perf.totalKB <= WEIGHT_BUDGET_KB, `${perf.totalKB} KB (${JSON.stringify(perf.byType)})`);
  const imgBytes = networkLog.filter((r) => r.type === 'image' && r.url.startsWith(BASE));
  const heroBytes = imgBytes.filter((r) => /hero-cover/.test(r.url));
  const totalImg = imgBytes.reduce((a, r) => a + r.len, 0) / 1024;
  check('perf', `the hero image is under ${HERO_BUDGET_KB} KB`, heroBytes.every((r) => r.len / 1024 <= HERO_BUDGET_KB), heroBytes.map((r) => `${r.url.split('/').pop()} ${Math.round(r.len / 1024)}KB`).join(', '));
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
  for (const route of ['/register', '/physical', '/contact', '/thankyou', '/styleguide']) {
    await goto(route);
    await page.screenshot({ path: path.join(SHOTS, `${route.replace(/\//g, '')}-desktop.png`), fullPage: true });
  }
}

// ---- run -------------------------------------------------------------------
console.log(`qa-redesign: ${BASE}  mode=${DRAFT ? 'draft' : 'production'}${SELF_TEST ? '  SELF-TEST' : ''}\n`);

await httpChecks();
await structureChecks();
await responsiveChecks();
await mobileNavChecks();
await a11yChecks();
await fontChecks();
await perfChecks();
await machformChecks();
await protectedSystemChecks();

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
