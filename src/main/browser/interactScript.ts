/**
 * FIXED in-page INTERACTION scripts for browser-drive (click / scroll / wait /
 * dismiss-cookies / type). Sibling to extractScript.ts and follows the SAME
 * security model.
 *
 * SECURITY: the agent NEVER supplies JavaScript. Each builder below returns a
 * pre-written, vetted script STRING; the only agent influence is a handful of
 * simple, validated inputs (a CSS selector, a visible-text string, a
 * direction/amount, a timeout) that are ESCAPED and embedded as DATA — never as
 * code. The escaping (`jsString`) turns any input into a safe JS string literal,
 * so a hostile selector/text/value can only ever be compared or assigned, not
 * executed. This is the sole code passed to `guest.executeJavaScript`.
 */

/** Cap a caller string so a huge selector/text can't bloat the script. */
function cap(raw: unknown, max = 400): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : ''
}

/**
 * Encode an arbitrary string as a SAFE single-quoted JS string literal. Escapes
 * backslash, quote, and every line terminator so the value is inert DATA in the
 * emitted script — it can be compared/assigned but never break out into code.
 */
export function jsString(raw: unknown): string {
  const s = cap(raw)
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  return `'${escaped}'`
}

/** Shared in-page helpers (visibility test + case-insensitive text match). */
const HELPERS = `
  const __vis = (el) => {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const __label = (el) => ((el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '')).trim();
  const __topmost = (els) => els.slice().sort((a, b) => {
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return (ra.top - rb.top) || (ra.left - rb.left);
  })[0];
`

/**
 * The cookie-consent ACCEPT selectors + visible-text needles (EN + DE). Exported
 * so a unit test can assert the coverage is present. Case-insensitive on text.
 */
export const COOKIE_ACCEPT_SELECTORS: readonly string[] = [
  '#onetrust-accept-btn-handler',
  '.cc-allow',
  '.cc-accept',
  '[aria-label*="accept" i]',
  'button[mode="primary"]',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#CybotCookiebotDialogBodyButtonAccept',
  '[data-testid*="accept" i]',
  '[data-cy*="accept" i]',
  '.uc-btn-accept',
  '#uc-btn-accept-banner',
  'button[data-role="accept-all"]',
  '.fc-cta-consent',
  '.js-accept-cookies',
  '#accept-cookies',
]

export const COOKIE_ACCEPT_TEXTS: readonly string[] = [
  'accept all',
  'accept',
  'agree',
  'i agree',
  'ok',
  'got it',
  'allow all',
  'alle akzeptieren',
  'akzeptieren',
  'zustimmen',
  'einverstanden',
  'alle zulassen',
  'verstanden',
]

/**
 * dismissCookies: a FIXED heuristic. Try each known CMP selector, then fall back
 * to a visible-text match across clickable elements. Clicks the top-most visible
 * match and returns `{clicked, label}`. Best-effort: `{clicked:false}` when none.
 * Takes NO agent input — the selector/text lists are hard-coded here.
 */
export function dismissCookiesScript(): string {
  const selectors = JSON.stringify(COOKIE_ACCEPT_SELECTORS)
  const texts = JSON.stringify(COOKIE_ACCEPT_TEXTS)
  return `(() => {${HELPERS}
    const SELECTORS = ${selectors};
    const TEXTS = ${texts};
    for (const sel of SELECTORS) {
      let el;
      try { el = document.querySelector(sel); } catch (e) { continue; }
      if (el && __vis(el)) { el.click(); return { clicked: true, label: __label(el).slice(0, 120) }; }
    }
    const clickable = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'));
    const matches = [];
    for (const el of clickable) {
      if (!__vis(el)) continue;
      const lbl = __label(el).toLowerCase();
      if (!lbl) continue;
      if (TEXTS.some((t) => lbl === t || lbl.startsWith(t))) matches.push(el);
    }
    const hit = matches.length ? __topmost(matches) : null;
    if (hit) { hit.click(); return { clicked: true, label: __label(hit).slice(0, 120) }; }
    return { clicked: false };
  })()`
}

