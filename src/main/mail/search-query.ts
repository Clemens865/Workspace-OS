/**
 * Search-query parsing — `from:ana budget has:attachment is:unread`.
 *
 * Pure: text in, structured filters out. No index, no SQL, no I/O, so the whole
 * grammar is verifiable against fixtures.
 *
 * The governing rule is that **an unrecognised operator searches literally**.
 * If someone types `foo:bar` and we silently drop it, their search quietly
 * returns the wrong set and they have no way to tell. Treating it as text at
 * worst finds nothing, which is a visible, correctable outcome. Same reasoning
 * as the FTS wildcard escaping: never silently change what was asked for.
 */

export interface ParsedQuery {
  /** Free text, joined — what goes to FTS. */
  text: string
  /** Sender substring (`from:`). */
  from?: string
  /** Recipient substring (`to:`). */
  to?: string
  /** Subject substring (`subject:`). */
  subject?: string
  /** Folder to restrict to (`in:`). */
  folder?: string
  /** true = unread only, false = read only (`is:unread` / `is:read`). */
  unread?: boolean
  /** true = flagged only (`is:flagged` / `is:starred`). */
  flagged?: boolean
  /** true = has attachments (`has:attachment`). */
  hasAttachment?: boolean
}

/** Operators we understand. Anything else stays free text, deliberately. */
const FIELD_OPS = new Set(['from', 'to', 'subject', 'in', 'folder'])
const IS_VALUES = new Set(['unread', 'read', 'flagged', 'starred', 'seen'])
const HAS_VALUES = new Set(['attachment', 'attachments', 'file'])

/**
 * Splits on whitespace but keeps "quoted phrases" together, so
 * `subject:"Q3 budget"` and `from:"Ana Meier"` work the way people expect.
 */
export function tokenize(input: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (const ch of input ?? '') {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current) out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current) out.push(current)
  return out
}

/** Parses a raw search box string into structured filters plus free text. */
export function parseQuery(input: string): ParsedQuery {
  const q: ParsedQuery = { text: '' }
  const words: string[] = []

  for (const token of tokenize(input)) {
    const colon = token.indexOf(':')
    // No colon, or a leading colon (":foo"), or a trailing one ("from:") —
    // none of those is a usable operator, so the token is just text.
    if (colon <= 0 || colon === token.length - 1) {
      words.push(token)
      continue
    }

    const key = token.slice(0, colon).toLowerCase()
    const value = token.slice(colon + 1)

    if (FIELD_OPS.has(key)) {
      if (key === 'from') q.from = value
      else if (key === 'to') q.to = value
      else if (key === 'subject') q.subject = value
      else q.folder = value
      continue
    }

    if (key === 'is' && IS_VALUES.has(value.toLowerCase())) {
      const v = value.toLowerCase()
      if (v === 'unread') q.unread = true
      else if (v === 'read' || v === 'seen') q.unread = false
      else q.flagged = true
      continue
    }

    if (key === 'has' && HAS_VALUES.has(value.toLowerCase())) {
      q.hasAttachment = true
      continue
    }

    // Unrecognised: keep the WHOLE token as text. A URL or a time ("14:30")
    // must survive intact, and a typo'd operator must not vanish.
    words.push(token)
  }

  q.text = words.join(' ')
  return q
}

/** True when the query asks for nothing at all — callers should return no rows. */
export function isEmptyQuery(q: ParsedQuery): boolean {
  return (
    q.text.trim() === '' &&
    q.from === undefined &&
    q.to === undefined &&
    q.subject === undefined &&
    q.folder === undefined &&
    q.unread === undefined &&
    q.flagged === undefined &&
    q.hasAttachment === undefined
  )
}
