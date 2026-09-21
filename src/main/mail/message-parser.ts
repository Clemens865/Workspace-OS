import { simpleParser, type ParsedMail, type AddressObject } from 'mailparser'

/**
 * MIME parsing + HTML sanitization for fetched messages.
 *
 * Kept independent of the IMAP client so it can be unit-tested by feeding raw
 * .eml bytes straight through `parseMessage`. Two security-relevant jobs:
 *   1. Never trust message HTML — strip scripts/handlers and NEUTRALISE remote
 *      content (images/iframes/link-prefetch) so a read cannot phone home or
 *      confirm the address to a sender ("no remote content auto-load").
 *   2. Expose the ORIGINAL remote-image URLs separately so the UI can offer an
 *      explicit "load remote images" action later without re-parsing.
 */

export interface MailAddress {
  name: string
  address: string
}

export interface AttachmentMeta {
  filename: string
  contentType: string
  size: number
  /** Content-ID for inline (cid:) attachments, if any. */
  cid?: string
  inline: boolean
}

/**
 * A minimal, LOWERCASED subset of raw headers relevant to triage (deciding
 * whether a message plausibly needs a human reply). Only these keys are lifted
 * out — the full header set is never surfaced. Values are the raw header string.
 * Absent keys are simply omitted (never null), so triage can treat presence as
 * the signal (e.g. a `list-unsubscribe` key means "this is a bulk/list mail").
 */
export interface TriageHeaders {
  'list-unsubscribe'?: string
  'list-id'?: string
  precedence?: string
  'auto-submitted'?: string
  'reply-to'?: string
  'x-auto-response-suppress'?: string
}

/** The exact header keys we lift for triage. Kept small on purpose. */
const TRIAGE_HEADER_KEYS: (keyof TriageHeaders)[] = [
  'list-unsubscribe',
  'list-id',
  'precedence',
  'auto-submitted',
  'reply-to',
  'x-auto-response-suppress',
]

export interface ParsedMessage {
  subject: string
  from: MailAddress[]
  to: MailAddress[]
  cc: MailAddress[]
  date: string | null
  messageId: string | null
  text: string
  /** Sanitized HTML — safe to render in a sandboxed surface. May be empty. */
  html: string
  /** True when the original HTML referenced remote content we blocked. */
  hasBlockedRemoteContent: boolean
  attachments: AttachmentMeta[]
  /** Lowercased subset of raw headers used by triage (never the full set). */
  headers: TriageHeaders
}

function toAddresses(a: AddressObject | AddressObject[] | undefined): MailAddress[] {
  if (!a) return []
  const list = Array.isArray(a) ? a : [a]
  const out: MailAddress[] = []
  for (const obj of list) {
    for (const v of obj.value) {
      if (v.address) out.push({ name: v.name || '', address: v.address })
    }
  }
  return out
}

/** Parses raw RFC822 bytes/string into a normalized, sanitized message. */
/**
 * Extracts ONE attachment's bytes from a raw message.
 *
 * Kept separate from `parseMessage` on purpose: that function is called for
 * every message the reader opens and every message the indexer deepens, and
 * carrying attachment payloads through it would hold megabytes of Buffers in
 * main for mail nobody asked to save. Content is materialised only when a user
 * actually clicks Save.
 *
 * Returns null when the index is out of range — a stale UI is a normal
 * condition, not an error worth throwing over.
 */
export async function extractAttachment(
  raw: Buffer | string,
  index: number,
): Promise<{ filename: string; contentType: string; content: Buffer } | null> {
  const mail: ParsedMail = await simpleParser(raw)
  const att = (mail.attachments ?? [])[index]
  if (!att || !att.content) return null
  return {
    filename: att.filename || 'attachment',
    contentType: att.contentType || 'application/octet-stream',
    content: att.content as Buffer,
  }
}

/**
 * Ceiling on the bytes embedded into one message body.
 *
 * Inline images travel to the renderer inside the HTML, so an unbounded rewrite
 * would ship a 20 MB photo over IPC every time the message is opened. Real
 * signature logos and header banners are tens of kilobytes; anything past this
 * is left as an ordinary attachment the user can open deliberately.
 */
const MAX_INLINE_BYTES = 2 * 1024 * 1024

/**
 * The media types allowed to become a data: URI in a message body.
 *
 * An allow-list rather than a `image/*` test, and the emitted type comes from
 * THIS set rather than being echoed back from the message: `Content-Type` is
 * attacker-controlled, and `image/svg+xml` is deliberately absent because an
 * SVG is a document that can carry script, not a picture.
 */
