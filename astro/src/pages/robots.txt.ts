import type { APIRoute } from 'astro';
import { SITE } from '../data/site';

/**
 * robots.txt, generated so a draft build cannot accidentally invite crawlers.
 *
 * - production: allows crawling, keeps the confirmation page out, points at the sitemap
 * - draft/branch: refuses everything (belt) on top of the noindex meta tag (braces)
 *   and Netlify's own X-Robots-Tag: noindex on branch deploys
 */
const DRAFT = (import.meta.env.PUBLIC_NOINDEX ?? process.env.PUBLIC_NOINDEX) === 'true';

const PRODUCTION_ROBOTS = [
  'User-agent: *',
  'Allow: /',
  'Disallow: /thankyou',
  'Disallow: /styleguide',
  '',
  `Sitemap: ${SITE.url}/sitemap-index.xml`,
  '',
].join('\n');

const DRAFT_ROBOTS = [
  '# DRAFT / branch build — not for indexing. Do not link to this URL in public.',
  'User-agent: *',
  'Disallow: /',
  '',
].join('\n');

export const GET: APIRoute = () =>
  new Response(DRAFT ? DRAFT_ROBOTS : PRODUCTION_ROBOTS, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
