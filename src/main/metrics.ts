// Default import (not `{ app }`): under Electron this is the electron module
// (with `.app`); under a plain-node ESM CLI that reuses this module's store
// class (wos-metric), a NAMED import from the CJS `electron` fails to
// instantiate, whereas the default import resolves harmlessly (the singleton's
// `app.getPath` closure is simply never invoked there). See metric-cli.ts.
import electron from 'electron'
import fs from 'fs'
import path from 'path'

const { app } = electron

/**
 * Metrics: named single-source-of-truth numbers (live-transclusion demo).
 *
 * A Metric is a { name, value } pair that a user can transclude into a real
 * office document (see transclusions.ts). The literal value is written into the
 * file so it always opens as a correct, ordinary number; the metric is the live
 * source that a reopened file re-syncs against. Persists as one JSON file in
 * userData — independent of any workspace, like recent-workspaces/snapshots.
 */

/**
 * Where a metric's value ORIGINATES.
 *   - literal    → hand-typed (the classic metric; also the back-compat default)
 *   - xlsx-cell  → read live from a real cell in a spreadsheet ON DISK; the
 *                  metric's `value` is a CACHE of the last successful read, so a
 *                  sourced metric degrades gracefully to a literal if the source
 *                  ever vanishes (fail-safe — downstream docs are never blanked).
 */
export type MetricSource =
  | { kind: 'literal' }
  | { kind: 'xlsx-cell'; filePath: string; sheet: string; cell: string }

export interface Metric {
  id: string
  name: string
  value: number
  updatedAt: number
  /** Absent = literal (back-compat). Present = the value's live origin. */
  source?: MetricSource
}

export const METRICS_MAX = 200
const NAME_MAX = 80

