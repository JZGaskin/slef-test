#!/usr/bin/env node
/**
 * Local preview server that reproduces Netlify's URL semantics for this site,
 * so the build can be reviewed (and QA'd) exactly the way Netlify will serve it.
 *
 *   node scripts/preview.mjs [--dir dist] [--port 4321]
 *
 * It deliberately reads the deploy's own `_redirects` / `_headers` when they are
 * present in the served directory (that is how a no-build deploy is configured),
 * and falls back to `netlify.toml` + `public/_headers` for a built directory. So
 * the redirect map and the response headers under test are the ones that ship.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRedirectsFile, parseNetlifyToml } from './lib/redirects.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const DIR = path.resolve(ROOT, arg('dir', 'dist'));
const PORT = Number(arg('port', '4321'));

// --- redirects --------------------------------------------------------------
// Priority: the served directory's own _redirects (a no-build deploy), else the
// netlify.toml of the Astro project (a built deploy). Same rules either way.
//
// FORCE matters, and it is why this server models it: Netlify SHADOWS an unforced
// redirect rule when a real file exists at that exact path, and only a forced rule
// (`301!` in _redirects, `force = true` in netlify.toml) wins over the file. A
// preview that ignored shadowing would be MORE PERMISSIVE than production and would
// pass a build whose legacy .html URLs still answer 200 on the real deploy.
const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
let redirects = [];
const dirRedirects = path.join(DIR, '_redirects');
const netlifyToml = path.join(ROOT, 'netlify.toml');
if (fs.existsSync(dirRedirects)) {
  // A no-build deploy is configured by its own _redirects.
  redirects = parseRedirectsFile(readIf(dirRedirects));
} else {
  // A built deploy is configured by netlify.toml.
  redirects = parseNetlifyToml(readIf(netlifyToml));
}

// Netlify's shadowing test: is there a real file at the rule's exact path?
const fileAt = (p) => {
  const f = path.join(DIR, p.replace(/^\/+/, ''));
  return f.startsWith(DIR) && fs.existsSync(f) && fs.statSync(f).isFile();
};

// --- shadowing guard ---------------------------------------------------------
// The seven legacy .html URLs MUST redirect. They also exist as real files on a
// parity build, so on Netlify only a FORCED rule can win. If a build ships the file
// without the forced rule, the local preview must say so loudly instead of quietly
// agreeing with a deploy that behaves differently.
const LEGACY_HTML = [
  '/index.html', '/pages/about.html', '/pages/register.html', '/pages/fields.html',
  '/pages/contact.html', '/pages/physical.html', '/pages/thankyou.html',
];
const unforcedLegacy = LEGACY_HTML.filter((p) => {
  const r = redirects.find((x) => x.from === p);
  return fileAt(p) && !(r && r.force && [301, 302].includes(r.status));
});
if (unforcedLegacy.length) {
  console.error(`preview: REFUSING TO SERVE — ${unforcedLegacy.length} legacy .html path(s) exist as files`);
  for (const p of unforcedLegacy) console.error(`  ${p} — the file would be served (200); Netlify needs a FORCED rule (301!)`);
  console.error('  Fix: use `301!` in _redirects (or force = true in netlify.toml). Refusing to preview a build whose redirects cannot fire.');
  process.exit(3);
}
for (const r of redirects) {
  if (!r.force && fileAt(r.from)) {
    console.log(`preview: note — rule ${r.from} is shadowed by an existing file (Netlify behaviour), so it will not fire`);
  }
}

// --- headers ----------------------------------------------------------------
// Same priority: the deploy's own _headers, else the Astro project's public/_headers.
const headerRules = [];
const headerSource = fs.existsSync(path.join(DIR, '_headers'))
  ? path.join(DIR, '_headers')
  : path.join(ROOT, 'public', '_headers');
for (const block of readIf(headerSource).split(/\n(?=\S)/)) {
  const lines = block.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (!lines.length) continue;
  const [pattern, ...rules] = lines;
  const headers = {};
  for (const r of rules) {
    const i = r.indexOf(':');
    if (i > 0) headers[r.slice(0, i).trim()] = r.slice(i + 1).trim();
  }
  headerRules.push({ pattern: pattern.trim(), headers });
}
const headerFor = (urlPath) =>
  headerRules
    .filter((r) => (r.pattern.endsWith('*') ? urlPath.startsWith(r.pattern.slice(0, -1)) : r.pattern === urlPath))
    .reduce((acc, r) => ({ ...acc, ...r.headers }), {});

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp', '.woff2': 'font/woff2',
};

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
};

const server = http.createServer((req, res) => {
  const [rawPath] = req.url.split('?');
  const urlPath = decodeURIComponent(rawPath);

  // explicit redirect map — but an unforced rule is SHADOWED by a real file at the
  // same path (Netlify's documented behaviour), so fall through to file serving.
  for (const r of redirects) {
    if (r.from !== urlPath) continue;
    if (!r.force && fileAt(r.from)) continue;
    return send(res, r.status, '', { Location: r.to });
  }

  // candidate files, in the order Netlify's pretty-URL handling resolves them
  const candidates = [urlPath];
  if (urlPath.endsWith('/')) candidates.push(path.posix.join(urlPath, 'index.html'));
  else {
    candidates.push(`${urlPath}.html`);
    candidates.push(path.posix.join(urlPath, 'index.html'));
  }

  for (const c of candidates) {
    const file = path.join(DIR, c.replace(/^\/+/, ''));
    if (!file.startsWith(DIR)) continue;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      const headers = headerFor(c);
      if (headers['X-Content-Type-Options']) headers['Content-Type'] = MIME[path.extname(file)] || 'application/octet-stream';
      else headers['Content-Type'] = MIME[path.extname(file)] || 'application/octet-stream';
      return send(res, 200, fs.readFileSync(file), headers);
    }
  }

  const notFound = path.join(DIR, '404.html');
  const body = fs.existsSync(notFound) ? fs.readFileSync(notFound) : 'Not found';
  send(res, 404, body, { 'Content-Type': 'text/html; charset=utf-8' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`preview: http://127.0.0.1:${PORT}  (dir ${DIR})`);
  console.log(`redirects loaded: ${redirects.length}  (from ${fs.existsSync(dirRedirects) ? '_redirects' : 'netlify.toml'})`);
  console.log(`  forced (301!): ${redirects.filter((r) => r.force).length}  — unforced rules are shadowed by an existing file, as on Netlify`);
});
