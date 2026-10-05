# QA evidence

Full results live in the client record, not in this repository:
`z33-ops/clients/little-eagle-football/audit/astro-qa/`.

Recorded on 2026-10-05 (Astro 5.18.2 / Tailwind 4.3.3, headless Chromium,
1280 + 390 + 430):

| Target | Mode | Result |
|---|---|---|
| Production bundle (local preview, exact Netlify semantics) | production | **496 passed / 0 failed** |
| This branch root, served as a no-build deploy (its own `_redirects`/`_headers`) | production | **496 passed / 0 failed** |
| Draft bundle (`PUBLIC_NOINDEX=true`) | draft | **499 passed / 0 failed** |

Reproduce:

```bash
npm ci
npm run build
node scripts/preview.mjs --dir dist --port 4321 &
node scripts/qa.mjs --port 4321                 # 496/0, compares to the live site
PUBLIC_NOINDEX=true npm run build
node scripts/qa.mjs --port 4321 --draft         # 499/0, adds the noindex assertions
```

The harness has `--self-test`, which deliberately asserts something false, so a
green run is evidence rather than a hope.

## Redirects (why the `.html` rules are forced)

Netlify **shadows** an unforced redirect rule when a real file exists at that exact
path, and only a forced rule wins (`301!` in `_redirects`, `force = true` in
`netlify.toml`). The seven legacy `.html` URLs exist as files for parity, so their
rules are forced; without the `!` the file answers 200 and the clean canonical URL
stops being authoritative. `scripts/preview.mjs` reproduces the shadowing rule and
**refuses to serve** a build whose legacy `.html` rules cannot fire, so the local
rehearsal cannot be more permissive than the real deploy.
