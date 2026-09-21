// Default import (not `{ app }`) so this module's store class can be reused by
// the plain-node wos-metric CLI, where a named import from CJS `electron` fails
// to instantiate. See metrics.ts / metric-cli.ts.
import electron from 'electron'
import fs from 'fs'
import path from 'path'
import type { Metric } from './metrics'

const { app } = electron

/**
 * Transclusion links: the "live" side of the live-transclusion demo.
 *
 * A Link records that one ANCHOR in one file mirrors a Metric. The anchor is a
 * discriminated `target` so liveness isn't spreadsheet-specific:
 *   - {kind:'xlsx-cell', sheet, cell}  — a real Calc cell (A1)
 *   - {kind:'docx-cc', tag}            — a Word content control (w:sdt) tagged
 *                                        `wos-metric-<linkId>`; the value lives
 *                                        in its <w:sdtContent>
 *   - {kind:'pptx-shape', tag, slide?} — an Impress text shape whose Name is
 *                                        `wos-metric-<linkId>` (round-trips as a
 *                                        pptx `<p:cNvPr name>`); the value lives
 *                                        in its `<p:txBody>` `<a:t>` run
 * The file itself always holds a real literal (fidelity floor). On reopen, each
 * link re-syncs its anchor to the metric's current value. The link is a SIDECAR
 * — deleting it, or the metric it points at, never touches the file, which stays
 * a valid document with its last literal value (fail-safe).
 *
 * Keyed one-per-anchor: adding a link on an anchor already linked replaces it.
 * Persists as one JSON file in userData. Legacy flat {sheet, cell} records are
 * normalized on load to {kind:'xlsx-cell'} for back-compat.
 */

/** Where a metric's value is written inside a file (discriminated by app). */
export type LinkTarget =
  | { kind: 'xlsx-cell'; sheet: string; cell: string }
  | { kind: 'docx-cc'; tag: string }
  | { kind: 'pptx-shape'; tag: string; slide?: number }

export interface Link {
  id: string
  metricId: string
  filePath: string
  target: LinkTarget
  lastValue: number
}

/** A stable identity for a link's anchor — the one-per-anchor upsert key. */
export function targetKey(filePath: string, t: LinkTarget): string {
  if (t.kind === 'xlsx-cell') return `x|${filePath}|${t.sheet}|${t.cell}`
  if (t.kind === 'pptx-shape') return `p|${filePath}|${t.tag}`
  return `d|${filePath}|${t.tag}`
}

/**
 * Normalizes an untrusted persisted/added record into a LinkTarget, or null when
 * it isn't a valid anchor. Accepts the new discriminated `target` shape AND the
 * legacy flat {sheet, cell} shape (treated as kind:'xlsx-cell').
 */
export function coerceTarget(raw: unknown): LinkTarget | null {
  const r = (raw ?? {}) as {
    target?: { kind?: unknown; sheet?: unknown; cell?: unknown; tag?: unknown; slide?: unknown }
    sheet?: unknown
    cell?: unknown
    tag?: unknown
  }
  const t = r.target
  if (t && typeof t === 'object') {
    if (t.kind === 'docx-cc' && typeof t.tag === 'string' && t.tag) {
      return { kind: 'docx-cc', tag: t.tag }
    }
    if (t.kind === 'pptx-shape' && typeof t.tag === 'string' && t.tag) {
      const slide = typeof t.slide === 'number' && Number.isFinite(t.slide) ? t.slide : undefined
      return slide === undefined
        ? { kind: 'pptx-shape', tag: t.tag }
        : { kind: 'pptx-shape', tag: t.tag, slide }
    }
    if (t.kind === 'xlsx-cell' && typeof t.cell === 'string' && isValidA1(t.cell)) {
      return { kind: 'xlsx-cell', sheet: typeof t.sheet === 'string' ? t.sheet : '', cell: t.cell }
    }
  }
  // Legacy flat shape (or a flat add input): {sheet, cell} → xlsx-cell.
  if (typeof r.cell === 'string' && isValidA1(r.cell)) {
    return { kind: 'xlsx-cell', sheet: typeof r.sheet === 'string' ? r.sheet : '', cell: r.cell }
  }
  if (typeof r.tag === 'string' && r.tag) return { kind: 'docx-cc', tag: r.tag }
  return null
}

export const LINKS_MAX = 2000

