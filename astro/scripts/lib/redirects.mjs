/**
 * One parser for Netlify redirect rules, shared by the local preview server, the
 * QA harness and the redirect-map tests, so no two of them can disagree about what
 * a rule says — or about whether a rule EXISTS.
 *
 * WHY THIS FILE WAS REWRITTEN (2026-10-06)
 * ----------------------------------------
 * The first version of this parser invented a quoting convention: it treated a
 * `"`-delimited token as a quoted value and "documented" that Netlify wants a
 * fragment enclosed in quotes. Netlify does NOT. The real parser
 * (`@netlify/redirect-parser`) splits a line on whitespace, treats a token that
 * BEGINS with `#` as a comment, and requires the destination token to begin with
 * `/` or be an absolute `http:`/`https:` URL:
 *
 *     const isToPart = (part) => part.startsWith('/') || isUrl(part);
 *     const isComment = (part) => part.startsWith('#');
 *
 * So `"/#about"` starts with `"`, is not a valid destination, and the whole line is
 * rejected as a parse error and DROPPED. On the live deploy that produced exactly
 * eight 404s (`/about`, `/about.html`, `/pages/about`, `/pages/about.html`, and the
 * four Fields equivalents) while every unquoted rule worked.
 *
 * `parseRedirectsFile` therefore returns `{ rules, errors }` and callers MUST treat
 * a non-empty `errors` as fatal: a dropped rule is a 404 for a real visitor, and a
 * harness that accepted the dropped form was more permissive than production. The
 * local preview REFUSES TO SERVE such a build, and the tests fail on it.
 *
 * Modelling notes (all verified against the vendor parser/engine):
 *  * tokens are split on whitespace (`/\s+/`), never on commas or quotes;
 *  * the first token that starts with `#` begins a comment; the rest of the line goes;
 *  * a fragment (`#…`) is therefore unreachable in a `_redirects` destination — a
 *    fragment is applied by the browser after the redirect, never by the rule;
 *  * one rule also matches the trailing-slash form (`/pages/register/`), which is
 *    why `matchRedirect` normalises a single trailing slash.
 */

/** Split one `_redirects` line into whitespace-separated tokens (no quote syntax). */
export function tokenizeRedirectLine(line) {
  return line.split(/\s+/).filter((t) => t !== '');
}

/**
 * The Netlify rule: a destination token must begin with `/` or be an absolute URL.
 * A token that begins with `#` is a comment instead.
 */
const isComment = (part) => part.startsWith('#');
const isUrl = (part) => /^https?:\/\//i.test(part);
const isToPart = (part) => part.startsWith('/') || isUrl(part);
const isStatusPart = (part) => /^\d{3}!?$/.test(part);

/**
 * Parse a `_redirects` document.
 *
 * @returns {{ rules: Array<{from:string,to:string,status:number,force:boolean,line:number}>, errors: string[] }}
 *   `errors` is EMPTY for a healthy file. Every entry describes one dropped line.
 */
export function parseRedirectsFile(text) {
  const rules = [];
  const errors = [];

  text.split('\n').forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const tokens = tokenizeRedirectLine(rawLine.trim());
    // A comment is a token that begins with `#` — it removes that token and the rest.
    const firstComment = tokens.findIndex(isComment);
    const parts = firstComment === -1 ? tokens : tokens.slice(0, firstComment);
    if (parts.length === 0) return; // blank line or pure comment

    const [from, ...rest] = parts;
    if (!from.startsWith('/') && !isUrl(from)) {
      errors.push(`line ${lineNo}: the source must start with "/" or be an absolute URL — got ${JSON.stringify(from)}`);
      return;
    }
    const toIndex = rest.findIndex(isToPart);
    if (toIndex === -1) {
      // This is the exact failure that shipped: `"/#about"` begins with `"`.
      errors.push(
        `line ${lineNo}: the destination must start with "/", "http:" or "https:" — got ` +
          `${JSON.stringify(rest[0] ?? '(missing)')}; Netlify DROPS this rule (a fragment cannot be a destination)`,
      );
      return;
    }
    const to = rest[toIndex];
    const queryParts = rest.slice(0, toIndex);
    const statusPart = rest[toIndex + 1];
    if (queryParts.length) {
      errors.push(`line ${lineNo}: unsupported query token(s) ${JSON.stringify(queryParts)} before the destination`);
      return;
    }
    if (statusPart !== undefined && !isStatusPart(statusPart)) {
      errors.push(`line ${lineNo}: the status must look like 301 or 301! — got ${JSON.stringify(statusPart)}`);
      return;
    }
    rules.push({
      from,
      to,
      status: Number((statusPart ?? '301').replace('!', '')),
      force: (statusPart ?? '').endsWith('!'),
      line: lineNo,
    });
  });

  return { rules, errors };
}

/**
 * Parse the `[[redirects]]` tables of a netlify.toml document.
 * Kept structurally identical in output to `parseRedirectsFile` so the two copies
 * can be compared. NOTE: TOML legitimately supports a fragment destination; the
 * project keeps the lists identical anyway, and defers the fragment to the nav.
 */
export function parseNetlifyToml(text) {
  return [...text.matchAll(/\[\[redirects\]\]([\s\S]*?)(?=\n\[\[|\n\[|\s*$)/g)].map((m) => {
    const get = (k) => (m[1].match(new RegExp(`^\\s*${k}\\s*=\\s*"([^"]*)"`, 'm')) ?? [])[1];
    return {
      from: get('from'),
      to: get('to'),
      status: Number(get('status') ?? 301),
      force: /^\s*force\s*=\s*true\s*$/m.test(m[1]),
    };
  });
}

/**
 * Match a request path against the rules, the way Netlify's engine does.
 * Exact match first; then one optional trailing slash (`/pages/register/`).
 * @returns the matching rule, or null.
 */
export function matchRedirect(rules, urlPath) {
  const exact = rules.find((r) => r.from === urlPath);
  if (exact) return exact;
  if (urlPath.length > 1 && urlPath.endsWith('/')) {
    const trimmed = urlPath.replace(/\/+$/, '');
    return rules.find((r) => r.from === trimmed) ?? null;
  }
  return null;
}

/**
 * Find redirect cycles: a rule whose destination is another rule's source, which
 * (directly or transitively) leads back to the first. Returns one string per cycle.
 */
export function findRedirectLoops(rules) {
  const byFrom = new Map(rules.map((r) => [r.from, r]));
  const loops = [];
  const targetOf = (to) => to.split('?')[0].split('#')[0];
  for (const rule of rules) {
    const seen = new Set([rule.from]);
    let cur = byFrom.get(targetOf(rule.to));
    while (cur) {
      if (seen.has(cur.from)) {
        loops.push(`${rule.from} -> ${rule.to} -> … -> ${cur.from}`);
        break;
      }
      seen.add(cur.from);
      cur = byFrom.get(targetOf(cur.to));
    }
  }
  return loops;
}
