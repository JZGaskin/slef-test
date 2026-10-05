# Little Eagle Football & Cheer — Astro source

This is the source of the rebuilt site. The build output is committed at the
**repository root** (this branch) because the live Netlify site is a no-build
static deploy of the repo root — that way a branch deploy renders the new site
without changing any Netlify setting.

## Rebuild

```bash
npm ci
npm run build          # -> dist/  (production: indexable, sitemap, robots allow)
PUBLIC_NOINDEX=true npm run build   # -> dist/  (draft: noindex meta, robots disallow, no sitemap)
```

## Review locally

```bash
node scripts/preview.mjs --dir dist --port 4321     # Netlify URL + header semantics
node scripts/qa.mjs --port 4321             # production expectations
node scripts/qa.mjs --port 4321 --draft     # draft expectations (noindex)
```

`scripts/qa.mjs` drives a real browser against the preview **and** the live site:
route/redirect assertions, element-by-element layout parity, full-page pixel
diff, the MachForm embed contract, and accessibility checks. It exits non-zero on
any failure and has a `--self-test` mode that deliberately fails, so a green run
means something.

## MachForm

`src/components/MachFormEmbed.astro` reproduces the vendor contract exactly: the
`#mf_placeholder` element with its `data-*` attributes, and the loader IIFE kept
`is:inline` (bundling or deferring it breaks the embed). Forms are referenced by
id: register `41557`, contact `24057`, physical `42461`. Nothing about the
MachForm account, payment configuration or post-submit redirect changes here.

## Draft vs production

Draft/branch builds (`PUBLIC_NOINDEX=true`, or the Netlify `deploy-preview` /
`branch-deploy` contexts in `netlify.toml`) carry
`<meta name="robots" content="noindex, nofollow">`, a disallow-all `robots.txt`
and no sitemap. The production build does none of that and is unchanged from the
approved rebuild.
