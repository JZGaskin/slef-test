// Image manifest — the single place a photograph is declared, described and
// attributed.
//
// WHY THIS EXISTS
// ---------------
// The redesign sources photography from the organization's own public Facebook
// page, because that page is the living source of up-to-date team photography and
// it avoids creating an ongoing "send us your photos" workflow for a volunteer
// organization. Those web copies are:
//
//   * lower resolution than the organization's originals, and
//   * NOT licensed for production use merely because they are public.
//
// So every asset is declared here with its provenance, marked
// `temporary-facebook-asset`, and rendered with `data-asset-status` on the
// element. The production-readiness gate (`scripts/check-assets.mjs`) fails while
// any temporary asset — or any declared placeholder — remains, which makes "we
// shipped unapproved imagery" a structural impossibility rather than a promise.
//
// REPLACING AN IMAGE (the whole point of the manifest)
// ---------------------------------------------------
//   1. drop the new file in `public/images/redesign/` with the same filename
//      (or add a new entry),
//   2. update `width`/`height` (+ the variant list) here,
//   3. set `status: 'approved'` and rewrite `alt` to describe what the
//      photograph actually shows,
//   4. delete the entry from `REJECTED_ASSETS` if it was listed there.
// No component changes. No copy changes. One data file.
//
// THE HERO: THE APPROVED MASTER vs THE FILE THE BROWSER GETS
// ----------------------------------------------------------------------------
// The hero is the one photograph the organization has approved as a master. That
// master is `public/images/football-hero.png` — 1774x887, 2.0 MB — and it is
// NOT a web asset: as a PNG it is 8.5x the hero transfer budget this site enforces
// (scripts/qa-redesign.mjs, HERO_BUDGET_KB). Photographic PNG is the wrong
// container, and re-compressing harder does not fix it (the best PNG rendition of
// this frame is ~3 MB; a 256-colour one is still 695 KB).
//
// So the hero is DELIVERED as a DECLARED re-encode of that master at its native
// resolution: same frame, same dimensions, no resample and no crop, JPEG at web
// quality. The derivation lives on the asset (`sourceMaster`) rather than in
// someone's memory, and the master itself stays in the tree byte-identical at the
// path the organization uploaded it to, so the delivery file can always be
// re-derived and re-checked.
//
// An earlier pass used `previewUpscale` here, because that hero was a 1.667x
// Lanczos resample of a 960x540 web copy. There is no resample now, so the field is
// absent; it stays in the type for any future asset that must be enlarged.
//
// SUBJECT VERIFICATION
// --------------------
// `subjectVerified` records that the CONTENT of the picture was actually
// inspected rather than assumed. Every candidate was described with a local
// vision-language model (`vision/descriptions.json`) before it was selected, so
// `alt` describes what the photograph really shows instead of a generic
// placeholder. Approval (licensing) is a separate question and stays
// `temporary-facebook-asset` until the organization approves in writing.

export interface ImageVariant {
  src: string;
  width: number;
}

export interface ImageAsset {
  id: string;
  /** Largest available file — the `src`. */
  src: string;
  width: number;
  height: number;
  /** Downscaled variants for `srcset` (never upscaled). */
  variants: ImageVariant[];
  alt: string;
  source: 'facebook-page' | 'client-supplied';
  /** Facebook media id as it appears in the photo URL — how to find it again.
   *  Absent for a client-supplied original, which has no Facebook identity. */
  fbid?: string;
  /** Where on the page it was captured from. */
  context: string;
  status: 'temporary-facebook-asset' | 'approved';
  /** Who cleared publication, and when. Recorded ONLY from a relayed approval —
   *  never inferred from public availability. */
  approvedBy?: string;
  approvedOn?: string;
  approvalScope?: string;
  /** How the approval reached Z33. Kept literal: no method is invented. */
  approvalEvidence?: string;
  subjectVerified: boolean;
  verifiedBy: string;
  credit: string;
  /**
   * Present ONLY on the hero: the declared, one-time resample factor of the web
   * copy this file was produced from. Absent means the file is as-captured.
   */
  previewUpscale?: number;
  /**
   * Present when the delivered file is a DERIVATIVE of an approved master that also
   * lives in the tree (never a resample: see the header comment). Records the
   * master's path, exact bytes and digest so the delivery file is reproducible.
   */
  sourceMaster?: { path: string; sha256: string; bytes: number; note: string };
}

