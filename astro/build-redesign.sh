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
echo "production safety:"
printf '  noindex meta pages : %s (must be 0)\n' "$(grep -rl 'noindex, nofollow' build/dist-prod --include='*.html' | wc -l)"
printf '  sitemap files      : %s\n' "$(ls build/dist-prod | grep -c sitemap || true)"
