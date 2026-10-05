// Site-wide constants. One place for the things that recur on every page.
export const SITE = {
  name: 'Little Eagle Football & Cheer',
  shortName: 'Somerset Little Eagles',
  url: 'https://littleeaglefootball.com',
  facebook: 'https://www.facebook.com/SomersetLittleEagleFootball',
  physicalFormPdf:
    'https://drive.google.com/file/d/1xM_LaYQ0UGx6HOIwWvgHuatbz2sdhkXn/view?usp=sharing',
};

export const NAV = [
  { key: 'home', href: '/', label: 'Home' },
  { key: 'about', href: '/pages/about', label: 'About' },
  { key: 'register', href: '/pages/register', label: 'Register' },
  { key: 'fields', href: '/pages/fields', label: 'Fields' },
  { key: 'contact', href: '/pages/contact', label: 'Contact' },
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
