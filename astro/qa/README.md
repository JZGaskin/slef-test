# QA evidence

Full results live in the client record, not in this repository:
`z33-ops/clients/little-eagle-football/audit/astro-qa/`.

Stage 1 (redesign: design system + homepage), recorded 2026-10-06, headless
Chromium at 390 / 430 / 768 / 1280 / 1440:

| Target | Mode | Result |
|---|---|---|
| Production bundle (local preview, Netlify URL + redirect semantics) | production | **194 passed / 0 failed** |
| Draft bundle (`PUBLIC_NOINDEX=true`), noindex/no-sitemap assertions | draft | **200 passed / 0 failed** |
| The same harness, `--self-test` | — | **fails as expected** (a check that cannot fail is not a check) |

Also: `tests/redirect-map-test.mjs` (24 passed / 0 failed) proves the `_redirects`
and `netlify.toml` copies are identical and that every pre-redesign URL is covered;
`scripts/check-assets.mjs` is the production gate and **exits 1 on purpose** while
unapproved Facebook-sourced photographs are in use.

Reproduce:

```bash
npm ci
./build-redesign.sh                     # build/dist-prod + build/dist-draft
node scripts/preview.mjs --dir build/dist-prod --port 4341 &
node scripts/qa-redesign.mjs --port 4341                    # 194/0
node scripts/preview.mjs --dir build/dist-draft --port 4342 &
node scripts/qa-redesign.mjs --port 4342 --draft            # 200/0
node scripts/qa-redesign.mjs --port 4341 --self-test        # must FAIL
node tests/redirect-map-test.mjs                            # 24/0
node scripts/check-assets.mjs build/dist-draft              # exit 1 (preview only)
```

## Why the redirect destinations are QUOTED

In `_redirects` a `#` starts a comment, so a fragment destination
(`"/#about"`) must be quoted or Netlify silently redirects to `/` instead.
`scripts/lib/redirects.mjs` reproduces Netlify's parsing (an unquoted `#` is a
comment) so this cannot regress silently.
