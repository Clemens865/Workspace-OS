// Default import (not `{ app }`) so this module's store class can be reused by
// a plain-node CLI, where a named import from CJS `electron` fails to
// instantiate. See metrics.ts / ranges.ts / metric-cli.ts.
import electron from 'electron'
import fs from 'fs'
import path from 'path'
import { coerceGrid, type RangeCell, type RangeGrid } from './ranges'

const { app } = electron

/**
 * Collections: a live SET OF TYPED RECORDS — the records→layout leap above live
 * ranges. Where a LiveRange is a raw rectangular grid, a Collection interprets
 * that grid as tabular data: ROW 0 is the FIELD NAMES (the schema), and each
 * subsequent row is one RECORD (a field→value map). A collection is rendered
 * into a real office file as a FIELD-MAPPED repeated block (a link chooses which
 * fields become columns, in which order, under which display headers) and stays
 * in sync (see collectionLinks.ts).
 *
 * A collection's records usually ORIGINATE from a real spreadsheet range on disk
 * (source kind 'xlsx-range'); `fields`/`records` are a CACHE of the last
 * successful read, so a sourced collection degrades gracefully to a literal set
 * if the source ever vanishes (fail-safe — downstream layouts are never
 * blanked). Persists as one JSON file in userData — like metrics/ranges.
 */

/** One record cell value (mirrors RangeCell — number | text | empty). */
export type FieldValue = RangeCell
/** One record: field name → value. */
export type CollectionRecord = Record<string, FieldValue>

/** Where a collection's records ORIGINATE (mirrors RangeSource). */
export type CollectionSource =
  | { kind: 'literal' }
  | { kind: 'xlsx-range'; filePath: string; sheet: string; ref: string }

export interface Collection {
  id: string
  name: string
  /** The schema — field names, in source-column order. */
  fields: string[]
  /** The rows, each a field→value map (a CACHE of the last successful read). */
  records: CollectionRecord[]
  updatedAt: number
  /** Absent = literal set. Present = the records' live origin. */
  source?: CollectionSource
}

export const COLLECTIONS_MAX = 100
export const COLLECTION_MAX_FIELDS = 26
export const COLLECTION_MAX_RECORDS = 500
const NAME_MAX = 80
const FIELD_NAME_MAX = 120
const CELL_TEXT_MAX = 500