/**
 * clearConsent: a HARDENED, FIXED consent-clearer. Extends dismissCookies to
 * also handle consent-WALL pages (a dedicated /consent|/privacy|cmp|tcf page, or
 * a page dominated by a consent UI) and best-effort SAME-ORIGIN iframes. Tries,
 * in order: (1) the overlay accept (dismissCookies selectors/texts on the top
 * document); (2) if the page looks like a wall, the same needles again but
 * reported as a wall click; (3) accessible (same-origin) iframes — cross-origin
 * frames throw on access and are skipped SILENTLY (noted in the result).
 *
 * Takes NO agent input — all selectors/text are hard-coded here. Returns
 * `{cleared, method:'overlay'|'wall'|'iframe'|'none', wasWall}`. Best-effort:
 * `cleared:false` is NOT an error.
 */
export function clearConsentScript(): string {
  const selectors = JSON.stringify(COOKIE_ACCEPT_SELECTORS)
  const texts = JSON.stringify(COOKIE_ACCEPT_TEXTS)
  return `(() => {${HELPERS}
    const SELECTORS = ${selectors};
    const TEXTS = ${texts};
    // Try to click an accept match within a given Document (top doc or iframe doc).
    const clickAccept = (doc) => {
      for (const sel of SELECTORS) {
        let el; try { el = doc.querySelector(sel); } catch (e) { continue; }
        if (el && __vis(el)) { el.click(); return true; }
      }
      let clickable;
      try { clickable = Array.from(doc.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]')); }
      catch (e) { return false; }
      const matches = [];
      for (const el of clickable) {
        if (!__vis(el)) continue;
        const lbl = __label(el).toLowerCase();
        if (!lbl) continue;
        if (TEXTS.some((t) => lbl === t || lbl.startsWith(t))) matches.push(el);
      }
      const hit = matches.length ? __topmost(matches) : null;
      if (hit) { hit.click(); return true; }
      return false;
    };
    // Is this a consent WALL? A dedicated consent URL, or a page whose body is
    // dominated by a consent-looking container.
    const wallUrl = /consent|privacy|cmp|tcf|gdpr/i.test(location.href);
    let wallDom = false;
    try {
      const c = document.querySelector('[id*="consent" i], [class*="consent" i], [id*="cmp" i], [class*="cmp" i]');
      if (c && __vis(c)) {
        const r = c.getBoundingClientRect();
        wallDom = (r.width * r.height) > (window.innerWidth * window.innerHeight * 0.4);
      }
    } catch (e) { wallDom = false; }
    const wasWall = !!(wallUrl || wallDom);

    // (1) overlay on the top document.
    if (clickAccept(document)) {
      return { cleared: true, method: wasWall ? 'wall' : 'overlay', wasWall };
    }
    // (3) best-effort same-origin iframes (cross-origin access throws → skip).
    for (const f of Array.from(document.querySelectorAll('iframe'))) {
      let d = null;
      try { d = f.contentDocument; } catch (e) { d = null; }
      if (!d) continue; // cross-origin — inaccessible, skip silently
      if (clickAccept(d)) return { cleared: true, method: 'iframe', wasWall };
    }
    return { cleared: false, method: 'none', wasWall };
  })()`
}

/**
 * click: click the first VISIBLE element matching `selector` OR (fallback) a
 * visible-text match across buttons/links/[role=button]. Returns
 * `{clicked, tag, text, href}`. Both inputs are escaped DATA (jsString).
 */
