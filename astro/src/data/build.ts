// Build identity for the Little Eagle redesign.
//
// WHY THIS EXISTS
// The redesign preview publisher used to prove "this deploy is our redesign" by
// grepping the deployed HTML for an ASSET ID (`data-asset-id="heroCover"`). An asset
// id is a property of one photograph, not of the build. When the compositional reset
// replaced that hero photograph, the marker went to zero — and the publisher declared
// a perfectly good deploy stale. Identity must be a property of the BUILD.
//
// TWO PARTS, deliberately different in kind:
//
//   BUILD_FAMILY  the STABLE identity of this site build. It never changes when copy,
//                 layout or imagery changes, so it is the right answer to "is this the
//                 redesign at all?".
//
//   BUILD_REV     the exact REVISION. Injected at build time by build-redesign.sh as
//                 Z33_BUILD_REV: a digest of everything that defines the artifact
//                 (source + assets). It answers "is this the revision I just built?".
//                 It falls back to 'dev' outside the sanctioned build script, and the
//                 publisher REFUSES 'dev': a bundle whose revision is unknown cannot
//                 be verified, so it fails closed rather than passing on a placeholder.
//
// Together they let the publisher compare the DEPLOYED artifact against the LOCAL
// artifact it just uploaded — which is a stronger check than the old one ever was: it
// now also catches a stale deploy of an OLDER redesign revision, not just a deploy of
// something that is not the redesign at all.
export const BUILD_FAMILY = 'little-eagle-redesign';
export const BUILD_REV = process.env.Z33_BUILD_REV ?? 'dev';
