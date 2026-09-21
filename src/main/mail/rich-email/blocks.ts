import type { EmailTheme } from './themes'

/**
 * Structured, drop-in blocks for the everyday rich email — the pieces that make a
 * 1:1 message "richer than a plain-text box": a paragraph, a clean table, a live
 * metric callout, and a CTA button. Each block renders to a small MJML fragment
 * (validated tags only), assembled by compose-build.ts into one message.
 *
 * HONESTY on "interactive": email clients strip JavaScript, so nothing here is
 * truly interactive in-client. What IS reliable — and all we emit — is:
 *   - real links / buttons (mj-button → <a href>) the recipient can click,
 *   - structured layout (mj-table, callouts) rendered by the client,
 *   - live-data values baked in at SEND (see email-tokens.ts).
 * The `hosted-link` block is a button whose href points back into Workspace-OS
 * for anything richer than a link (e.g. "open the live dashboard"); the hosted
 * ENDPOINT is deferred (stubbed) — we never pretend the email itself is live.
 */

/** A block the user assembled in compose. Discriminated by `kind`. */
export type EmailBlock =
  | { kind: 'text'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'divider' }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'metric'; label: string; value: string }
  | { kind: 'cta'; label: string; href: string }
  | { kind: 'hosted-link'; label: string; target: string }
  /**
   * A horizontal bar chart. `value` is the number the bar encodes; `display` is
   * what the reader sees beside it (so "1.2M" can label a bar of 1200000).
   */
  | { kind: 'chart'; title?: string; bars: { label: string; value: number; display?: string }[] }
  /**
   * An inline image. The html references `cid:<cid>` — the ONE image mechanism
   * mainstream clients reliably render (a `data:` URI is stripped by Gmail and
   * Outlook, see chartBlock). The bytes themselves never ride this type on the
   * build path: the renderer keeps them, substitutes a data: URI into its local
   * preview, and attaches them as an inline CID attachment at send. So the
   * per-keystroke preview build moves a 60-char reference, not megabytes.
   */
  | { kind: 'image'; cid: string; alt: string }

/**
 * The colour a negative bar is drawn in.
 *
 * Fixed rather than themed: a theme's accent is chosen to look good, and a
 * decline needs to read as a decline in every theme. Dark enough to hold its
 * own against white in a client that strips background colours to greyscale.
 */
const NEGATIVE_BAR = '#C2410C'

/** Where a hosted-link button points until the hosted endpoint ships. */
const HOSTED_PLACEHOLDER = 'https://workspace-os.local/open'

