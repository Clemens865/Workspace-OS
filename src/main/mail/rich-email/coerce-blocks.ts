import type { EmailBlock } from './blocks'
import type { BuildRichEmailInput } from './compose-build'

/**
 * IPC-boundary coercion for the rich-compose surface: turn an untrusted renderer
 * payload into a validated theme id + block list. Every field is bounded/typed
 * here so the builder never sees a hostile value. Kept out of the handler to hold
 * handlers/mail.ts under the 500-line limit and to unit-test coercion directly.
 */

const MAX_BLOCKS = 40
const MAX_TABLE_ROWS = 50
const MAX_TABLE_COLS = 26
const MAX_CHART_BARS = 24

function asString(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

/** Coerce one structured block from the renderer into a validated EmailBlock. */
export function toBlock(raw: unknown): EmailBlock | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const kind = asString(o.kind, 16)
  if (kind === 'text') return { kind: 'text', text: asString(o.text, 20_000) }
  if (kind === 'heading') return { kind: 'heading', text: asString(o.text, 300) }
  if (kind === 'divider') return { kind: 'divider' }
  if (kind === 'image') {
    // ONLY the reference crosses this boundary. The renderer keeps the bytes
    // (data: for its preview, an inline CID attachment at send) — a build that
    // runs per keystroke must not carry megabytes it never reads.
    const cid = asString(o.cid, 120).replace(/[^a-zA-Z0-9._-]/g, '')
    if (!cid) return null
    return { kind: 'image', cid, alt: asString(o.alt, 300) }
  }
  if (kind === 'metric') {
    return { kind: 'metric', label: asString(o.label, 200), value: asString(o.value, 200) }
  }
  if (kind === 'cta') return { kind: 'cta', label: asString(o.label, 200), href: asString(o.href, 2000) }
  if (kind === 'hosted-link') {
    return { kind: 'hosted-link', label: asString(o.label, 200), target: asString(o.target, 200) }
  }
  if (kind === 'chart') {
    if (!Array.isArray(o.bars)) return null
    const bars = o.bars
      .slice(0, MAX_CHART_BARS)
      .map((b) => {
        const r = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>
        // A model will happily send "1,240" or "€1.2M"; keep the human form for
        // display and parse a number for the bar, rather than dropping the bar.
        const value = typeof r.value === 'number' ? r.value : Number(String(r.value ?? '').replace(/[^0-9.\-]/g, ''))
        return {
          label: asString(r.label, 120),
          value: Number.isFinite(value) ? value : 0,
          display: asString(r.display, 60) || undefined,
        }
      })
      .filter((b) => b.label !== '' || b.value !== 0)
    if (bars.length === 0) return null
    return { kind: 'chart', title: asString(o.title, 120) || undefined, bars }
  }
  if (kind === 'table') {
    if (!Array.isArray(o.rows)) return null
    const rows = o.rows.slice(0, MAX_TABLE_ROWS).map((r) =>
      Array.isArray(r) ? r.slice(0, MAX_TABLE_COLS).map((c) => asString(c, 500)) : [],
    )
    return { kind: 'table', rows }
  }
  return null
}

/** Coerce a renderer block-list payload into a validated BuildRichEmailInput. */
export function toBuildInput(raw: unknown): BuildRichEmailInput {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const themeId = asString(o.themeId, 32)
  const rawBlocks = Array.isArray(o.blocks) ? o.blocks.slice(0, MAX_BLOCKS) : []
  const blocks: EmailBlock[] = []
  for (const b of rawBlocks) {
    const block = toBlock(b)
    if (block) blocks.push(block)
  }
  return { themeId: (themeId as BuildRichEmailInput['themeId']) || undefined, blocks }
}