const newId = (): string => `metric-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

/** Coerces an untrusted number, dropping NaN/Infinity to 0 (never corrupt). */
export function coerceValue(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
}

/**
 * Normalizes an untrusted persisted/added source into a MetricSource, or
 * `undefined` (= literal) for a missing/invalid/`literal` source. Back-compat:
 * an old metric with no `source` field normalizes to undefined → literal.
 */
export function coerceSource(raw: unknown): MetricSource | undefined {
  const s = (raw ?? {}) as { kind?: unknown; filePath?: unknown; sheet?: unknown; cell?: unknown }
  if (
    s.kind === 'xlsx-cell' &&
    typeof s.filePath === 'string' &&
    s.filePath &&
    typeof s.cell === 'string' &&
    s.cell
  ) {
    return {
      kind: 'xlsx-cell',
      filePath: s.filePath,
      sheet: typeof s.sheet === 'string' ? s.sheet : '',
      cell: s.cell,
    }
  }
  return undefined // 'literal' or anything unrecognized → literal
}

/** True when a metric reads its value live from a spreadsheet cell. */
export function isSourced(
  m: Metric
): m is Metric & { source: { kind: 'xlsx-cell'; filePath: string; sheet: string; cell: string } } {
  return m.source?.kind === 'xlsx-cell'
}

/**
 * Pure refresh decision — the fail-safe core of source-linked metrics. Given a
 * metric and the result of reading its source cell, decides what must happen:
 *   - literal metric         → 'literal' (no source to read; caller no-ops)
 *   - read failed            → 'stale'   (KEEP the cached value; flag stale)
 *   - read ok, value same    → 'unchanged'
 *   - read ok, value changed → 'updated' (propagate the new value downstream)
 * It never blanks a value — an unreadable source leaves the last good number.
 */
export type RefreshStatus = 'literal' | 'stale' | 'unchanged' | 'updated'
export function planRefresh(
  metric: Metric,
  read: { ok: boolean; value?: number }
): { status: RefreshStatus; value: number } {
  if (!isSourced(metric)) return { status: 'literal', value: metric.value }
  if (!read.ok || typeof read.value !== 'number' || !Number.isFinite(read.value)) {
    return { status: 'stale', value: metric.value } // keep last good value
  }
  if (read.value === metric.value) return { status: 'unchanged', value: metric.value }
  return { status: 'updated', value: read.value }
}

export class MetricStore {
  constructor(private file: () => string) {}

  // Read-through cache of the parsed store, validated by the backing file's
  // mtime + size. A 200-metric refresh-all used to issue one fs.readFileSync
  // (parse the whole file) PER metric via get/list/update — hundreds of full
  // reads. Now a warm cache costs one cheap fs.statSync instead: we re-parse
  // only when the file changed on disk. This stays coherent with EXTERNAL
  // writers too (the wos-metric CLI runs in a separate process), unlike a
  // write-invalidated-only cache. Keyed by file path (app vs CLI differ).
  private cache: { file: string; mtimeMs: number; size: number; list: Metric[] } | null = null

  private load(): Metric[] {
    const file = this.file()
    let mtimeMs = -1
    let size = -1
    try {
      const st = fs.statSync(file)
      mtimeMs = st.mtimeMs
      size = st.size
    } catch {
      mtimeMs = -1 // missing file — treated as an empty, cacheable state
    }
    const c = this.cache
    if (c && c.file === file && c.mtimeMs === mtimeMs && c.size === size) return c.list

    let list: Metric[]
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown
      list = !Array.isArray(parsed)
        ? []
        : parsed
            .filter(
              (m): m is Metric =>
                typeof (m as Metric)?.id === 'string' && typeof (m as Metric)?.name === 'string'
            )
            .map((m) => {
              const source = coerceSource(m.source)
              const metric: Metric = {
                id: m.id,
                name: m.name.slice(0, NAME_MAX),
                value: coerceValue(m.value),
                updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : 0,
              }
              if (source) metric.source = source
              return metric
            })
    } catch {
      list = [] // nothing saved yet, or corrupt file — start fresh
    }
    this.cache = { file, mtimeMs, size, list }
    return list
  }

  private save(list: Metric[]): void {
    const file = this.file()
    try {
      fs.writeFileSync(file, JSON.stringify(list), 'utf-8')
      // Re-stamp the cache to the just-written file so the next read is a hit.
      try {
        const st = fs.statSync(file)
        this.cache = { file, mtimeMs: st.mtimeMs, size: st.size, list }
      } catch {
        this.cache = null // couldn't stat — force a fresh read next time
      }
    } catch {
      // Best-effort — an unwritable userData dir shouldn't block the app.
      this.cache = null
    }
  }

  /** All metrics, newest-updated first. Sorts a COPY so the cached array's order
   *  (and `create`'s newest-first insertion) is never mutated under callers. */
  list(): Metric[] {
    return [...this.load()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): Metric | undefined {
    return this.load().find((m) => m.id === id)
  }

  create(name: string, value: unknown, source?: unknown): Metric {
    const metric: Metric = {
      id: newId(),
      name: name.trim().slice(0, NAME_MAX) || 'Untitled',
      value: coerceValue(value),
      updatedAt: Date.now(),
    }
    const src = coerceSource(source)
    if (src) metric.source = src
    const next = [metric, ...this.load()].slice(0, METRICS_MAX)
    this.save(next)
    return metric
  }

  /**
   * Patches name, value and/or source; bumps updatedAt. No-op for an unknown id.
   * Passing `source` (even an invalid/literal one) DETACHES to a literal — the
   * caller detaches by sending `{ source: { kind: 'literal' } }`, which coerces
   * to undefined and drops the field, keeping the current cached value.
   */
  update(
    id: string,
    patch: { name?: string; value?: unknown; source?: unknown }
  ): Metric | undefined {
    const list = this.load()
    const i = list.findIndex((m) => m.id === id)
    if (i < 0) return undefined
    const cur = list[i]
    const next: Metric = {
      ...cur,
      name: typeof patch.name === 'string' ? patch.name.trim().slice(0, NAME_MAX) || cur.name : cur.name,
      value: patch.value === undefined ? cur.value : coerceValue(patch.value),
      updatedAt: Date.now(),
    }
    if ('source' in patch) {
      const src = coerceSource(patch.source)
      if (src) next.source = src
      else delete next.source
    }
    list[i] = next
    this.save(list)
    return next
  }

  remove(id: string): void {
    this.save(this.load().filter((m) => m.id !== id))
  }
}

export const metrics = new MetricStore(() =>
  path.join(app.getPath('userData'), 'metrics.json')
)
