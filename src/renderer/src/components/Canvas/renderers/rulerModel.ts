/**
 * The Writer ruler's model. The engine has no ruler in headless mode (its
 * RULER_UPDATE callback never fires), so the page and paragraph geometry are
 * read from the model (WosRulerInfo) and written back with WosParaFmt /
 * WosPageMargins. All values in 1/100 mm; tab positions are relative to the
 * paragraph's left indent, as in the API.
 */

export interface RulerInfo {
  pageW: number
  left: number
  right: number
  paraLeft: number
  paraRight: number
  firstLine: number
  tabs: number[]
}

/** 'pageW|left|right|paraLeft|paraRight|firstLine|t1,t2,…' → RulerInfo (null when malformed). */
export function parseRulerInfo(raw: string): RulerInfo | null {
  const p = raw.trim().split('\n')[0]?.split('|') ?? []
  if (p.length < 6) return null
  const n = p.slice(0, 6).map(Number)
  if (n.some((v) => !Number.isFinite(v)) || n[0] <= 0) return null
  const tabs = (p[6] ?? '').split(',').map(Number).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
  return { pageW: n[0], left: n[1], right: n[2], paraLeft: n[3], paraRight: n[4], firstLine: n[5], tabs }
}

/** Absolute (page-relative, 1/100 mm) positions of the draggable markers. */
export function rulerMarkers(r: RulerInfo): { leftIndent: number; firstLine: number; rightIndent: number; tabs: number[] } {
  return {
    leftIndent: r.left + r.paraLeft,
    firstLine: r.left + r.paraLeft + r.firstLine,
    rightIndent: r.pageW - r.right - r.paraRight,
    tabs: r.tabs.map((t) => r.left + r.paraLeft + t),
  }
}

export type RulerMarker = 'leftIndent' | 'firstLine' | 'rightIndent' | 'leftMargin' | 'rightMargin'

/**
 * The op to run after dragging `marker` to absolute position `pos` (1/100 mm).
 * Returns the macro and its args; the caller runs it and re-reads.
 */
export function rulerDragOp(r: RulerInfo, marker: RulerMarker, pos: number): { macro: 'WosParaFmt' | 'WosPageMargins'; args: string } {
  const clamp = (v: number, lo: number, hi: number): number => Math.round(Math.max(lo, Math.min(hi, v)))
  switch (marker) {
    case 'leftIndent': {
      // Moving the left indent keeps the first-line marker where it is.
      const paraLeft = clamp(pos - r.left, 0, r.pageW - r.left - r.right - r.paraRight - 500)
      const first = clamp(r.paraLeft + r.firstLine - paraLeft, -paraLeft, r.pageW)
      return { macro: 'WosParaFmt', args: `indent|${paraLeft}|-1|${first}` }
    }
    case 'firstLine': {
      const first = clamp(pos - r.left - r.paraLeft, -r.paraLeft, r.pageW - r.left - r.right - r.paraLeft - r.paraRight - 500)
      return { macro: 'WosParaFmt', args: `indent|-1|-1|${first}` }
    }
    case 'rightIndent': {
      const paraRight = clamp(r.pageW - r.right - pos, 0, r.pageW - r.left - r.right - r.paraLeft - 500)
      return { macro: 'WosParaFmt', args: `indent|-1|${paraRight}|` }
    }
    case 'leftMargin':
      return { macro: 'WosPageMargins', args: `left|${clamp(pos, 0, r.pageW - r.right - 1000)}` }
    case 'rightMargin':
      return { macro: 'WosPageMargins', args: `right|${clamp(r.pageW - pos, 0, r.pageW - r.left - 1000)}` }
  }
}

/** Tab list after adding a stop at absolute `pos` (or removing the one at index). */
export function tabsAfter(r: RulerInfo, change: { add: number } | { remove: number }): string {
  const rel = 'add' in change ? [...r.tabs, Math.round(change.add - r.left - r.paraLeft)].filter((t) => t > 0) : r.tabs.filter((_, i) => i !== change.remove)
  return `tabs|${[...new Set(rel)].sort((a, b) => a - b).join(',')}`
}

/** Ruler tick spacing: 1 cm major ticks with 0.5 cm minors. */
export const CM = 1000
