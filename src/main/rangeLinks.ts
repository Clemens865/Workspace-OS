// Default import (not `{ app }`) so this module's store class can be reused by
// the plain-node wos-metric CLI, where a named import from CJS `electron` fails
// to instantiate. See metrics.ts / metric-cli.ts.
import electron from 'electron'
import fs from 'fs'
import path from 'path'
import { parseRangeRef, coerceGrid, gridsEqual, type LiveRange, type RangeGrid, type RangeSource } from './ranges'
import { parseA1 } from './transclusions'

const { app } = electron

/**
 * Range-transclusion links: the "live" side of live ranges (the range-sized
 * sibling of transclusions.ts). A RangeLink records that one anchor in one file
 * mirrors a LiveRange — the grid analogue of the scalar cross-app metric link:
 *   - {kind:'xlsx-block', sheet, cell} — a block of real Calc cells whose
 *     TOP-LEFT corner is `cell`; the block's size is the range's current grid.
 *   - {kind:'docx-table', tag}         — a Word TEXT TABLE named `wos-range-<id>`
 *                                        (round-trips as a `<w:tbl>`); its cells
 *                                        hold the grid, updated in place.
 *   - {kind:'pptx-table', tag, slide?} — an Impress slide TABLE whose Name is
 *                                        `wos-range-<id>` (round-trips as an
 *                                        `<a:tbl>` in a graphicFrame); its cells
 *                                        hold the grid.
 * The file itself always holds real literals (fidelity floor). On reopen, each
 * link re-syncs its anchor to the range's current grid. The link is a SIDECAR —
 * deleting it, or the range it points at, never touches the file, which stays a
 * valid document with its last literal values (fail-safe).
 *
 * Keyed one-per-anchor: adding a link on an anchor already linked replaces it.
 * Persists as one JSON file in userData. Legacy flat {sheet, cell} records and
 * bare {kind:'xlsx-block'} both normalize on load for back-compat.
 */

/** Where a range's grid is written inside a file (discriminated by app). */
export type RangeLinkTarget =
  | { kind: 'xlsx-block'; sheet: string; cell: string }
  | { kind: 'docx-table'; tag: string }
  | { kind: 'pptx-table'; tag: string; slide?: number }

export interface RangeLink {
  id: string
  rangeId: string
  filePath: string
  target: RangeLinkTarget
  /** The grid last written into the anchor (the in-sync check + block size). */
  lastValues: RangeGrid
}

export const RANGE_LINKS_MAX = 500