/** MJML-attribute-safe: strips the delimiters that would break an attribute. */
function attr(s: string): string {
  return String(s ?? '').replace(/["\r\n<>]/g, ' ').slice(0, 400)
}

/** Escapes text destined for MJML/HTML content (mj-text renders raw HTML). */
export function escapeContent(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * A bare host, the way people actually type a link: `www.example.com`,
 * `example.com`, `example.co.uk/pricing`.
 *
 * Requires at least one dot and a plausible TLD, and — the part that matters —
 * forbids a colon anywhere before the first slash. Without that, `javascript:`
 * and `data:` would look like "a bare host with a colon in it" and get https://
 * bolted on the front, turning a rejected scheme into an accepted link.
 */
const BARE_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}(?:[/?#][^\s]*)?$/i

/**
 * Only http(s) and mailto links are allowed on a CTA — never javascript:/data:
 * or anything else a client might mishandle. Returns a safe href or '#'.
 *
 * A bare host is upgraded to https rather than rejected: people type
 * `www.example.com`, and a button that silently became a dead `#` because the
 * scheme was missing is a worse answer than assuming the web's default. https
 * and not http, because guessing the insecure one on someone's behalf is not a
 * default worth having in 2026.
 */
export function safeHref(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (/^https?:\/\//i.test(s)) return attr(s)
  if (/^mailto:/i.test(s)) return attr(s)
  // Protocol-relative: the author already meant "same scheme as the page", and
  // in an email there is no page, so https is the only sane reading.
  if (s.startsWith('//') && BARE_HOST.test(s.slice(2))) return attr(`https:${s}`)
  if (BARE_HOST.test(s)) return attr(`https://${s}`)
  return '#'
}

/** One text paragraph. Newlines become <br> so plain typing keeps its breaks. */
function textBlock(text: string): string {
  const html = escapeContent(text).replace(/\n/g, '<br />')
  return `<mj-text>${html}</mj-text>`
}

/** A section heading — one size, bold, breathing room above. */
function headingBlock(text: string): string {
  return `<mj-text font-size="20px" font-weight="700" padding="14px 0 4px">${escapeContent(text)}</mj-text>`
}

/** A quiet horizontal rule between sections. */
function dividerBlock(): string {
  return '<mj-divider border-width="1px" border-color="#e3e6ec" padding="12px 0" />'
}

/** Content-ID-safe: the token also rides inside `src="cid:…"`. */
function safeCid(raw: string): string {
  return String(raw ?? '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 120)
}

/** An inline image by Content-ID; the attachment itself is added at send. */
function imageBlock(cid: string, alt: string): string {
  const id = safeCid(cid)
  if (!id) return ''
  return `<mj-image src="cid:${id}" alt="${attr(alt)}" align="left" padding="8px 0" />`
}

/**
 * A clean table. First row is treated as a header (bold, accent underline). Cells
 * are escaped. A ragged row is padded to the widest so the grid stays rectangular.
 */
function tableBlock(rows: string[][], theme: EmailTheme): string {
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0)
  if (width === 0) return ''
  const tr = rows.map((row, i) => {
    const cells = Array.from({ length: width }, (_, c) => escapeContent(row[c] ?? ''))
    if (i === 0) {
      const th = cells
        .map(
          (cell) =>
            `<th align="left" style="padding:8px 10px;border-bottom:2px solid ${theme.accent};font-weight:700">${cell}</th>`,
        )
        .join('')
      return `<tr>${th}</tr>`
    }
    const td = cells
      .map(
        (cell) =>
          `<td style="padding:8px 10px;border-bottom:1px solid #e3e6ec">${cell}</td>`,
      )
      .join('')
    return `<tr>${td}</tr>`
  })
  return `<mj-table cellpadding="0" cellspacing="0" font-size="${theme.fontSize}">${tr.join('')}</mj-table>`
}

/**
 * A metric callout — a big number with a caption, in an accent-bordered card.
 * The accent border lives on an inner styled <div> (mj-text renders raw HTML), so
 * we never pass a non-standard attribute like `border-left` to mj-text itself.
 */
function metricBlock(label: string, value: string, theme: EmailTheme): string {
  const l = escapeContent(label)
  const v = escapeContent(value)
  return [
    `<mj-text padding="6px 0">`,
    `<div style="border-left:3px solid ${theme.accent};padding:12px 16px;background:#ffffff">`,
    `<span style="display:block;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#71767f">${l}</span>`,
    `<span style="display:block;font-size:26px;font-weight:700;color:${theme.text};line-height:1.2;margin-top:2px">${v}</span>`,
    `</div>`,
    `</mj-text>`,
  ].join('')
}

/** A CTA button → a real <a href>. The only reliably clickable interactivity. */
function ctaBlock(label: string, href: string): string {
  return `<mj-button href="${safeHref(href)}" align="left">${escapeContent(label)}</mj-button>`
}

/**
 * A "hosted-link" button — points back into Workspace-OS for anything richer than
 * a plain link. The endpoint is DEFERRED; today it renders a normal button to a
 * placeholder host, plus a caption stating it opens Workspace-OS. Not pretending
 * the email is interactive: it is a link, honestly labelled.
 */
function hostedLinkBlock(label: string, target: string): string {
  const href = `${HOSTED_PLACEHOLDER}?target=${encodeURIComponent(String(target ?? '').slice(0, 200))}`
  return [
    `<mj-button href="${attr(href)}" align="left">${escapeContent(label)}</mj-button>`,
    `<mj-text align="left" font-size="12px" color="#71767f" padding-top="0">Opens in Workspace-OS</mj-text>`,
  ].join('')
}

/**
 * A horizontal bar chart drawn with table cells — no image, on purpose.
 *
 * The obvious implementation is to render a PNG and embed it, and it is the
 * wrong one. A `data:` URI in `<img>` is stripped or blocked by Gmail and
 * Outlook, so the chart would vanish for most recipients; a `cid:` attachment
 * survives but still disappears behind "remote content blocked" in clients that
 * treat inline images that way, and it makes every message carry a binary.
 *
 * A bar built from a background-coloured cell with a percentage width has none
 * of those problems: it is layout, not content, so it renders wherever the
 * table does — which is everywhere. It also degrades honestly, becoming a plain
 * label/value list rather than a broken-image icon.
 *
 * Bars are scaled against the largest MAGNITUDE so a set containing negatives
 * still produces comparable widths, and each bar carries its own value as text
 * so the chart is readable even if the colour is stripped.
 */
function chartBlock(
  title: string | undefined,
  bars: { label: string; value: number; display?: string }[],
  theme: EmailTheme,
): string {
  const usable = bars.filter((b) => Number.isFinite(b.value))
  if (usable.length === 0) return ''
  const peak = usable.reduce((m, b) => Math.max(m, Math.abs(b.value)), 0)

  const rows = usable.map((b) => {
    // A zero peak (every value 0) would divide by zero; show empty bars instead.
    const pct = peak > 0 ? Math.max(1, Math.round((Math.abs(b.value) / peak) * 100)) : 0
    const label = escapeContent(b.label ?? '')
    const shown = escapeContent(b.display ?? String(b.value))
    /**
     * A negative bar must not look like a positive one.
     *
     * Scaling on magnitude is right — it keeps the bars comparable — but it also
     * means -11.9 and +11.9 draw identically. A real "change by quarter" chart
     * came out with a decline rendered as growth in the accent colour, its own
     * label reading "-11.9%" beside it. A chart whose bars contradict their
     * labels is worse than no chart.
     *
     * So negatives get their own colour and sit on the other side of the track:
     * the bar grows leftward from the centre while positives grow rightward,
     * which is the shape people already read as up-and-down. Both are still
     * plain table cells, so this costs nothing in client support.
     */
    const negative = b.value < 0
    const track = negative
      ? [
          `<td style="width:${100 - pct}%;font-size:0;line-height:14px">&nbsp;</td>`,
          `<td style="width:${pct}%;background:${NEGATIVE_BAR};height:14px;border-radius:3px;font-size:0;line-height:14px">&nbsp;</td>`,
        ]
      : [
          `<td style="width:${pct}%;background:${theme.accent};height:14px;border-radius:3px;font-size:0;line-height:14px">&nbsp;</td>`,
          `<td style="width:${100 - pct}%;font-size:0;line-height:14px">&nbsp;</td>`,
        ]
    return [
      '<tr>',
      `<td style="padding:5px 10px 5px 0;font-size:${theme.fontSize};color:${theme.text};white-space:nowrap">${label}</td>`,
      '<td style="padding:5px 0;width:100%">',
      // The inner table is what actually draws the bar: one filled cell at N%.
      '<table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">',
      '<tr>',
      ...track,
      '</tr></table>',
      '</td>',
      `<td style="padding:5px 0 5px 10px;font-size:${theme.fontSize};color:${negative ? NEGATIVE_BAR : theme.text};font-weight:700;white-space:nowrap;text-align:right">${shown}</td>`,
      '</tr>',
    ].join('')
  })

  const heading = title?.trim()
    ? `<tr><td colspan="3" style="padding:0 0 8px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#71767f">${escapeContent(title)}</td></tr>`
    : ''

  return [
    '<mj-text padding="6px 0">',
    '<table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">',
    heading,
    rows.join(''),
    '</table>',
    '</mj-text>',
  ].join('')
}

/** Render one block to MJML. Unknown/empty blocks render to ''. Never throws. */
export function renderBlock(block: EmailBlock, theme: EmailTheme): string {
  switch (block?.kind) {
    case 'text':
      return block.text?.trim() ? textBlock(block.text) : ''
    case 'heading':
      return block.text?.trim() ? headingBlock(block.text) : ''
    case 'divider':
      return dividerBlock()
    case 'image':
      return imageBlock(block.cid ?? '', block.alt ?? '')
    case 'table':
      return Array.isArray(block.rows) && block.rows.length ? tableBlock(block.rows, theme) : ''
    case 'metric':
      return metricBlock(block.label ?? '', block.value ?? '', theme)
    case 'cta':
      return block.label?.trim() ? ctaBlock(block.label, block.href ?? '#') : ''
    case 'hosted-link':
      return block.label?.trim() ? hostedLinkBlock(block.label, block.target ?? '') : ''
    case 'chart':
      return Array.isArray(block.bars) && block.bars.length ? chartBlock(block.title, block.bars, theme) : ''
    default:
      return ''
  }
}