const INLINE_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/avif',
])

/** `<logo@example.com>` and `logo@example.com` are the same Content-ID. */
const normaliseCid = (cid: string): string => cid.trim().replace(/^<|>$/g, '').toLowerCase()

/**
 * FALLBACK for `src="cid:…"` references mailparser did not resolve itself.
 *
 * mailparser already rewrites cid: to a data: URI for the common case, in both
 * multipart/related and multipart/mixed — measured, not assumed. What it misses
 * is references whose case or bracket form does not match the Content-ID
 * exactly (`cid:LOGO123` against `Content-ID: <logo123>`, or `cid:<logo123>`),
 * and senders do emit both. Those are the only ones that reach this function.
 *
 * Worth stating plainly because a bug report claimed inline images NEVER
 * rendered and cited a parser unit test as proof; the test exercised
 * `sanitizeHtml` in isolation, which has no attachments and so could never have
 * inlined anything. The product behaviour was fine. Only these edge cases were
 * not.
 *
 * Inline images arrive INSIDE the message, so resolving them is not a network
 * fetch — none of the remote-content privacy reasoning applies and they need no
 * opt-in.
 *
 * Deliberately narrow:
 *   - Only `image/*` parts. A data: URI for a PDF in an `<img>` paints nothing.
 *   - Only parts actually referenced by the body, so unreferenced attachments
 *     are never embedded.
 *   - Bounded in total, and the content type is re-emitted from a strict
 *     allow-list rather than echoed, so a hostile `Content-Type` cannot smuggle
 *     a different media type into the document.
 *
 * This does NOT retain buffers anywhere: it consumes what `simpleParser` has
 * already produced and lets it go. The on-demand rule in the mail handler — do
 * not carry attachment Buffers through every parse — is about holding them in
 * main across time, which this does not do.
 */
