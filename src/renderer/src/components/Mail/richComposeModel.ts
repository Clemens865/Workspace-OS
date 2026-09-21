import type { EmailBlock, EmailThemeId } from '../../types/workspace-api'

/**
 * Pure, React-free model for the rich-compose surface — the block list a message
 * is assembled from and the helpers that keep it coherent. Kept out of the .tsx
 * so it is unit-testable without a DOM.
 *
 * The body the user types is always block[0] (a `text` block); inserted blocks
 * (metric callouts, tables, CTA, hosted-link) follow it in order. `assembleBlocks`
 * produces the exact list handed to `richBuild` for a chosen theme.
 */

export interface RichComposeState {
  themeId: EmailThemeId
  /** The main typed body. */
  body: string
  /** Inserted structured blocks, in order (after the body). */
  extras: EmailBlock[]
}

export const THEME_IDS: readonly EmailThemeId[] = ['clean', 'editorial', 'compact'] as const

export function initialRichState(body = ''): RichComposeState {
  return { themeId: 'clean', body, extras: [] }
}

/**
 * The block list for `richBuild`: the typed body as block[0] (omitted when
 * empty), then the inserted extras. Deterministic and side-effect free.
 */
export function assembleBlocks(state: RichComposeState): EmailBlock[] {
  const blocks: EmailBlock[] = []
  if (state.body.trim()) blocks.push({ kind: 'text', text: state.body })
  for (const b of state.extras) blocks.push(b)
  return blocks
}

/** Append an inserted block (bounded so the message can't balloon). */
export function addExtra(state: RichComposeState, block: EmailBlock): RichComposeState {
  if (state.extras.length >= 30) return state
  return { ...state, extras: [...state.extras, block] }
}

/** Remove an inserted block by index. */
export function removeExtra(state: RichComposeState, index: number): RichComposeState {
  return { ...state, extras: state.extras.filter((_, i) => i !== index) }
}

/**
 * Move an inserted block to a new position — the drag-and-drop of the block
 * list, kept pure so reordering is testable without a DOM. Out-of-range or
 * no-op moves return the state unchanged (a bad drop must never lose a block).
 */
export function moveExtra(state: RichComposeState, from: number, to: number): RichComposeState {
  const n = state.extras.length
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return state
  const extras = [...state.extras]
  const [moved] = extras.splice(from, 1)
  extras.splice(to, 0, moved)
  return { ...state, extras }
}

/** Replace an inserted block in place — inline editing of a block's content. */
export function updateExtra(state: RichComposeState, index: number, block: EmailBlock): RichComposeState {
  if (index < 0 || index >= state.extras.length) return state
  return { ...state, extras: state.extras.map((b, i) => (i === index ? block : b)) }
}

/**
 * Whether a block has anything a person can usefully edit inline.
 *
 * Live tables ride a token and re-resolve at send; a hosted link's target is
 * an app deep-link — editing either by hand would only break them. Everything
 * with human-written words (text, button, chart title, metric label) is fair
 * game.
 */
export function editableKind(block: EmailBlock): boolean {
  return (
    block.kind === 'text' ||
    block.kind === 'heading' ||
    block.kind === 'cta' ||
    block.kind === 'chart' ||
    block.kind === 'metric' ||
    block.kind === 'image'
  )
}

/**
 * The inline-image attachments a block list implies at SEND time.
 *
 * The built html references each image as `cid:<cid>`; these attachments are
 * what those references resolve to in the recipient's client — the one image
 * mechanism Gmail/Outlook reliably render (data: URIs are stripped).
 */
export function inlineImageAttachments(
  blocks: EmailBlock[],
): { filename: string; contentType: string; content: string; cid: string }[] {
  const out: { filename: string; contentType: string; content: string; cid: string }[] = []
  for (const b of blocks) {
    if (b.kind !== 'image' || !b.cid || !b.data) continue
    out.push({
      filename: b.alt?.trim() || 'image',
      contentType: b.contentType || 'image/png',
      content: b.data,
      cid: b.cid,
    })
  }
  return out
}

/**
 * Make the LOCAL preview show the images the recipient will see.
 *
 * The built html references `cid:` (right for the wire, meaningless to an
 * iframe); the renderer holds the bytes, so the preview swaps each reference
 * for a data: URI. Send-time html keeps the cid: form untouched.
 */
export function substituteImageData(html: string, blocks: EmailBlock[]): string {
  let out = html
  for (const b of blocks) {
    if (b.kind !== 'image' || !b.cid || !b.data) continue
    out = out.split(`cid:${b.cid}`).join(`data:${b.contentType || 'image/png'};base64,${b.data}`)
  }
  return out
}

/** A short human label for an inserted block (for the "added blocks" chips). */
export function blockLabel(block: EmailBlock): string {
  switch (block.kind) {
    case 'text':
      return 'Text'
    case 'heading':
      return `Heading: ${block.text}`
    case 'divider':
      return 'Divider'
    case 'image':
      return `Image: ${block.alt || 'inline'}`
    case 'table':
      return `Table (${block.rows.length}×${block.rows[0]?.length ?? 0})`
    case 'metric':
      return `Metric: ${block.label || block.value}`
    case 'cta':
      return `Button: ${block.label}`
    case 'hosted-link':
      return `Open in Workspace-OS: ${block.label}`
    case 'chart':
      return `Chart: ${block.title || `${block.bars.length} bars`}`
    default:
      return 'Block'
  }
}

/** A ready-made CTA block from label + href (empty label → null, nothing added). */
export function ctaBlock(label: string, href: string): EmailBlock | null {
  const l = label.trim()
  if (!l) return null
  return { kind: 'cta', label: l, href: href.trim() || '#' }
}
