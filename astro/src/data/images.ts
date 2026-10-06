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
// SUBJECT VERIFICATION
// --------------------
// `subjectVerified` records that the CONTENT of the picture was actually
// inspected rather than assumed. From the visual-refinement pass onward this is
// done by describing every candidate with a local vision-language model
// (`vision/descriptions.json`) before it is selected, so `alt` describes what the
// photograph really shows instead of a generic placeholder. `verifiedBy` names
// the method. Approval (licensing) is a separate question and stays
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
  source: 'facebook-page';
  /** Facebook media id as it appears in the photo URL — how to find it again. */
  fbid: string;
  /** Where on the page it was captured from. */
  context: string;
  status: 'temporary-facebook-asset' | 'approved';
  subjectVerified: boolean;
  verifiedBy: string;
  credit: string;
}

const FB_CREDIT = 'Somerset Little Eagle Football official Facebook page';
const VISION = 'local vision-language model (gemma4:12b); description recorded in vision/descriptions.json';

export const IMAGES: Record<string, ImageAsset> = {
  // HERO — the widest usable frame (960x572; the source offers no larger copy),
  // a night game with "EAGLES" in the end zones, players on the turf and
  // spectators behind the fence. Chosen for a hero because it has real negative
  // space (turf left and right, sky and lights above) and reads as game day.
  heroCover: {
    id: 'heroCover',
    src: '/images/redesign/hero-cover.jpg',
    width: 960,
    height: 572,
    variants: [{ src: '/images/redesign/hero-cover-640.jpg', width: 640 }],
    alt: 'A night football game on the Little Eagles field, with "EAGLES" painted in the end zones, players on the turf and spectators behind the sideline.',
    source: 'facebook-page',
    fbid: '1457013789796532',
    context: 'the organization’s page cover photo (set a.553052540192666)',
    status: 'temporary-facebook-asset',
    subjectVerified: true,
    verifiedBy: VISION,
    credit: FB_CREDIT,
  },

  // FOOTBALL PROGRAM CARD — young players in the club's black-and-orange uniforms,
  // on the field at an event, with a crowd and a tent behind them. Unmistakably
  // this organization and unmistakably football. (It replaced a night street scene
  // that had been assigned to this slot without the content ever being checked.)
  footballPlayers: {
    id: 'footballPlayers',
    src: '/images/redesign/football-players.jpg',
    width: 960,
    height: 540,
    variants: [{ src: '/images/redesign/football-players-640.jpg', width: 640 }],
    alt: 'Young Little Eagle football players in black and orange uniforms on the grass at the field, with a crowd and a tent behind them.',
    source: 'facebook-page',
    fbid: '1429402305252657',
    context: 'the organization’s Facebook photo (page photos / About), captured 2026-10-05',
    status: 'temporary-facebook-asset',
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
    status: 'temporary-facebook-asset',
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
 * let the second program card look broken. Neither is acceptable.
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
      'No cheer photograph exists in the captured source. Every full-resolution image on the organization’s public Facebook page that could be retrieved is American football; the only recent daylight action photographs are 160x160 thumbnails, which are unusable at card size. Assigning a football or street image to the Cheer card would have been a false description of the programme.',
    needs:
      'One or two cheer photographs (sideline or competition) from the organization, at 1200px or larger, with permission to publish.',
  },
];

/** Assets deliberately NOT used, recorded so the decision is not repeated. */
export const REJECTED_ASSETS = [
  {
    fbid: '1794831097925531',
    reason:
      'THE DEFECT THIS PASS FIXED: this night street scene — buildings, cars, dark storefronts, zero people — had been assigned to the Football program card on the strength of its filename alone. A vision-language description shows no sport and no people in frame. Removed from the page and from the bundle.',
  },
  {
    fbid: '26508028338804198',
    reason:
      'Team photograph with large baked-in text ("Great season Little Eagles!"). It reads as a reposted social graphic rather than photography, and the text duplicates the heading beside it. Used on the previous build’s community section; removed from the page and from the bundle.',
  },
  {
    fbid: '1536589455172298',
    reason:
      'Raffle thank-you post (843x536) — a fundraising graphic of a ticket stub, not photography. The brief excludes flyers and raffle graphics.',
  },
  {
    fbid: '8 daylight action frames (1536366505194593 … 1536366531861257)',
    reason:
      'Genuine youth football action frames, but the only copies retrievable without a logged-in session are 160x160 thumbnails. Far too small for a card (a card needs ~600px); using them would have meant a 3.75x upscale. They are recorded here so a future pass with the original files knows they exist.',
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

export const PLACEHOLDER_COUNT = PLACEHOLDERS.length;
