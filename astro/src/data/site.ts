// Site-wide constants. One place for the things that recur on every page.
//
// AUTHORITATIVE NAME (decided 2026-10-05): "Somerset Little Eagle Football".
// Cheer is a PROGRAM of the organization, not part of its name. The Facebook
// page already brands itself this way, so the change aligns the website with
// what the organization uses.
//
// The MachForm `title` strings below are NOT branding — they are the vendor's
// own embed metadata (`data-formtitle`) and part of the integration contract, so
// they are preserved verbatim. The name change never propagates into a form.
export const SITE = {
  name: 'Somerset Little Eagle Football',
  descriptor: 'Youth Football & Cheer in Somerset, Pennsylvania',
  programNote: 'Cheer is a program of Somerset Little Eagle Football.',
  shortName: 'Somerset Little Eagles',
  url: 'https://littleeaglefootball.com',
  facebook: 'https://www.facebook.com/SomersetLittleEagleFootball',
  physicalFormPdf:
    'https://drive.google.com/file/d/1xM_LaYQ0UGx6HOIwWvgHuatbz2sdhkXn/view?usp=sharing',
  league: 'Laurel Highlands Developmental Football League',
  leagueShort: 'LHDFL',
  leagueUrl: 'http://lhdfl.com/',
  grades: 'K\u20136',
  season: 'August\u2013October',
  // NOT PUBLISHED. The address appears on the organization's public Facebook
  // About panel, but its intent (is it the address to publish, and who reads it)
  // has not been confirmed by the client. The redesign deliberately shows no
  // contact address until that is confirmed — a wrong address is worse than
  // none. Flip `verified` to true and it appears in the contact block and footer.
  contactEmail: { value: 'littleeaglevolunteers@gmail.com', verified: false },
};

// Primary navigation. Football/Cheer/About/Fields are homepage sections (the
// approved consolidation: About and Fields stop being standalone destinations);
// Contact is the one thin utility route kept in the nav.
export const NAV = [
  { key: 'football', href: '/#football', label: 'Football' },
  { key: 'cheer', href: '/#cheer', label: 'Cheer' },
  { key: 'about', href: '/#about', label: 'About' },
  { key: 'fields', href: '/#fields', label: 'Fields' },
  { key: 'contact', href: '/contact', label: 'Contact' },
];

export const FOOTER_NAV = [
  { href: '/#football', label: 'Football' },
  { href: '/#cheer', label: 'Cheer' },
  { href: '/#about', label: 'About' },
  { href: '/#fields', label: 'Fields' },
  { href: '/#resources', label: 'Parent resources' },
  { href: '/contact', label: 'Contact' },
];

// The one thing the site exists to cause, repeated in the header, the hero, the
// registration band and the footer.
export const REGISTER_CTA = { href: '/register', label: 'Register' };

// County venues, reproduced verbatim from the live /pages/fields page. The MAP
// links are still the original goo.gl short links: they work, and rewriting them
// is a change nobody has reviewed yet.
export const VENUES = [
  { name: 'Somerset', address: '645 S Columbia Ave., Somerset, PA 15501', map: 'https://goo.gl/maps/MuCZWz6ZBRE5FK2w6', home: true },
  { name: 'Bishop McCort', address: '100 Johns Street, Johnstown, PA 15901 - Point Stadium', map: 'https://goo.gl/maps/GGonazVRiFBz5hWP6' },
  { name: 'Central Cambria', address: '999 9th St Colver, PA 15927', map: 'https://goo.gl/maps/FTXMRQJDoDGdu2Eq5' },
  { name: 'Forest Hills', address: 'Playground Drive Johnstown PA 15904', map: 'https://goo.gl/maps/HTpY1pxUhKe4mmvs8' },
  { name: 'Johnstown', address: '222 Central Ave. Johnstown, PA 15902', map: 'https://goo.gl/maps/RB6Z3a5qgbxfCB3w9' },
  { name: 'Mainline - Penn Cambria', address: 'Memorial Drive Lilly, PA 15938', map: 'https://goo.gl/maps/PovV8dp5zthRDYa3A' },
  { name: 'Richland', address: '1 Academic Ave. Johnstown, PA 15904', map: 'https://goo.gl/maps/LkGJ7uYrnB2NQHwk8' },
  { name: 'Westmont', address: '827 Diamond Blvd. Johnstown, PA 15905', map: 'https://goo.gl/maps/Kj6ohoie3VbtErje9' },
];

// Every coach must hold these. The links are the ones the live About page
// publishes; they are official sources (PA DHS, PA State Police, CDC).
export const SAFETY_LINKS = [
  { label: 'PA Child Abuse History Clearance', href: 'https://www.dhs.pa.gov/KeepKidsSafe/Clearances/Pages/PA-Child-Abuse-History-Clearance.aspx' },
  { label: 'Pennsylvania State Police Clearance', href: 'https://epatch.pa.gov/home' },
  { label: 'CDC concussion awareness training', href: 'https://www.cdc.gov/heads-up/training/youth-sports.html' },
];

export const PLAYER_EXPECTATIONS = [
  'Arrival to practices and games on time.',
  'Consistent attendance of scheduled games and practices.',
  'Put forth a reasonable effort at both practices and games.',
  'Display respectful behavior toward the coaches and teammates at all times.',
];

// Font Awesome 6.1.0 brands/facebook-f (CC BY 4.0) — the one icon the site used,
// now inline so the Font Awesome CDN is not needed at all.
export const FACEBOOK_ICON_PATH =
  'M279.14 288l14.22-92.66h-88.91v-60.13c0-25.35 12.42-50.06 52.24-50.06h40.42V6.26S260.43 0 225.36 0c-73.22 0-121.08 44.38-121.08 124.72v70.62H22.89V288h81.39v224h100.17V288z';

// MachForm embeds. The account, the embed host and the post-submit redirect back
// into this site are unchanged — this is an integration contract, not a setting.
export const MACHFORM = {
  host: 'https://z33design.forms-db.com',
  loaderBase: 'https://assets.forms-db.com/',
  forms: {
    registration2026: { id: '41557', title: '2026 Little Eagle Football & Cheer', height: 5339 },
    contact: { id: '24057', title: 'Contact Us', height: 555 },
    physical2026: { id: '42461', title: 'Submit Physicals for 2026', height: 574 },
  },
};
