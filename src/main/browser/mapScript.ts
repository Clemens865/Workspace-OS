/**
 * FIXED page-PERCEPTION script for browser-drive (`browser.map`). Sibling to
 * extractScript.ts / interactScript.ts and follows the SAME security model.
 *
 * SECURITY: the agent NEVER supplies JavaScript. `mapScript()` returns a
 * pre-written, side-effect-free script STRING that only READS the DOM and
 * returns a JSON-serialisable structured perception of the page (links by
 * category, interactives, headings, consent hint). It takes NO agent input, so
 * a hostile prompt cannot influence the code that reaches `executeJavaScript`.
 * Output sizes are CAPPED so a huge page can't return an unbounded payload.
 *
 * The link CATEGORY needles (EN + DE) are also exported so the classifier can be
 * unit-tested here in node, mirroring the same logic embedded in the in-page IIFE.
 */

/** The link categories browser.map buckets anchors into. */
export type LinkCategory =
  | 'about'
  | 'team'
  | 'products'
  | 'contact'
  | 'careers'
  | 'other'

/**
 * Per-category needles matched (case-insensitively, as substrings) against an
 * anchor's href + visible text. EN + DE. Order matters: the first category with
 * a hit wins, so more-specific buckets (careers, contact, team) precede the
 * broad ones. Exported so the classifier is unit-testable in isolation.
 */
export const CATEGORY_NEEDLES: readonly (readonly [LinkCategory, readonly string[]])[] = [
  ['careers', ['careers', 'career', 'jobs', 'job', 'karriere', 'stellenangebote', 'stellen']],
  ['contact', ['contact', 'kontakt', 'impressum', 'imprint']],
  ['team', ['team', 'people', 'mitarbeiter', 'management', 'führung', 'fuhrung', 'leadership']],
  ['about', ['about', 'company', 'über-uns', 'ueber-uns', 'uber-uns', 'über uns', 'unternehmen', 'about-us']],
  [
    'products',
    ['products', 'product', 'services', 'service', 'produkte', 'produkt', 'leistungen', 'lösungen', 'loesungen', 'losungen', 'angebote', 'angebot', 'solutions'],
  ],
]

/**
 * Classify an anchor by its href + visible text. Pure mirror of the in-page
 * logic, exported for unit tests. Returns the first matching category, else
 * 'other'. Matching is case-insensitive substring over `href + ' ' + text`.
 */
export function classifyLink(href: string, text: string): LinkCategory {
  const hay = `${href} ${text}`.toLowerCase()
  for (const [cat, needles] of CATEGORY_NEEDLES) {
    if (needles.some((n) => hay.includes(n))) return cat
  }
  return 'other'
}

/** Caps for the map payload (keep the agent-facing JSON compact). */
export const MAP_CAPS = { links: 60, interactives: 30, headings: 20 } as const

// The category needles serialised into the in-page script. The in-page classify
// mirrors classifyLink() above (kept in sync; the unit test guards the JS logic
// indirectly via classifyLink and directly via a smoke assertion on the string).
const NEEDLES_JSON = JSON.stringify(CATEGORY_NEEDLES)

/**
 * The verbatim in-page perception script. A self-contained IIFE returning a
 * plain object: `{ title, headings, links, interactives, consent }`. Runs in the
 * GUEST context; reads only. No agent input.
 */
export function mapScript(): string {
  const caps = JSON.stringify(MAP_CAPS)
  return `(() => {
    const CAPS = ${caps};
    const NEEDLES = ${NEEDLES_JSON};
    const classify = (href, text) => {
      const hay = ((href || '') + ' ' + (text || '')).toLowerCase();
      for (const pair of NEEDLES) {
        const cat = pair[0], needles = pair[1];
        for (const n of needles) { if (hay.indexOf(n) !== -1) return cat; }
      }
      return 'other';
    };
    const vis = (el) => {
      if (!el || !el.getClientRects || !el.getClientRects().length) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none';
    };

    // Links: absolute http(s) href + trimmed text, deduped, categorised, capped.
    const links = []; const seenHref = new Set();
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      const href = a.href || '';
      if (!/^https?:/i.test(href) || seenHref.has(href)) continue;
      seenHref.add(href);
      const text = (a.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 160);
      links.push({ text, href, category: classify(href, text) });
      if (links.length >= CAPS.links) break;
    }

    // Interactives: buttons / [role=button] / forms, with a label + type, capped.
    const interactives = [];
    const inodes = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], form'));
    for (const el of inodes) {
      if (interactives.length >= CAPS.interactives) break;
      if (!vis(el)) continue;
      const tag = (el.tagName || '').toLowerCase();
      const label = (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || el.getAttribute('name') || '').trim().replace(/\\s+/g, ' ').slice(0, 120);
      const type = el.getAttribute('type') || (tag === 'form' ? (el.getAttribute('method') || 'form') : tag);
      if (tag === 'form' || label) interactives.push({ tag, text: label, type });
    }

    // Headings: h1/h2 text, capped.
    const headings = [];
    for (const h of Array.from(document.querySelectorAll('h1, h2'))) {
      if (headings.length >= CAPS.headings) break;
      const t = (h.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 200);
      if (t) headings.push(t);
    }

    // Consent: an overlay/banner OR a consent-wall URL/iframe present?
    const consentUrl = /consent|privacy|cmp|tcf|gdpr/i.test(location.href);
    let overlay = false; let hint = '';
    const CMP = ['#onetrust-banner-sdk', '#CybotCookiebotDialog', '#usercentrics-root', '.cc-window', '[id*="cookie" i]', '[class*="consent" i]', '[aria-label*="cookie" i]', '[aria-label*="consent" i]'];
    for (const sel of CMP) {
      let el = null; try { el = document.querySelector(sel); } catch (e) { el = null; }
      if (el && vis(el)) { overlay = true; hint = sel; break; }
    }
    let consentFrame = false;
    for (const f of Array.from(document.querySelectorAll('iframe'))) {
      const src = f.getAttribute('src') || '';
      if (/consent|cmp|tcf|privacy/i.test(src)) { consentFrame = true; break; }
    }
    const consent = {
      present: overlay || consentUrl || consentFrame,
      hint: hint || (consentUrl ? 'consent-url' : (consentFrame ? 'consent-iframe' : '')),
    };

    return { title: document.title || '', url: location.href, headings, links, interactives, consent };
  })()`
}
