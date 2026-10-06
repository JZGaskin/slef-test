/**
 * One parser for Netlify redirect rules, shared by the local preview server and
 * the redirect-map test, so the two can never disagree about what a rule says.
 *
 * THE QUOTING TRAP THIS ENCODES
 * -----------------------------
 * In `_redirects` a `#` begins a comment, so a destination with a URL fragment
 * (`/#about`) is silently truncated to `/` unless the value is QUOTED. Netlify
 * documents this ("if your from or to value includes a #, enclose it in quotes").
 * Rather than trust that everyone remembers, the parser cuts an UNQUOTED token at
 * the first `#` — exactly as Netlify does — so an unquoted fragment fails loudly in
 * the test instead of silently redirecting to the wrong page. Quoted tokens are
 * taken verbatim.
 */

/** Split one `_redirects` line into tokens, honouring quotes and comments. */
export function tokenizeRedirectLine(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t' || c === '\r') { i += 1; continue; }
    if (c === '#') break; // unquoted `#` starts a comment
    if (c === '"') {
      const end = line.indexOf('"', i + 1);
      if (end === -1) { out.push(line.slice(i + 1)); break; }
      out.push(line.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    let j = i;
    while (j < line.length && line[j] !== ' ' && line[j] !== '\t' && line[j] !== '#' && line[j] !== '\r') j += 1;
    out.push(line.slice(i, j));
    i = j;
  }
  return out;
}

/** Parse a `_redirects` document. */
export function parseRedirectsFile(text) {
  const rules = [];
  for (const line of text.split('\n')) {
    const [from, to, status] = tokenizeRedirectLine(line);
    if (!from || !to) continue;
    const raw = status ?? '301';
    rules.push({
      from,
      to,
      status: Number(String(raw).replace('!', '')) || 301,
      force: String(raw).endsWith('!'),
    });
  }
  return rules;
}

/** Parse the `[[redirects]]` tables of a netlify.toml document. */
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