const newId = (): string => `coll-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

/** Coerces one untrusted field value (mirrors coerceCell). */
export function coerceFieldValue(raw: unknown): FieldValue {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') return raw.slice(0, CELL_TEXT_MAX)
  return null
}

/**
 * Coerces one untrusted header cell into a field NAME (a non-empty, capped
 * string). A blank/empty header becomes a positional fallback ("Field N") so a
 * grid whose top row has a gap still yields a usable, unique-ish schema.
 */
function coerceFieldName(raw: unknown, index: number): string {
  if (typeof raw === 'string' && raw.trim()) return raw.trim().slice(0, FIELD_NAME_MAX)
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  return `Field ${index + 1}`
}

/**
 * Interprets a rectangular grid as tabular records: ROW 0 → field names, each
 * subsequent row → a record mapping each field to that row's cell. Duplicate
 * header names are de-duplicated ("Rev", "Rev 2", …) so records never silently
 * collide. Pure and unit-testable. Returns null for a grid without a header row.
 */
export function gridToRecords(grid: RangeGrid): { fields: string[]; records: CollectionRecord[] } | null {
  if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0])) return null
  const width = grid[0].length
  if (width < 1) return null

  const seen = new Map<string, number>()
  const fields: string[] = grid[0].slice(0, COLLECTION_MAX_FIELDS).map((h, i) => {
    let name = coerceFieldName(h, i)
    const n = seen.get(name) ?? 0
    seen.set(name, n + 1)
    if (n > 0) name = `${name} ${n + 1}`
    return name
  })

  const records: CollectionRecord[] = []
  for (let r = 1; r < grid.length && records.length < COLLECTION_MAX_RECORDS; r++) {
    const row = grid[r]
    const rec: CollectionRecord = {}
    for (let c = 0; c < fields.length; c++) {
      rec[fields[c]] = coerceFieldValue(Array.isArray(row) ? row[c] : null)
    }
    records.push(rec)
  }
  return { fields, records }
}

/** Renders a record's value for one field as a display cell (missing → null). */
export function recordCell(record: CollectionRecord, field: string): FieldValue {
  const v = record[field]
  return v === undefined ? null : v
}

/**
 * Normalizes an untrusted source; undefined-safe. 'literal' (or anything
 * unrecognized) normalizes to { kind: 'literal' }; a valid xlsx-range keeps its
 * fields. Note: the ref is NOT canonicalized here (collections don't own a
 * RangeRef parser) — the reader validates it.
 */
export function coerceCollectionSource(raw: unknown): CollectionSource {
  const s = (raw ?? {}) as { kind?: unknown; filePath?: unknown; sheet?: unknown; ref?: unknown }
  if (
    s.kind === 'xlsx-range' &&
    typeof s.filePath === 'string' &&
    s.filePath &&
    typeof s.ref === 'string' &&
    s.ref
  ) {
    return {
      kind: 'xlsx-range',
      filePath: s.filePath,
      sheet: typeof s.sheet === 'string' ? s.sheet : '',
      ref: s.ref,
    }
  }
  return { kind: 'literal' }
}

/** True when a collection reads its records live from a spreadsheet range. */
export function isSourcedCollection(
  c: Collection
): c is Collection & { source: { kind: 'xlsx-range'; filePath: string; sheet: string; ref: string } } {
  return c.source?.kind === 'xlsx-range'
}

/**
 * Pure refresh decision — the fail-safe core (mirrors planRangeRefresh). Given a
 * collection and the result of re-reading its source range, decides:
 *   - literal collection    → 'literal' (no source; caller no-ops)
 *   - read failed/empty      → 'stale'   (KEEP the cached records; flag stale)
 *   - read ok, records same  → 'unchanged'
 *   - read ok, records changed→ 'updated'
 * It never blanks a set — an unreadable source keeps the last good records.
 */
export type CollectionRefreshStatus = 'literal' | 'stale' | 'unchanged' | 'updated'
export function planCollectionRefresh(
  collection: Collection,
  read: { ok: boolean; values?: RangeGrid }
): { status: CollectionRefreshStatus; fields: string[]; records: CollectionRecord[] } {
  if (!isSourcedCollection(collection)) {
    return { status: 'literal', fields: collection.fields, records: collection.records }
  }
  const grid = read.ok ? coerceGrid(read.values) : null
  const parsed = grid ? gridToRecords(grid) : null
  if (!parsed) {
    return { status: 'stale', fields: collection.fields, records: collection.records }
  }
  if (recordsEqual(collection.fields, collection.records, parsed.fields, parsed.records)) {
    return { status: 'unchanged', fields: collection.fields, records: collection.records }
  }
  return { status: 'updated', fields: parsed.fields, records: parsed.records }
}

/** Deep structural equality of a (fields, records) pair — the in-sync check. */
export function recordsEqual(
  aFields: string[],
  aRecords: CollectionRecord[],
  bFields: string[],
  bRecords: CollectionRecord[]
): boolean {
  if (aFields.length !== bFields.length) return false
  for (let i = 0; i < aFields.length; i++) if (aFields[i] !== bFields[i]) return false
  if (aRecords.length !== bRecords.length) return false
  for (let r = 0; r < aRecords.length; r++) {
    for (const f of aFields) {
      if (recordCell(aRecords[r], f) !== recordCell(bRecords[r], f)) return false
    }
  }
  return true
}

/** Normalizes an untrusted persisted collection, dropping anything malformed. */
function coerceCollection(raw: unknown): Collection | null {
  const c = raw as {
    id?: unknown
    name?: unknown
    fields?: unknown
    records?: unknown
    updatedAt?: unknown
    source?: unknown
  }
  if (typeof c?.id !== 'string' || typeof c?.name !== 'string') return null
  if (!Array.isArray(c.fields)) return null
  const fields = c.fields
    .filter((f): f is string => typeof f === 'string')
    .slice(0, COLLECTION_MAX_FIELDS)
  if (fields.length === 0) return null
  const rawRecords = Array.isArray(c.records) ? c.records : []
  const records: CollectionRecord[] = []
  for (const rr of rawRecords.slice(0, COLLECTION_MAX_RECORDS)) {
    const rec: CollectionRecord = {}
    for (const f of fields) rec[f] = coerceFieldValue((rr as CollectionRecord)?.[f])
    records.push(rec)
  }
  const collection: Collection = {
    id: c.id,
    name: c.name.slice(0, NAME_MAX),
    fields,
    records,
    updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : 0,
  }
  const source = coerceCollectionSource(c.source)
  if (source.kind === 'xlsx-range') collection.source = source
  return collection
}

export class CollectionStore {
  constructor(private file: () => string) {}

  // mtime+size-validated read-through cache (mirrors MetricStore/RangeStore): a
  // warm cache costs one fs.statSync instead of a full read+parse per
  // get/list/update, and stays coherent with a separate-process CLI. Keyed by
  // file path (app vs CLI differ).
  private cache: { file: string; mtimeMs: number; size: number; list: Collection[] } | null = null

  private load(): Collection[] {
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

    let out: Collection[]
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown
      out = []
      if (Array.isArray(parsed)) {
        for (const raw of parsed) {
          const coll = coerceCollection(raw)
          if (coll) out.push(coll)
        }
      }
    } catch {
      out = [] // nothing saved yet, or corrupt file — start fresh
    }
    this.cache = { file, mtimeMs, size, list: out }
    return out
  }

  private save(list: Collection[]): void {
    const file = this.file()
    try {
      fs.writeFileSync(file, JSON.stringify(list), 'utf-8')
      try {
        const st = fs.statSync(file)
        this.cache = { file, mtimeMs: st.mtimeMs, size: st.size, list }
      } catch {
        this.cache = null
      }
    } catch {
      // Best-effort — an unwritable userData dir shouldn't block the app.
      this.cache = null
    }
  }

  /** All collections, newest-updated first. Sorts a COPY (never mutates cache). */
  list(): Collection[] {
    return [...this.load()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): Collection | undefined {
    return this.load().find((c) => c.id === id)
  }

  /**
   * Creates a collection from an already-read (fields, records) pair. An empty
   * field list throws (never persists a schemaless collection).
   */
  create(name: string, fields: string[], records: CollectionRecord[], source?: unknown): Collection {
    const cleanFields = fields.filter((f) => typeof f === 'string' && f).slice(0, COLLECTION_MAX_FIELDS)
    if (cleanFields.length === 0) throw new Error('collection needs at least one field')
    const cleanRecords: CollectionRecord[] = records.slice(0, COLLECTION_MAX_RECORDS).map((rec) => {
      const out: CollectionRecord = {}
      for (const f of cleanFields) out[f] = coerceFieldValue(rec[f])
      return out
    })
    const collection: Collection = {
      id: newId(),
      name: name.trim().slice(0, NAME_MAX) || 'Untitled',
      fields: cleanFields,
      records: cleanRecords,
      updatedAt: Date.now(),
    }
    const src = coerceCollectionSource(source)
    if (src.kind === 'xlsx-range') collection.source = src
    this.save([collection, ...this.load()].slice(0, COLLECTIONS_MAX))
    return collection
  }

  /**
   * Patches name, the (fields, records) pair, and/or source; bumps updatedAt.
   * No-op for an unknown id. Passing `source` (even a literal one) DETACHES to a
   * literal set, keeping the current cached records.
   */
  update(
    id: string,
    patch: { name?: string; fields?: string[]; records?: CollectionRecord[]; source?: unknown }
  ): Collection | undefined {
    const list = this.load()
    const i = list.findIndex((c) => c.id === id)
    if (i < 0) return undefined
    const cur = list[i]
    const nextFields =
      patch.fields && patch.fields.length
        ? patch.fields.filter((f) => typeof f === 'string' && f).slice(0, COLLECTION_MAX_FIELDS)
        : cur.fields
    const nextRecords = patch.records
      ? patch.records.slice(0, COLLECTION_MAX_RECORDS).map((rec) => {
          const out: CollectionRecord = {}
          for (const f of nextFields) out[f] = coerceFieldValue(rec[f])
          return out
        })
      : cur.records
    const next: Collection = {
      ...cur,
      name: typeof patch.name === 'string' ? patch.name.trim().slice(0, NAME_MAX) || cur.name : cur.name,
      fields: nextFields,
      records: nextRecords,
      updatedAt: Date.now(),
    }
    if ('source' in patch) {
      const src = coerceCollectionSource(patch.source)
      if (src.kind === 'xlsx-range') next.source = src
      else delete next.source
    }
    list[i] = next
    this.save(list)
    return next
  }

  remove(id: string): void {
    this.save(this.load().filter((c) => c.id !== id))
  }
}

export const collections = new CollectionStore(() =>
  path.join(app.getPath('userData'), 'collections.json')
)