const FB_CREDIT = 'Somerset Little Eagle Football official Facebook page';
const VISION = 'local vision-language model (gemma4:12b); description recorded in vision/descriptions.json';

export const IMAGES: Record<string, ImageAsset> = {
  // HERO — the organization's approved master: a Little Eagle football player
  // carrying the ball, with cheerleaders holding orange and black pom-poms to his
  // right, under a warm evening sky. This is the SECOND approved hero: the first
  // (a white-helmeted player above cheerleaders under a golden sky) was replaced on
  // 2026-10-08 when the organization uploaded `football-hero.png`; its files stay in
  // the tree byte-identical as the record of that frame. The subject was verified
  // from the picture itself (crops through the local vision-language model), not from
  // a filename — which is why the alt text names no uniform colour: the model
  // reported "white" from one crop and "orange" from another, so only what every
  // crop agreed on is asserted. The delivered file is a declared re-encode of the
  // master at native size — see the header comment above.
  footballHero: {
    id: 'footballHero',
    src: '/images/football-hero-1774.jpg',
    width: 1774,
    height: 887,
    // NO downscaled variant, deliberately. srcset selects by WIDTH, so on a phone the
    // browser would take a smaller file for a tall band and then cover-scale it up —
    // a real upscale, in the exact place the design is most photographic. The hero
    // therefore declares one candidate only: the 1774x887 file, which covers a
    // full-bleed band up to 1774px wide at 1:1 and crops rather than enlarging on
    // phones. The cost is that a phone downloads the hero in full; the benefit is that
    // "the hero is never displayed above its own pixels" is true at EVERY viewport,
    // not just the ones the QA happens to measure.
    variants: [],
    alt: 'A Little Eagle football player in uniform carrying the ball, with cheerleaders holding orange and black pom-poms to his right under a warm evening sky.',
    source: 'client-supplied',
    context: 'uploaded by the organization to the astro-redesign branch at images/football-hero.png (commit 4e81a9cf)',
    status: 'approved',
    subjectVerified: true,
    verifiedBy: VISION,
    credit: 'Somerset Little Eagle Football',
    sourceMaster: {
      path: '/images/football-hero.png',
      sha256: '28096ee83251cbf86ca74d8d426d834c7a3efe2d1582f950cf8356ce96ed4407',
      bytes: 2113678,
      note: '1774x887 PNG exactly as uploaded. The delivered file is the same frame at the same size, re-encoded as JPEG; no resample, no crop, no pixels invented.',
    },
  },
  // MISSION — a night game on the home field, "EAGLES" in the end zones, players on
  // the turf and spectators behind the fence. Used small and beside copy, where the
  // distance of the frame reads as "this is where we play" rather than as the
  // emotional lead image.
  fieldNight: {
    id: 'fieldNight',
    src: '/images/redesign/hero-cover.jpg',
    width: 960,
    height: 572,
    variants: [{ src: '/images/redesign/hero-cover-640.jpg', width: 640 }],
    alt: 'A night football game on the Little Eagles field, with "EAGLES" painted in the end zones, players on the turf and spectators behind the sideline.',
    source: 'facebook-page',
    fbid: '1457013789796532',
    context: 'the organization’s page cover photo (set a.553052540192666)',
    status: 'approved',
    approvedBy: 'Jeremy Wilsen, on behalf of the organization',
    approvedOn: '2026-10-19',
    approvalScope: 'use on the Little Eagle website, including the social-preview image',
    approvalEvidence:
      'relayed by Zach in the production-authorization message; the wording of Jeremy’s own message was not supplied to the agent',
    subjectVerified: true,
    verifiedBy: VISION,
    credit: FB_CREDIT,
  },

  // COMMUNITY — players and families on the field at night near the 50-yard line.
  // Replaces a social-post image with large baked-in text, which read as a reposted
  // screenshot rather than photography.
  communityField: {
    id: 'communityField',
    src: '/images/redesign/community-field.jpg',
    width: 540,
    height: 960,
    variants: [{ src: '/images/redesign/community-field-360.jpg', width: 360 }],
    alt: 'Little Eagle players and families on the field at night near the 50-yard line.',
    source: 'facebook-page',
    fbid: '1292764688304379',
    context: 'the organization’s Facebook photo (page photos / About, vertical), captured 2026-10-05',
    status: 'approved',
    approvedBy: 'Jeremy Wilsen, on behalf of the organization',
    approvedOn: '2026-10-19',
    approvalScope: 'use on the Little Eagle website, including the social-preview image',
    approvalEvidence:
      'relayed by Zach in the production-authorization message; the wording of Jeremy’s own message was not supplied to the agent',
    subjectVerified: true,
    verifiedBy: VISION,
    credit: FB_CREDIT,
  },
};

