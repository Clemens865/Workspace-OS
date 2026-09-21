/**
 * The FIXED in-page extraction script for browser-drive.
 *
 * SECURITY: the agent NEVER supplies JavaScript. It picks a `mode` from a small
 * enum; we map that to one of these pre-written, side-effect-free scripts that
 * only READ the DOM and return a JSON-serialisable value. This is the sole code
 * ever passed to `guest.executeJavaScript`, so a compromised prompt cannot run
 * arbitrary JS in the guest page.
 */

/** The extraction modes the agent may request. */
export type ExtractMode = 'text' | 'links' | 'tables' | 'meta'

export const EXTRACT_MODES: readonly ExtractMode[] = ['text', 'links', 'tables', 'meta']

/** Narrow an untrusted value to a valid mode (defaults to 'text'). */
export function normalizeMode(raw: unknown): ExtractMode {
  return (EXTRACT_MODES as readonly string[]).includes(raw as string)
    ? (raw as ExtractMode)
    : 'text'
}

// Each script is a self-contained IIFE returning a plain object. Kept as strings
// (not functions) so they run verbatim in the GUEST context, not ours. They cap
// output size so a huge page can't return an unbounded payload to the agent.
const SCRIPTS: Record<ExtractMode, string> = {
  // Visible text: title + a trimmed innerText of <body> (cap ~20k chars).
  text: `(() => {
    const t = document.title || '';
    const body = document.body ? (document.body.innerText || '') : '';
    const text = body.replace(/\\s+\\n/g, '\\n').replace(/[\\t ]{2,}/g, ' ').trim().slice(0, 20000);
    return { title: t, text };
  })()`,
  // Anchors: href + trimmed label, http(s) only, de-duped, cap 500.
  links: `(() => {
    const out = []; const seen = new Set();
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      const href = a.href || '';
      if (!/^https?:/i.test(href) || seen.has(href)) continue;
      seen.add(href);
      out.push({ href, text: (a.textContent || '').trim().slice(0, 200) });
      if (out.length >= 500) break;
    }
    return { links: out };
  })()`,
  // Tables: each <table> as a grid of trimmed cell strings, cap 20 tables/200 rows.
  tables: `(() => {
    const tables = [];
    for (const tbl of Array.from(document.querySelectorAll('table')).slice(0, 20)) {
      const rows = [];
      for (const tr of Array.from(tbl.querySelectorAll('tr')).slice(0, 200)) {
        const cells = Array.from(tr.querySelectorAll('th,td')).map(
          (c) => (c.textContent || '').trim().slice(0, 500)
        );
        if (cells.length) rows.push(cells);
      }
      if (rows.length) tables.push(rows);
    }
    return { tables };
  })()`,
  // Meta: title, canonical url, description, and og:* / name meta tags (cap 50).
  meta: `(() => {
    const meta = {};
    let n = 0;
    for (const m of Array.from(document.querySelectorAll('meta[name],meta[property]'))) {
      if (n >= 50) break;
      const k = m.getAttribute('name') || m.getAttribute('property');
      const v = m.getAttribute('content');
      if (k && v) { meta[k] = v.slice(0, 500); n++; }
    }
    const canonical = document.querySelector('link[rel="canonical"]');
    return {
      title: document.title || '',
      url: location.href,
      canonical: canonical ? canonical.href : null,
      meta,
    };
  })()`,
}

/** The verbatim in-page script for a (already normalized) mode. */
export function scriptForMode(mode: ExtractMode): string {
  return SCRIPTS[mode]
}
