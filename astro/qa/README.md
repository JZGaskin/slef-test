# QA evidence

Full results live in the client record, not in this repository:
`z33-ops/clients/little-eagle-football/audit/astro-qa/`.

Launch build (2026-10-19), headless Chromium:

| Target | Mode | Result |
|---|---|---|
| Production bundle (`build/dist-prod`, local preview) | production, `--no-styleguide` | **365 / 0** |
| Draft bundle (`PUBLIC_NOINDEX=true`) | draft | **389 / 0** |
| Browser launch-readiness suite (production bundle) | production | **59 / 0** |
| `check-assets.mjs build/dist-prod` | — | **PRODUCTION READY** |
| `launch-gate.mjs --dir build/dist-prod` | — | **46 / 0** |

Reproduce:

```bash
npm ci
./build-redesign.sh
node scripts/preview.mjs --dir build/dist-prod --port 4341 &
node scripts/qa-redesign.mjs --port 4341 --no-styleguide
node scripts/check-assets.mjs build/dist-prod
node scripts/launch-gate.mjs --dir build/dist-prod
```