const newId = (): string => `link-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

const A1_RE = /^([A-Za-z]{1,3})([1-9][0-9]{0,6})$/

/** Parses an A1 address → 0-based { col, row }, or null if malformed. */
export function parseA1(cell: string): { col: number; row: number } | null {
  const m = A1_RE.exec(typeof cell === 'string' ? cell.trim() : '')
  if (!m) return null
  let col = 0
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { col: col - 1, row: parseInt(m[2], 10) - 1 }
}

export function isValidA1(cell: string): boolean {
  return parseA1(cell) !== null
}

/**
 * Circular-safety guard for source-linked metrics. When a metric is READ from a
 * cell (source) AND also TRANSCLUDED INTO that same cell (a link), refreshing it
 * must not write the value back into its own source — that is a self-reference
 * (and a potential write loop). True when `link` points at the metric's source
 * cell (same file + sheet + cell); such links are skipped by every write path.
 */
export function isSelfSourceLink(
  source: { kind: string; filePath?: string; sheet?: string; cell?: string } | undefined,
  linkFilePath: string,
  target: LinkTarget
): boolean {
  if (!source || source.kind !== 'xlsx-cell') return false
  if (target.kind !== 'xlsx-cell') return false
  return source.filePath === linkFilePath && source.sheet === target.sheet && source.cell === target.cell
}

/** One re-sync action: write `value` into `link`'s cell (and bump lastValue). */
export interface ResyncAction {
  link: Link
  value: number
}

/**
 * Pure re-sync decision — THE fail-safe core. Given a file's links and a lookup
 * of metrics by id, returns only the cells that must change:
 *   - metric missing (deleted)      → NO action (cell keeps its last literal value)
 *   - metric value === lastValue    → NO action (already in sync)
 *   - metric value !== lastValue    → action to write the new value
 * It never emits a "blank" or an error — a stale/orphaned link is simply skipped.
 */
export function resyncDecisions(
  links: Link[],
  metricById: (id: string) => Metric | undefined
): ResyncAction[] {
  const out: ResyncAction[] = []
  for (const link of links) {
    const metric = metricById(link.metricId)
    if (!metric) continue // fail-safe: deleted/missing metric → keep the file's value
    // Circular safety: never write a sourced metric back into its own source cell.
    if (isSelfSourceLink(metric.source, link.filePath, link.target)) continue
    if (metric.value !== link.lastValue) out.push({ link, value: metric.value })
  }
  return out
}

/**
 * Pure sync-all planner — the decision core for "push a metric into every linked
 * file on disk". Given every link for one metric, the metric's CURRENT value, and
 * the path of the file currently OPEN in the engine, it partitions the links:
 *   - open file           → skipped here (the engine owns it; the live path writes it)
 *   - value === lastValue → unchanged (already in sync — no write)
 *   - value !== lastValue → toWrite (a closed file whose cell must change)
 * No I/O, no engine — just the fail-safe partition the handler acts on.
 */
export interface SyncAllPlan {
  toWrite: Link[]
  unchanged: Link[]
  openSkipped: Link[]
  /** Links skipped because they point at the metric's own source cell (loop-safe). */
  selfSkipped: Link[]
}

export function planSyncAll(
  links: Link[],
  metricValue: number,
  openFilePath: string | null,
  source?: { kind: string; filePath?: string; sheet?: string; cell?: string }
): SyncAllPlan {
  const plan: SyncAllPlan = { toWrite: [], unchanged: [], openSkipped: [], selfSkipped: [] }
  for (const link of links) {
    if (isSelfSourceLink(source, link.filePath, link.target)) plan.selfSkipped.push(link)
    else if (openFilePath && link.filePath === openFilePath) plan.openSkipped.push(link)
    else if (link.lastValue === metricValue) plan.unchanged.push(link)
    else plan.toWrite.push(link)
  }
  return plan
}

export class TransclusionStore {
  constructor(private file: () => string) {}

  private load(): Link[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file(), 'utf-8')) as unknown
      if (!Array.isArray(parsed)) return []
      const out: Link[] = []
      for (const raw of parsed) {
        const l = raw as { id?: unknown; metricId?: unknown; filePath?: unknown; lastValue?: unknown }
        if (typeof l?.id !== 'string' || typeof l?.metricId !== 'string' || typeof l?.filePath !== 'string') {
          continue
        }
        const target = coerceTarget(raw) // handles both the new `target` and legacy flat shapes
        if (!target) continue
        out.push({
          id: l.id,
          metricId: l.metricId,
          filePath: l.filePath,
          target,
          lastValue: typeof l.lastValue === 'number' && Number.isFinite(l.lastValue) ? l.lastValue : 0,
        })
      }
      return out
    } catch {
      return []
    }
  }

  private save(list: Link[]): void {
    try {
      fs.writeFileSync(this.file(), JSON.stringify(list), 'utf-8')
    } catch {
      // Best-effort.
    }
  }

  /** Every link targeting one file (all sheets). */
  forFile(filePath: string): Link[] {
    return this.load().filter((l) => l.filePath === filePath)
  }

  /** Every link bound to one metric, across ALL files (sync-all's data source). */
  forMetric(metricId: string): Link[] {
    return this.load().filter((l) => l.metricId === metricId)
  }

  /** Every link in the store (read-only; drives per-metric link counts). */
  allLinks(): Link[] {
    return this.load()
  }

  /**
   * Upserts a link, one-per-anchor: any existing link on the same anchor
   * (same targetKey) is replaced (re-inserting persists a new lastValue).
   * Accepts the discriminated `target` OR the legacy flat {sheet, cell} form.
   * Throws only when the anchor can't be resolved (never persists a bad link).
   */
  add(input: {
    metricId: string
    filePath: string
    lastValue: number
    sheet?: string
    cell?: string
    target?: LinkTarget
  }): Link {
    const target = coerceTarget(input)
    if (!target) throw new Error('invalid link target')
    const link: Link = {
      id: newId(),
      metricId: input.metricId,
      filePath: input.filePath,
      target,
      lastValue: Number.isFinite(input.lastValue) ? input.lastValue : 0,
    }
    const key = targetKey(link.filePath, link.target)
    const rest = this.load().filter((l) => targetKey(l.filePath, l.target) !== key)
    this.save([link, ...rest].slice(0, LINKS_MAX))
    return link
  }

  remove(id: string): void {
    this.save(this.load().filter((l) => l.id !== id))
  }
}

export const transclusions = new TransclusionStore(() =>
  path.join(app.getPath('userData'), 'transclusions.json')
)
