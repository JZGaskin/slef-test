// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// Little Eagle Football & Cheer — same stack as the Z33 baseline (Astro 5 + Tailwind 4 + Netlify).
//
// build.format = 'file' is deliberate: the existing site serves /pages/about (Netlify Pretty URLs
// rewriting /pages/about.html). Emitting `pages/about.html` reproduces that EXACTLY, so no page URL
// changes and no redirect is needed for a real page.
// A draft/branch build must not publish a sitemap at all — a sitemap is an
// invitation to crawl. Production is unaffected (the variable is never set there).
const DRAFT = process.env.PUBLIC_NOINDEX === 'true';

export default defineConfig({
  site: 'https://littleeaglefootball.com',
  build: { format: 'file' },
  trailingSlash: 'ignore',
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: DRAFT
    ? []
    : [
        sitemap({
          // Pages that must never be advertised to a crawler: the confirmation
          // page, the branded 404, and the internal styleguide review page.
          filter: (page) =>
            !page.includes('/thankyou') &&
            !page.includes('/404') &&
            !page.includes('/styleguide'),
        }),
      ],
});