const newId = (): string => `rlink-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

/** A stable identity for a link's anchor — the one-per-anchor upsert key. */
export function rangeTargetKey(filePath: string, t: RangeLinkTarget): string {
  if (t.kind === 'xlsx-block') return `xb|${filePath}|${t.sheet}|${t.cell}`
  if (t.kind === 'pptx-table') return `pt|${filePath}|${t.tag}`
  return `dt|${filePath}|${t.tag}`
}

/**
 * Normalizes an untrusted persisted/added target into a RangeLinkTarget, or null
 * when it isn't a valid anchor. Accepts the discriminated `target` for all three
 * kinds; a bare {kind:'xlsx-block'} shape is the historical form and still works.
 */
export function coerceRangeTarget(raw: unknown): RangeLinkTarget | null {
  const r = (raw ?? {}) as {
    target?: { kind?: unknown; sheet?: unknown; cell?: unknown; tag?: unknown; slide?: unknown }
  }
  const t = r.target
  if (t && typeof t === 'object') {
    if (t.kind === 'xlsx-block' && typeof t.cell === 'string' && parseA1(t.cell)) {
      return { kind: 'xlsx-block', sheet: typeof t.sheet === 'string' ? t.sheet : '', cell: t.cell }
    }
    if (t.kind === 'docx-table' && typeof t.tag === 'string' && t.tag) {
      return { kind: 'docx-table', tag: t.tag }
    }
    if (t.kind === 'pptx-table' && typeof t.tag === 'string' && t.tag) {
      const slide = typeof t.slide === 'number' && Number.isFinite(t.slide) ? t.slide : undefined
      return slide === undefined
        ? { kind: 'pptx-table', tag: t.tag }
        : { kind: 'pptx-table', tag: t.tag, slide }
    }
  }
  return null
}

/**
 * Circular-safety guard for source-linked ranges. When a range is READ from a
 * spreadsheet range (source) AND also TRANSCLUDED INTO a block that OVERLAPS
 * that source rectangle (same file + sheet), refreshing it must not write the
 * grid back over its own source — a self-reference (and a potential write
 * loop). The written block's size is the CURRENT grid's size.
 */
export function isSelfSourceRangeLink(
  source: RangeSource | undefined,
  linkFilePath: string,
  target: RangeLinkTarget,
  grid: RangeGrid
): boolean {
  if (!source || source.kind !== 'xlsx-range') return false
  // Only a Calc BLOCK can overlap an xlsx source rectangle; a docx/pptx table
  // anchor lives in a different file kind and can never self-reference.
  if (target.kind !== 'xlsx-block') return false
  if (source.filePath !== linkFilePath || source.sheet !== target.sheet) return false
  const src = parseRangeRef(source.ref)
  const anchor = parseA1(target.cell)
  if (!src || !anchor) return false
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  // Rectangle overlap test (0-based inclusive bounds).
  const aL = anchor.col
  const aT = anchor.row
  const aR = anchor.col + cols - 1
  const aB = anchor.row + rows - 1
  const sL = src.startCol
  const sT = src.startRow
  const sR = src.startCol + src.cols - 1
  const sB = src.startRow + src.rows - 1
  return aL <= sR && sL <= aR && aT <= sB && sT <= aB
}

/** One re-sync action: write `values` into `link`'s block (and advance lastValues). */
export interface RangeResyncAction {
  link: RangeLink
  values: RangeGrid
}

/**
 * Pure re-sync decision — THE fail-safe core (mirrors resyncDecisions). Given a
 * file's range links and a lookup of ranges by id, returns only the blocks that
 * must change:
 *   - range missing (deleted)     → NO action (block keeps its last literals)
 *   - grid equals lastValues      → NO action (already in sync)
 *   - self-source overlap         → NO action (never write a source over itself)
 *   - otherwise                   → action to write the new grid
 */
export function rangeResyncDecisions(
  links: RangeLink[],
  rangeById: (id: string) => LiveRange | undefined
): RangeResyncAction[] {
  const out: RangeResyncAction[] = []
  for (const link of links) {
    const range = rangeById(link.rangeId)
    if (!range) continue // fail-safe: deleted/missing range → keep the file's values
    if (isSelfSourceRangeLink(range.source, link.filePath, link.target, range.values)) continue
    if (!gridsEqual(range.values, link.lastValues)) out.push({ link, values: range.values })
  }
  return out
}

/**
 * Pure sync-all planner (mirrors planSyncAll): partition one range's links into
 * open-file (engine owns it), self-source (loop-safe skip), in-sync, and the
 * closed files whose blocks must change. No I/O — the fail-safe partition the
 * handler acts on.
 */
export interface RangeSyncAllPlan {
  toWrite: RangeLink[]
  unchanged: RangeLink[]
  openSkipped: RangeLink[]
  selfSkipped: RangeLink[]
}

export function planRangeSyncAll(
  links: RangeLink[],
  range: LiveRange,
  openFilePath: string | null
): RangeSyncAllPlan {
  const plan: RangeSyncAllPlan = { toWrite: [], unchanged: [], openSkipped: [], selfSkipped: [] }
  for (const link of links) {
    if (isSelfSourceRangeLink(range.source, link.filePath, link.target, range.values)) plan.selfSkipped.push(link)
    else if (openFilePath && link.filePath === openFilePath) plan.openSkipped.push(link)
    else if (gridsEqual(link.lastValues, range.values)) plan.unchanged.push(link)
    else plan.toWrite.push(link)
  }
  return plan
}

export class RangeLinkStore {
  constructor(private file: () => string) {}

  private load(): RangeLink[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file(), 'utf-8')) as unknown
      if (!Array.isArray(parsed)) return []
      const out: RangeLink[] = []
      for (const raw of parsed) {
        const l = raw as { id?: unknown; rangeId?: unknown; filePath?: unknown; lastValues?: unknown }
        if (typeof l?.id !== 'string' || typeof l?.rangeId !== 'string' || typeof l?.filePath !== 'string') continue
        const target = coerceRangeTarget(raw)
        const lastValues = coerceGrid(l.lastValues)
        if (!target || !lastValues) continue
        out.push({ id: l.id, rangeId: l.rangeId, filePath: l.filePath, target, lastValues })
      }
      return out
    } catch {
      return []
    }
  }

  private save(list: RangeLink[]): void {
    try {
      fs.writeFileSync(this.file(), JSON.stringify(list), 'utf-8')
    } catch {
      // Best-effort.
    }
  }

  /** Every range link targeting one file (all sheets). */
  forFile(filePath: string): RangeLink[] {
    return this.load().filter((l) => l.filePath === filePath)
  }

  /** Every link bound to one range, across ALL files (sync-all's data source). */
  forRange(rangeId: string): RangeLink[] {
    return this.load().filter((l) => l.rangeId === rangeId)
  }

  /** Every link in the store (read-only; drives per-range link counts). */
  allLinks(): RangeLink[] {
    return this.load()
  }

  /**
   * Upserts a link, one-per-anchor: any existing link on the same anchor is
   * replaced (re-inserting persists a new lastValues). Throws only when the
   * anchor or grid can't be resolved (never persists a bad link).
   */
  add(input: { rangeId: string; filePath: string; target?: unknown; lastValues: unknown }): RangeLink {
    const target = coerceRangeTarget(input)
    if (!target) throw new Error('invalid range link target')
    const lastValues = coerceGrid(input.lastValues)
    if (!lastValues) throw new Error('invalid range link values')
    const link: RangeLink = { id: newId(), rangeId: input.rangeId, filePath: input.filePath, target, lastValues }
    const key = rangeTargetKey(link.filePath, link.target)
    const rest = this.load().filter((l) => rangeTargetKey(l.filePath, l.target) !== key)
    this.save([link, ...rest].slice(0, RANGE_LINKS_MAX))
    return link
  }

  remove(id: string): void {
    this.save(this.load().filter((l) => l.id !== id))
  }
}

export const rangeLinks = new RangeLinkStore(() =>
  path.join(app.getPath('userData'), 'range-links.json')
)
