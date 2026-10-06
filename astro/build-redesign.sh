#!/usr/bin/env bash
# Build both redesign bundles.
#
#   ./build-redesign.sh
#
#   build/dist-prod    production build  -> goes into the branch root
#   build/dist-draft   noindex build     -> the private PREVIEW deploy artifact
#
# The draft bundle is never committed: it is a deploy artifact (see
# publish-redesign.sh). It differs only in that it carries a noindex meta tag, a
# disallow-all robots.txt and no sitemap.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

echo "== redirect map gate (Netlify's own parser) =="
# A `_redirects` line Netlify cannot parse is DROPPED, and a dropped rule is a 404.
# Fail the build here rather than discover it on the deployed preview. The same gate
# (with Netlify's parser and matching engine) is run by the publisher on the bundle.
node scripts/check-redirects.mjs public/_redirects --require-vendor

# The site build IDENTITY, baked into every page as
# <html data-z33-build="…" data-z33-build-rev="…"> and read back by
# publish-redesign.sh, which compares the DEPLOYED artifact against this one.
# It is derived from the artifact's inputs and must NOT name an asset: the previous
# marker was `data-asset-id="heroCover"`, so when the compositional reset changed the
# hero photograph the marker vanished from a correct deploy and the publisher called a
# good deploy stale.
Z33_BUILD_REV="$(bash scripts/build-rev.sh)"
export Z33_BUILD_REV
if ! printf '%s' "$Z33_BUILD_REV" | grep -Eq '^[0-9a-f]{12}$'; then
  echo "FAIL could not compute a build revision digest (got '$Z33_BUILD_REV')" >&2
  exit 1
fi
echo "== build identity: family $(sed -nE "s/^export const BUILD_FAMILY = '([^']*)'.*/\1/p" src/data/build.ts) rev $Z33_BUILD_REV =="

echo "== production build =="
rm -rf dist
npm run build
rm -rf build/dist-prod
mkdir -p build
cp -a dist build/dist-prod
echo "   -> build/dist-prod ($(find build/dist-prod -type f | wc -l) files, $(du -sh build/dist-prod | cut -f1))"

echo "== draft (noindex) build =="
rm -rf dist
PUBLIC_NOINDEX=true npm run build
rm -rf build/dist-draft
cp -a dist build/dist-draft
echo "   -> build/dist-draft ($(find build/dist-draft -type f | wc -l) files, $(du -sh build/dist-draft | cut -f1))"

echo
echo "draft safety:"
printf '  noindex meta pages : %s\n' "$(grep -rl 'noindex, nofollow' build/dist-draft --include='*.html' | wc -l)"
printf '  robots.txt         : %s\n' "$(head -3 build/dist-draft/robots.txt | tr '\n' ' ')"
printf '  sitemap files      : %s (must be 0)\n' "$(ls build/dist-draft | grep -c sitemap || true)"

echo
for bundle in build/dist-prod build/dist-draft; do
  echo "bundle redirect gate: $bundle"
  node scripts/check-redirects.mjs "$bundle/_redirects" --require-vendor --quiet
  if cmp -s public/_redirects "$bundle/_redirects"; then
    echo "   _redirects is byte-identical to public/_redirects"
  else
    echo "   FAIL $bundle/_redirects differs from public/_redirects" >&2
    exit 1
  fi
done

echo
echo "build identity in both bundles (must be present and identical):"
for bundle in build/dist-prod build/dist-draft; do
  fam=$(grep -o 'data-z33-build="[^"]*"' "$bundle/index.html" | head -1 | sed -E 's/.*"([^"]*)"/\1/')
  rev=$(grep -o 'data-z33-build-rev="[^"]*"' "$bundle/index.html" | head -1 | sed -E 's/.*"([^"]*)"/\1/')
  present=$(grep -rl 'data-z33-build=' "$bundle" --include='*.html' | wc -l)
  total=$(find "$bundle" -name '*.html' | wc -l)
  printf '  %-18s family=%s rev=%s (%s/%s pages carry it)\n' "$(basename "$bundle")" "$fam" "$rev" "$present" "$total"
  if [ "$fam" != "little-eagle-redesign" ] || [ "$rev" != "$Z33_BUILD_REV" ] || [ "$present" -ne "$total" ]; then
    echo "   FAIL $bundle does not carry the expected build identity" >&2
    exit 1
  fi
done

echo
echo "production safety:"
printf '  noindex meta pages : %s (must be 0)\n' "$(grep -rl 'noindex, nofollow' build/dist-prod --include='*.html' | wc -l)"
printf '  sitemap files      : %s\n' "$(ls build/dist-prod | grep -c sitemap || true)"
