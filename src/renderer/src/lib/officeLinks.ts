/**
 * Office hyperlink handling for the LOK renderer.
 *
 * When the engine emits LOK_CALLBACK_HYPERLINK_CLICKED (type 7) for a clicked
 * link in a document (e.g. a URL cell in Calc), we route http(s) links to the
 * IN-APP Browser surface via the existing `wos:browser-navigate` CustomEvent —
 * never the OS browser. Non-web schemes (mailto:, file:, …) are left alone.
 */

/**
 * Normalize a clicked link into an http(s) URL suitable for the in-app browser,
 * or return null when it isn't a web link we should intercept.
 *
 * - `https://…` / `http://…`  → returned as-is (scheme lower-cased)
 * - bare `www.example.com`    → prefixed with `https://`
 * - `mailto:`, `file:`, `tel:`, other schemes → null (leave to default)
 * - empty / whitespace        → null
 */
export function normalizeWebUrl(raw: string): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null

  // Already an explicit http(s) URL.
  const m = /^(https?):\/\//i.exec(s)
  if (m) return m[1].toLowerCase() + s.slice(m[1].length)

  // Any OTHER explicit scheme (mailto:, file:, tel:, ftp:, javascript:, …) is
  // not a web link we intercept. Detect a scheme as `word:` at the start; a
  // bare host like `www.a.com` has no such prefix (the dot isn't a colon).
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null

  // Bare host that looks like a domain (has a dot, no spaces) → assume https.
  if (/^[^\s]+\.[^\s]+$/.test(s)) return `https://${s}`

  return null
}

/**
 * Parse a LOK_CALLBACK_HYPERLINK_CLICKED payload into a URL string.
 * Newer LibreOffice builds send JSON (`{"text":…,"href":…}` / `{"url":…}`);
 * older ones send the bare URL. Returns the raw href/url (un-normalized).
 */
export function parseHyperlinkPayload(payload: string): string {
  const s = (payload ?? '').trim()
  if (!s) return ''
  if (s.startsWith('{')) {
    try {
      const o = JSON.parse(s) as Record<string, unknown>
      const href = o.href ?? o.url ?? o.text
      if (typeof href === 'string') return href
    } catch {
      /* fall through to raw */
    }
  }
  return s
}
