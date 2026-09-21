/**
 * Pure `[[wikilink]]` extractor for the backlinks knowledge base.
 *
 * Recognises the four Obsidian/Roam-style forms:
 *   [[Target]]                     → { target }
 *   [[Target|alias]]               → { target, alias }
 *   [[Target#heading]]             → { target, heading }
 *   [[Target#heading|alias]]       → { target, heading, alias }
 *
 * Links inside fenced code blocks (``` … ```  or  ~~~ … ~~~) and inline code
 * spans (`` `…` ``) are IGNORED — a `[[x]]` in a code sample is a literal, not
 * a link. No dependencies: a tiny state machine strips code regions, then a
 * regex pulls links from what's left (positions preserved via masking, so the
 * reported `index` is the offset in the ORIGINAL text).
 */

export interface WikiLink {
  /** The referenced note name (basename-ish), trimmed. Never empty. */
  target: string
  /** Optional `#heading` fragment (without the `#`), trimmed. */
  heading?: string
  /** Optional `|alias` display text, trimmed. */
  alias?: string
  /** Character offset of the opening `[[` in the original text. */
  index: number
}

/**
 * Returns a copy of `text` with every fenced-code and inline-code region
 * replaced by spaces of equal length. Same length = offsets are preserved, so a
 * link found in the masked string has the same `index` in the original.
 */
function maskCode(text: string): string {
  const out = text.split('')
  const n = text.length
  let i = 0
  let inFence = false
  let fenceChar = ''
  let fenceLen = 0
  let atLineStart = true

  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== '\n') out[k] = ' '
    }
  }

  while (i < n) {
    const ch = text[i]

    // Detect a fence marker (``` or ~~~, 3+ of the same char) at line start.
    if (atLineStart && (ch === '`' || ch === '~')) {
      let j = i
      while (j < n && text[j] === ch) j++
      const run = j - i
      if (run >= 3) {
        if (!inFence) {
          inFence = true
          fenceChar = ch
          fenceLen = run
          blank(i, j)
          i = j
          atLineStart = false
          continue
        } else if (ch === fenceChar && run >= fenceLen) {
          // Closing fence.
          inFence = false
          fenceChar = ''
          fenceLen = 0
          blank(i, j)
          i = j
          atLineStart = false
          continue
        }
      }
    }

    if (inFence) {
      if (ch !== '\n') out[i] = ' '
      atLineStart = ch === '\n'
      i++
      continue
    }

    // Inline code span: a run of N backticks opens, the same run length closes.
    if (ch === '`') {
      let j = i
      while (j < n && text[j] === '`') j++
      const open = j - i
      // Find a matching closing run of exactly `open` backticks.
      let k = j
      let closeAt = -1
      while (k < n) {
        if (text[k] === '`') {
          let m = k
          while (m < n && text[m] === '`') m++
          if (m - k === open) {
            closeAt = k
            k = m
            break
          }
          k = m
        } else if (text[k] === '\n') {
          // Inline spans don't cross blank lines in practice; keep it simple and
          // bounded — stop scanning at a newline if no close found yet.
          k++
        } else {
          k++
        }
      }
      if (closeAt !== -1) {
        blank(i, k) // mask the whole span including both backtick fences
        i = k
        atLineStart = false
        continue
      }
      // No close — treat the backticks as literal text; fall through.
    }

    atLineStart = ch === '\n'
    i++
  }

  return out.join('')
}

// One link: [[  target (no [ ] | #)  optional #heading  optional |alias  ]]
const LINK_RE = /\[\[([^\][|#\n]+?)(?:#([^\][|\n]+?))?(?:\|([^\][\n]*?))?\]\]/g

/**
 * Parses all wikilinks from `text`, skipping code regions. Empty targets
 * (`[[]]`, `[[ ]]`, `[[#h]]`) are dropped; single-bracket `[x]` never matches.
 */
export function parseWikilinks(text: string): WikiLink[] {
  if (!text || text.indexOf('[[') === -1) return []
  const masked = maskCode(text)
  const links: WikiLink[] = []
  LINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LINK_RE.exec(masked)) !== null) {
    const target = m[1].trim()
    if (!target) continue // [[ ]] / empty target → not a link
    const link: WikiLink = { target, index: m.index }
    const heading = m[2]?.trim()
    if (heading) link.heading = heading
    const alias = m[3]?.trim()
    if (alias) link.alias = alias
    links.push(link)
  }
  return links
}

/** Line number (1-based) for a character offset — used to build link snippets. */
export function lineAt(text: string, index: number): number {
  let line = 1
  const end = Math.min(index, text.length)
  for (let i = 0; i < end; i++) {
    if (text[i] === '\n') line++
  }
  return line
}

/** The full source line (trimmed) containing `index` — the backlink snippet. */
export function lineText(text: string, index: number): string {
  const safe = Math.max(0, Math.min(index, text.length))
  let start = safe
  while (start > 0 && text[start - 1] !== '\n') start--
  let end = safe
  while (end < text.length && text[end] !== '\n') end++
  return text.slice(start, end).trim()
}
