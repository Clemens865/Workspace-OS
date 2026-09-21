/**
 * Excel-style sort on a Calc selection: when the picked column sits inside a
 * wider data block, ask whether to expand the sort to the whole block (rows
 * move together) or sort only the selected column. The engine side is
 * WosSort ('info|<sel>' → 'sel|region|hasHeader'; 'sort|<sel>|<asc>|<expand>').
 */

export interface SortInfo {
  /** Absolute selection, e.g. "$Sheet1.$B$2:$B$4". */
  selection: string
  /** The contiguous data block around it, e.g. "$Sheet1.$A$1:$C$4". */
  region: string
  hasHeader: boolean
}

export function parseSortInfo(raw: string): SortInfo | null {
  const p = raw.trim().split('\n')[0]?.split('|') ?? []
  if (p.length < 3 || !p[0] || !p[1]) return null
  return { selection: p[0], region: p[1], hasHeader: p[2] === '1' }
}

/** "$Sheet1.$A$1:$C$4" → { a: "A1", b: "C4" } (sheet prefix and $ dropped). */
export function plainRange(abs: string): { a: string; b: string } {
  const body = abs.replace(/^.*\./, '').replace(/\$/g, '')
  const [a, b = a] = body.split(':')
  return { a, b }
}

function colIndex(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

function colsOf(abs: string): { from: number; to: number } {
  const { a, b } = plainRange(abs)
  const ca = colIndex(a.replace(/\d+$/, '')), cb = colIndex(b.replace(/\d+$/, ''))
  return { from: Math.min(ca, cb), to: Math.max(ca, cb) }
}

/** True when the data block is wider than the selection — the moment to ask. */
export function needsExpandPrompt(info: SortInfo): boolean {
  const s = colsOf(info.selection), r = colsOf(info.region)
  return r.to - r.from > s.to - s.from
}

/** The picked column's letters ("B"). */
export function pickedColumn(info: SortInfo): string {
  return plainRange(info.selection).a.replace(/\d+$/, '')
}

export function sortArgs(selection: string, direction: 'asc' | 'desc', expand: boolean): string {
  const { a, b } = plainRange(selection)
  return `sort|${a}:${b}|${direction === 'asc' ? 1 : 0}|${expand ? 1 : 0}`
}
