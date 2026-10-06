// Image manifest — the single place a photograph is declared, described and
// attributed.
//
// WHY THIS EXISTS
// ---------------
// Stage 1 uses current imagery from the organization's own public Facebook page,
// because that page is the living source of up-to-date team photography and it
// avoids creating an ongoing "send us your photos" workflow for a volunteer
// organization. Those web copies are:
//
//   * lower resolution than the organization's originals, and
//   * NOT licensed for production use merely because they are public.
//
// So every asset is declared here with its provenance, marked
// `temporary-facebook-asset`, and rendered with `data-asset-status` on the
// element. The production-readiness gate (`scripts/check-assets.mjs`) fails while
// any temporary asset remains, which makes "we shipped unapproved imagery" a
// structural impossibility rather than a promise.
//
// REPLACING AN IMAGE (the whole point of the manifest)
// ---------------------------------------------------
//   1. drop the new file in `public/images/redesign/` with the same filename
//      (or add a new entry),
//   2. update `width`/`height` (+ the variant list) here,
//   3. set `status: 'approved'` and `subjectVerified: true`, and rewrite `alt`
//      to describe what the photograph actually shows.
// No component changes. No copy changes. One data file.
//
// SUBJECT VERIFICATION: `subjectVerified: false` means the geometric properties
// were measured but the *content* of the picture was not visually confirmed when
// this build was produced. Alt text is therefore deliberately generic-but-true
// and must be rewritten at approval time. See the handoff, "requires Zach's
// judgement".

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
  /** Facebook photo object id — how to find the original again. */
  fbid: string;
  /** Where on the page it was captured from. */
  context: string;
  status: 'temporary-facebook-asset' | 'approved';
  subjectVerified: boolean;
  credit: string;
}

const FB_CREDIT = 'Somerset Little Eagle Football official Facebook page';

export const IMAGES: Record<string, ImageAsset> = {
  heroCover: {
    id: 'heroCover',
    src: '/images/redesign/hero-cover.jpg',
    width: 960,
    height: 572,
    variants: [{ src: '/images/redesign/hero-cover-640.jpg', width: 640 }],
    alt: 'Somerset Little Eagle Football — team photograph',
    source: 'facebook-page',
    fbid: '1457013789796532',
    context: 'the organization’s chosen page cover photo (set a.553052540192666)',
    status: 'temporary-facebook-asset',
    subjectVerified: false,
    credit: FB_CREDIT,
  },
  programA: {
    id: 'programA',
    src: '/images/redesign/program-a.jpg',
    width: 960,
    height: 540,
    variants: [{ src: '/images/redesign/program-a-640.jpg', width: 640 }],
    alt: 'Little Eagle players on the field',
    source: 'facebook-page',
    fbid: '1794831097925531',
    context: 'still from one of the page’s public reels (football/cheer programme imagery)',
    status: 'temporary-facebook-asset',
    subjectVerified: false,
    credit: FB_CREDIT,
  },
  programB: {
    id: 'programB',
    src: '/images/redesign/program-b.jpg',
    width: 960,
    height: 540,
    variants: [{ src: '/images/redesign/program-b-640.jpg', width: 640 }],
    alt: 'Little Eagles on the sideline',
    source: 'facebook-page',
    fbid: '1429402305252657',
    context: 'still from one of the page’s public reels (football/cheer programme imagery)',
    status: 'temporary-facebook-asset',
    subjectVerified: false,
    credit: FB_CREDIT,
  },
  portraitA: {
    id: 'portraitA',
    src: '/images/redesign/portrait-a.jpg',
    width: 540,
    height: 960,
    variants: [{ src: '/images/redesign/portrait-a-360.jpg', width: 360 }],
    alt: 'Little Eagle season moment',
    source: 'facebook-page',
    fbid: '1292764688304379',
    context: 'vertical still from one of the page’s public reels',
    status: 'temporary-facebook-asset',
    subjectVerified: false,
    credit: FB_CREDIT,
  },
  portraitB: {
    id: 'portraitB',
    src: '/images/redesign/portrait-b.jpg',
    width: 540,
    height: 960,
    variants: [{ src: '/images/redesign/portrait-b-360.jpg', width: 360 }],
    alt: 'Little Eagle season moment',
    source: 'facebook-page',
    fbid: '26508028338804198',
    context: 'vertical still from one of the page’s public reels',
    status: 'temporary-facebook-asset',
    subjectVerified: false,
    credit: FB_CREDIT,
  },
};

/** Assets deliberately NOT used, recorded so the decision is not repeated. */
export const REJECTED_ASSETS = [
  {
    fbid: '1536589455172298',
    reason:
      'Raffle thank-you post (843x536). Facebook’s own auto-alt reads “May be an image of ticket stub and text” — a fundraising graphic, not photography. The brief excludes flyers and raffle graphics.',
  },
  {
    fbid: 'SLEFLogo5.png',
    reason:
      'The organization logo is only 170x115 px. It is used at 40px CSS height (where it is still crisp); it is not usable as a larger mark and a vector original has been requested.',
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
