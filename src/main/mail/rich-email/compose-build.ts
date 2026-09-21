import { compileMjml, type MjmlError } from './mjml-compile'
import { resolveLiveTokens, type MetricLookup, type UnresolvedToken } from './email-tokens'
import { renderBlock, escapeContent, type EmailBlock } from './blocks'
import {
  resolveTheme,
  themeHead,
  themeBodyBackground,
  brandTheme,
  type ThemeId,
  type BrandThemeSource,
} from './themes'

/**
 * The rich-compose builder — turns the compose surface (a chosen theme + an
 * ordered list of structured blocks) into a responsive, email-client-safe HTML
 * message plus a plain-text fallback, with live `{{metric:<id>}}` tokens resolved
 * true at build time.
 *
 * This is the everyday-email counterpart of the office transclusion path: the
 * numbers in a normal 1:1 email are the same single-source-of-truth values that
 * flow into the documents — resolved at SEND, fail-safe (unknown → visible
 * placeholder + reported, never blank). NEVER sends: the caller previews, then
 * reuses the proven MAIL_SEND path with `html` + `text` set.
 */

/** A minimal range read surface — satisfied by RangeStore. */
export interface RangeLookup {
  get(id: string): { name: string; values: (number | string | null)[][] } | undefined
}

export interface BuildRichEmailInput {
  /** The chosen design theme (unknown → the default). */
  themeId?: ThemeId
  /** Ordered structured blocks the user assembled in compose. */
  blocks: EmailBlock[]
  /**
   * The user's Brand kit (palette + fonts). Passed by the handler when a brand
   * is set; used ONLY when `themeId === 'brand'` to derive the theme from it.
   * When absent, the 'brand' theme falls back to the default built-in theme.
   */
  brand?: BrandThemeSource
}

export interface BuiltRichEmail {
  /** The token-resolved MJML source (useful for debugging/preview). */
  mjml: string
  /** Compiled responsive HTML — set as the message `html` part. */
  html: string
  /** A plain-text rendering of the same content — the `text` fallback part. */
  text: string
  /** MJML compile/validation problems (empty = clean). */
  errors: MjmlError[]
  /** Liveness tokens left as visible placeholders (unknown/unreadable). */
  unresolvedTokens: UnresolvedToken[]
}

const MAX_BLOCKS = 40

/**
 * Assemble → resolve tokens → compile. Pure orchestration over injected metrics
 * (so it is unit-testable with a fake lookup). Returns everything, incl. errors
 * and unresolved tokens; the caller decides whether to send.
 */
export async function buildRichEmail(
  input: BuildRichEmailInput,
  metrics: MetricLookup,
): Promise<BuiltRichEmail> {
  const theme =
    input.themeId === 'brand' && input.brand ? brandTheme(input.brand) : resolveTheme(input.themeId)
  const blocks = Array.isArray(input.blocks) ? input.blocks.slice(0, MAX_BLOCKS) : []

  const body = blocks.map((b) => renderBlock(b, theme)).filter(Boolean).join('\n        ')
  const rawMjml = [
    '<mjml>',
    themeHead(theme),
    `  <mj-body background-color="${themeBodyBackground(theme)}">`,
    '    <mj-section padding="24px 0">',
    '      <mj-column background-color="#ffffff" border-radius="10px" padding="8px 8px">',
    `        ${body || '<mj-text> </mj-text>'}`,
    '      </mj-column>',
    '    </mj-section>',
    '  </mj-body>',
    '</mjml>',
  ].join('\n')

  // Resolve liveness tokens BEFORE compile so the numbers ride the wire true.
  const resolved = resolveLiveTokens(rawMjml, metrics)
  const compiled = await compileMjml(resolved.text)

  return {
    mjml: resolved.text,
    html: compiled.html,
    text: blocksToPlainText(blocks, metrics),
    errors: compiled.errors,
    unresolvedTokens: resolved.unresolved,
  }
}

/**
 * A plain-text rendering of the same blocks — the multipart `text/plain` fallback
 * for clients that don't render HTML. Tokens are resolved here too so the plain
 * part is also live and true (its unresolved reporting is folded into the HTML
 * path's, so we don't double-report).
 */
export function blocksToPlainText(blocks: EmailBlock[], metrics: MetricLookup): string {
  const parts: string[] = []
  for (const b of Array.isArray(blocks) ? blocks : []) {
    switch (b?.kind) {
      case 'text':
        if (b.text?.trim()) parts.push(b.text.trim())
        break
      case 'heading':
        if (b.text?.trim()) parts.push(b.text.trim())
        break
      case 'divider':
        parts.push('———')
        break
      case 'image':
        if (b.alt?.trim()) parts.push(`[image: ${b.alt.trim()}]`)
        break
      case 'table':
        if (Array.isArray(b.rows)) {
          parts.push(b.rows.map((r) => (Array.isArray(r) ? r.join('\t') : '')).join('\n'))
        }
        break
      case 'metric':
        parts.push(`${b.label ?? ''}: ${b.value ?? ''}`.trim())
        break
      case 'cta':
        if (b.label?.trim()) parts.push(`${b.label} — ${b.href ?? ''}`.trim())
        break
      case 'hosted-link':
        if (b.label?.trim()) parts.push(`${b.label} (opens in Workspace-OS)`)
        break
      default:
        break
    }
  }
  const joined = parts.join('\n\n')
  return resolveLiveTokens(joined, metrics).text
}

/**
 * "Insert live data" — turn a metric id into a metric-callout block whose value
 * is a live `{{metric:<id>}}` token (resolved true at send). Unknown id → the
 * token still renders and resolves to a visible placeholder (fail-safe). Pure.
 */
export function metricInsertBlock(id: string, metrics: MetricLookup): EmailBlock {
  const m = metrics.get(id)
  return {
    kind: 'metric',
    label: m ? metricLabel(id, metrics) : id,
    value: `{{metric:${id}}}`,
  }
}

/** A metric's display label, if the lookup exposes one; else the id. */
function metricLabel(id: string, metrics: MetricLookup): string {
  const m = metrics.get(id) as { name?: string } | undefined
  return m?.name && typeof m.name === 'string' ? m.name : id
}

/**
 * "Insert live data" — turn a range id into a live table block. The grid VALUES
 * are read now (a snapshot baked into the block); the range is the single source
 * that a re-sent message would re-read. Unknown id → a one-cell placeholder table
 * (visible, never blank). Cells are stringified for display.
 */
export function rangeInsertBlock(id: string, ranges: RangeLookup): EmailBlock {
  const r = ranges.get(id)
  if (!r || !Array.isArray(r.values) || r.values.length === 0) {
    return { kind: 'table', rows: [[`[range ${escapeContent(id)} unavailable]`]] }
  }
  const rows = r.values.map((row) =>
    (Array.isArray(row) ? row : []).map((cell) => (cell === null || cell === undefined ? '' : String(cell))),
  )
  return { kind: 'table', rows }
}