export function clickScript(selector: unknown, text: unknown): string {
  const sel = jsString(selector)
  const txt = jsString(cap(text).toLowerCase())
  return `(() => {${HELPERS}
    const sel = ${sel};
    const txt = ${txt};
    let el = null;
    if (sel) {
      let list = [];
      try { list = Array.from(document.querySelectorAll(sel)); } catch (e) { list = []; }
      el = list.find(__vis) || null;
    }
    if (!el && txt) {
      const clickable = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'));
      const matches = clickable.filter((c) => __vis(c) && __label(c).toLowerCase().includes(txt));
      el = matches.length ? __topmost(matches) : null;
    }
    if (!el) return { clicked: false };
    el.click();
    return {
      clicked: true,
      tag: (el.tagName || '').toLowerCase(),
      text: __label(el).slice(0, 200),
      href: el.href || undefined,
    };
  })()`
}

/** Scroll direction the agent may request. */
export type ScrollTo = 'top' | 'bottom'

/**
 * scroll: window.scrollTo('top'|'bottom') or scrollBy(0, amount). `by` is
 * clamped to a sane numeric range. Returns `{scrollY, atBottom}`.
 */
export function scrollScript(to: unknown, by: unknown): string {
  const dir = to === 'top' || to === 'bottom' ? to : ''
  // Clamp `by` to a finite integer within +-100000; ignore anything else.
  const amt = typeof by === 'number' && Number.isFinite(by)
    ? Math.max(-100000, Math.min(100000, Math.trunc(by)))
    : 0
  return `(() => {
    const dir = '${dir}';
    const by = ${amt};
    if (dir === 'top') window.scrollTo(0, 0);
    else if (dir === 'bottom') window.scrollTo(0, document.body ? document.body.scrollHeight : 0);
    else if (by) window.scrollBy(0, by);
    const doc = document.documentElement;
    const atBottom = (window.scrollY + window.innerHeight) >= (doc.scrollHeight - 2);
    return { scrollY: Math.round(window.scrollY), atBottom };
  })()`
}

/** Cap a timeout to a sane range (default 8s, max 30s). */
export function normalizeTimeout(raw: unknown, def = 8000, max = 30000): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : def
  return Math.max(0, Math.min(max, n))
}

/**
 * waitFor: poll IN-PAGE (capped) until an element matching `selector`/`text`
 * appears, or timeout. Returns `{found}`. Runs as an async IIFE resolved by
 * executeJavaScript. Inputs are escaped DATA.
 */
export function waitForScript(selector: unknown, text: unknown, timeoutMs: unknown): string {
  const sel = jsString(selector)
  const txt = jsString(cap(text).toLowerCase())
  const timeout = normalizeTimeout(timeoutMs)
  return `(() => new Promise((resolve) => {
    const sel = ${sel};
    const txt = ${txt};
    const deadline = Date.now() + ${timeout};
    const vis = (el) => {
      if (!el || !el.getClientRects || !el.getClientRects().length) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none';
    };
    const find = () => {
      if (sel) {
        let list = [];
        try { list = Array.from(document.querySelectorAll(sel)); } catch (e) { list = []; }
        if (list.some(vis)) return true;
      }
      if (txt) {
        const els = Array.from(document.querySelectorAll('body *'));
        for (const el of els) {
          const lbl = (el.innerText || el.textContent || '').toLowerCase();
          if (lbl.includes(txt) && vis(el)) return true;
        }
      }
      return false;
    };
    const tick = () => {
      if (find()) return resolve({ found: true });
      if (Date.now() >= deadline) return resolve({ found: false });
      setTimeout(tick, 150);
    };
    tick();
  }))`
}

/**
 * type: set an input/textarea's `.value` and dispatch input/change so frameworks
 * notice. The agent's `text` is DATA assigned to `.value` — NEVER executed. The
 * selector is escaped DATA. Returns `{typed, tag}`.
 */
export function typeScript(selector: unknown, text: unknown): string {
  const sel = jsString(selector)
  const val = jsString(text)
  return `(() => {${HELPERS}
    const sel = ${sel};
    const val = ${val};
    let el = null;
    try { el = Array.from(document.querySelectorAll(sel)).find(__vis) || null; } catch (e) { el = null; }
    if (!el || !('value' in el)) return { typed: false };
    el.focus();
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { typed: true, tag: (el.tagName || '').toLowerCase() };
  })()`
}