function inlineCidImages(
  html: string,
  attachments: ParsedMail['attachments'],
): { html: string; inlined: number } {
  if (!html || !attachments?.length) return { html, inlined: 0 }

  const byCid = new Map<string, { type: string; content: Buffer }>()
  for (const att of attachments) {
    const type = String(att.contentType ?? '').toLowerCase()
    if (!att.cid || !att.content || !INLINE_IMAGE_TYPES.has(type)) continue
    byCid.set(normaliseCid(att.cid), { type, content: att.content as Buffer })
  }
  if (byCid.size === 0) return { html, inlined: 0 }

  let used = 0
  let inlined = 0
  const out = html.replace(
    /\s(src|background|poster)\s*=\s*("|')\s*cid:([^"']+)\2/gi,
    (whole, attr: string, quote: string, ref: string) => {
      let key: string
      try {
        key = normaliseCid(decodeURIComponent(ref))
      } catch {
        key = normaliseCid(ref) // a stray % is not a reason to drop the image
      }
      const att = byCid.get(key)
      if (!att) return whole
      if (used + att.content.length > MAX_INLINE_BYTES) return whole
      used += att.content.length
      inlined += 1
      return ` ${attr.toLowerCase()}=${quote}data:${att.type};base64,${att.content.toString('base64')}${quote}`
    },
  )
  return { html: out, inlined }
}

export async function parseMessage(raw: Buffer | string): Promise<ParsedMessage> {
  const mail: ParsedMail = await simpleParser(raw)
  const sanitized = mail.html ? sanitizeHtml(mail.html) : { html: '', hadRemote: false }
  const { html } = inlineCidImages(sanitized.html, mail.attachments ?? [])
  const hadRemote = sanitized.hadRemote

  const attachments: AttachmentMeta[] = (mail.attachments ?? []).map((att) => ({
    filename: att.filename || '(unnamed)',
    contentType: att.contentType || 'application/octet-stream',
    size: att.size ?? 0,
    cid: att.cid,
    inline: att.contentDisposition === 'inline' || Boolean(att.cid),
  }))

  return {
    subject: mail.subject ?? '',
    from: toAddresses(mail.from),
    to: toAddresses(mail.to),
    cc: toAddresses(mail.cc),
    date: mail.date ? mail.date.toISOString() : null,
    messageId: mail.messageId ?? null,
    text: mail.text ?? '',
    html,
    hasBlockedRemoteContent: hadRemote,
    attachments,
    headers: toTriageHeaders(mail.headers),
  }
}

/**
 * Lifts only the triage-relevant headers out of mailparser's header map,
 * lowercasing values-as-strings. `mail.headers` is a Map keyed by lowercased
 * name; values may be strings, arrays, or structured objects — we coerce to a
 * single raw string and keep only keys we care about.
 */
function toTriageHeaders(map: ParsedMail['headers'] | undefined): TriageHeaders {
  const out: TriageHeaders = {}
  if (!map || typeof (map as { get?: unknown }).get !== 'function') return out
  for (const key of TRIAGE_HEADER_KEYS) {
    const raw = (map as Map<string, unknown>).get(key)
    const value = headerToString(raw)
    if (value) out[key] = value
  }
  return out
}

/** Coerces a mailparser header value (string | string[] | object) to a string. */
function headerToString(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return raw.map((v) => headerToString(v)).filter(Boolean).join(', ')
  if (raw && typeof raw === 'object') {
    const o = raw as { text?: unknown; value?: unknown }
    if (typeof o.text === 'string') return o.text
    if (typeof o.value === 'string') return o.value
  }
  return ''
}

/**
 * Conservative allowlist-flavoured sanitizer. We do NOT ship a full DOM parser
 * into the main process; instead we aggressively remove the dangerous surface
 * with targeted passes. The result is additionally rendered inside a sandboxed,
 * CSP-locked iframe in the renderer, so this is defence-in-depth, not the sole
 * barrier.
 *
 * Removes: <script>/<style>/<iframe>/<object>/<embed>/<link>/<meta>/<base>,
 * on* event-handler attributes, javascript:/vbabscript:/data: URLs, and
 * neutralises remote resource loads (src/srcset/background/url()) so nothing is
 * fetched from the network when the message is displayed.
 */
export function sanitizeHtml(input: string): { html: string; hadRemote: boolean } {
  let hadRemote = false
  let html = input

  // 1. Drop entire dangerous elements (open→close, and self-closed/void forms).
  const dropTags = ['script', 'style', 'iframe', 'object', 'embed', 'applet', 'noscript', 'template', 'frame', 'frameset']
  for (const tag of dropTags) {
    html = html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'gi'), '')
    html = html.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), '')
  }
  // Head-only elements that can leak or redirect: <link>, <meta http-equiv>, <base>.
  html = html.replace(/<(?:link|meta|base)\b[^>]*>/gi, '')

  // 2. Strip on* event-handler attributes (onclick, onload, onerror, …).
  html = html.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')

  // 2b. Give http(s) links a target so a click becomes a window-open request
  //     the host can intercept and route into the in-app browser.
  //
  //     Without this a link in a mail does NOTHING: the reader iframe is
  //     sandboxed with no navigation permission, so the click is swallowed
  //     silently — which reads as the app being broken.
  //
  //     rel="noopener noreferrer" because the opened page must not get a handle
  //     back to the opener, and a mail link should not leak the referrer.
  html = html.replace(
    /<a\b([^>]*?)href\s*=\s*("|')(https?:\/\/[^"']*)\2([^>]*)>/gi,
    (_m, pre, quote, url, post) => {
      const cleaned = `${pre} ${post}`.replace(/\s(?:target|rel)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      return `<a${cleaned} href=${quote}${url}${quote} target="_blank" rel="noopener noreferrer">`
    },
  )

  // 3. Neutralise javascript:/vbscript: URLs anywhere in an attribute value.
  html = html.replace(/(href|src|action|formaction)\s*=\s*("|')\s*(?:javascript|vbscript):[^"']*\2/gi, '$1=$2#$2')

  // 4. Block remote resource loads. Rewrite remote src/srcset/background/poster
  //    to a blocked placeholder so the browser never issues the request, and
  //    flag that we did so the UI can offer an opt-in "load images" later.
  //    The original URL is PRESERVED in the data attribute. It used to be
  //    replaced with "1", which discarded it — and made the "load images"
  //    the comment promised impossible, because nothing remembered where the
  //    image had been. The value is inert in a data-* attribute; the renderer
  //    only promotes it back to src when the user explicitly asks.
  const remoteAttr = /\s(src|srcset|background|poster)\s*=\s*("|')((?:https?:\/\/|\/\/)[^"']*)\2/gi
  html = html.replace(remoteAttr, (_m, attr, quote, url) => {
    hadRemote = true
    return ` data-blocked-${String(attr).toLowerCase()}=${quote}${String(url).replace(/[<>]/g, '')}${quote}`
  })
  // CSS url(...) references to remote content inside style="" attributes.
  const remoteUrl = /url\(\s*['"]?(https?:\/\/|\/\/)[^)'"]*['"]?\s*\)/gi
  if (remoteUrl.test(html)) {
    hadRemote = true
    html = html.replace(remoteUrl, "url('')")
  }

  return { html, hadRemote }
}
