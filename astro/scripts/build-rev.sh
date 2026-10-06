#!/usr/bin/env bash
# Print the revision digest of the Little Eagle redesign artifact.
#
# The digest is a property of the SOURCE + ASSET tree, so it changes exactly when the
# thing being built changes and NOT when a build happens twice from the same tree. The
# prod and draft bundles are built from the same revision and therefore share it: the
# noindex flag is a delivery difference, not an identity difference.
#
# stable-ordered: paths are sorted before hashing, so the digest does not depend on
# filesystem order.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

{
  find src public -type f ! -name '.DS_Store' -print0 | sort -z | xargs -0 -r sha256sum
  sha256sum astro.config.mjs package.json netlify.toml
} | sha256sum | cut -c1-12