/**
 * Imagery the page deliberately does NOT have, declared so the gap is honest and
 * the promotion gate can refuse a build that still contains it.
 *
 * A PLACEHOLDER is not a photograph: it renders as a designed panel with
 * `data-asset-status="temporary-placeholder"`, and `scripts/check-assets.mjs`
 * treats it exactly like an unapproved photograph — the build cannot be promoted
 * while one exists. That is deliberate: the honest alternatives were to publish a
 * photograph of something else under a "Cheer" heading, or to publish nothing and
 * let the cheer item look broken. Neither is acceptable.
 */
export interface Placeholder {
  id: string;
  label: string;
  reason: string;
  needs: string;
}

export const PLACEHOLDERS: Placeholder[] = [
  {
    id: 'cheerMedia',
    label: 'Cheer',
    reason:
      'No cheer photograph exists in the captured source. Every full-resolution image on the organization’s public Facebook page that could be retrieved is American football; the only recent daylight action photographs are 160x160 thumbnails, which are unusable at card size. Assigning a football or street image to the Cheer item would have been a false description of the programme.',
    needs:
      'One or two cheer photographs (sideline or competition) from the organization, at 1200px or larger, with permission to publish.',
  },
];

/** Assets deliberately NOT used, recorded so the decision is not repeated. */
export const REJECTED_ASSETS = [
  {
    fbid: '1794831097925531',
    reason:
      'A night street scene — buildings, cars, dark storefronts, zero people — that had been assigned to the Football program card on the strength of its filename alone. A vision-language description showed no sport and no people in frame. Removed from the page and from the bundle.',
  },
  {
    fbid: '26508028338804198',
    reason:
      'Team photograph with large baked-in text ("Great season Little Eagles!"). It reads as a reposted social graphic rather than photography, and the text duplicates the heading beside it. Removed from the page and from the bundle.',
  },
  {
    fbid: '1536589455172298',
    reason:
      'Raffle thank-you post (843x536) — a fundraising graphic of a ticket stub, not photography. The brief excludes flyers and raffle graphics.',
  },
  {
    fbid: '8 daylight action frames (1536366505194593 … 1536366531861257)',
    reason:
      'Genuine youth football action frames, but the only copies retrievable without a logged-in session are 160x160 thumbnails. Far too small for the hero or a card. Recorded here so a future pass WITH the originals knows they exist — one of these is the single best candidate to replace the declared hero upscale.',
  },
  {
    fbid: 'SLEFLogo5.png',
    reason:
      'The organization logo is only 170x115 px. It is used at 46px CSS height (where it is still crisp); it is not usable as a larger mark and a vector original has been requested.',
  },
  {
    fbid: 'img-1/2/3.jpg, Turf.jpg, mightymite.jpg, muddybuddy.jpg',
    reason:
      'The legacy site photographs: roughly five seasons old, and measurably soft (edge-energy 18–23 vs 36–61 for the current captures). Superseded by the Facebook-sourced imagery above.',
  },
];

export const TEMPORARY_COUNT = Object.values(IMAGES).filter(
  (i) => i.status === 'temporary-facebook-asset',
).length;

/** Declared preview upscales, reported by the review build so the number is never hidden. */
export const PREVIEW_UPSCALES = Object.values(IMAGES).filter((i) => i.previewUpscale);

export const PLACEHOLDER_COUNT = PLACEHOLDERS.length;
