/**
 * Pure helpers for collections in the renderer (no React, no DOM) — the
 * records→layout sibling of rangesView.ts. renderMapping mirrors
 * src/main/collectionLinks.ts so the renderer's live-insert grid matches exactly
 * what the closed-file sync writes. Side-effect-free + unit-testable.
 */
import type {
  Collection,
  CollectionLink,
  CollectionRecord,
  CollectionView,
  FieldColumn,
  FieldValue,
  RangeGrid,
  ViewFilter,
  ViewOp,
  ViewSort,
} from '../types/workspace-api'

/** Known filter/sort ops (mirrors VIEW_OPS in src/main/collectionLinks.ts). */
export const VIEW_OPS: readonly ViewOp[] = ['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte']
export const VIEW_LIMIT_MAX = 500

/** Renders a record's value for one field as a display cell (missing → null). */
export function recordCell(record: CollectionRecord, field: string): FieldValue {
  const v = record[field]
  return v === undefined ? null : v
}

/** The default identity mapping: every field a column, header = field name. */
export function defaultColumns(fields: string[]): FieldColumn[] {
  return fields.map((f) => ({ field: f, header: f }))
}

/**
 * Renders a collection's records through a mapping into a 2D grid — ROW 0 the
 * display headers, then one row per record. Mirrors renderMapping in
 * src/main/collectionLinks.ts (must stay byte-identical to what sync writes).
 */
export function renderMapping(
  fields: string[],
  records: CollectionRecord[],
  columns: FieldColumn[]
): RangeGrid {
  const known = new Set(fields)
  const header = columns.map((c) => c.header)
  const rows: RangeGrid = [header]
  for (const rec of records) {
    rows.push(columns.map((c) => (known.has(c.field) ? recordCell(rec, c.field) : null)))
  }
  return rows
}

/** Evaluates one filter against a record (mirrors src/main/collectionLinks.ts). */
function passesFilter(rec: CollectionRecord, f: ViewFilter): boolean {
  const cell = recordCell(rec, f.field)
  const { op, value } = f
  if (op === 'contains') {
    if (cell === null) return false
    return String(cell).toLowerCase().includes(String(value).toLowerCase())
  }
  const numeric = typeof cell === 'number' && typeof value === 'number'
  if (op === 'eq' || op === 'neq') {
    const eq = numeric ? cell === value : String(cell ?? '') === String(value)
    return op === 'eq' ? eq : !eq
  }
  const cmp = numeric
    ? (cell as number) - (value as number)
    : String(cell ?? '').localeCompare(String(value))
  if (op === 'gt') return cmp > 0
  if (op === 'gte') return cmp >= 0
  if (op === 'lt') return cmp < 0
  return cmp <= 0
}

function compareBy(a: CollectionRecord, b: CollectionRecord, key: ViewSort): number {
  const av = recordCell(a, key.field)
  const bv = recordCell(b, key.field)
  let cmp: number
  if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv
  else cmp = String(av ?? '').localeCompare(String(bv ?? ''))
  return key.dir === 'desc' ? -cmp : cmp
}

/**
 * Applies a live view (filter → stable sort → limit) over records, BEFORE the
 * column projection. Mirrors applyView in src/main/collectionLinks.ts so the
 * renderer's insert-preview grid matches exactly what the closed-file sync
 * writes. Fail-safe: an empty/undefined view is the identity; never throws.
 */
export function applyView(records: CollectionRecord[], view?: CollectionView): CollectionRecord[] {
  if (!view || (!view.filters?.length && !view.sort?.length && view.limit === undefined)) {
    return records
  }
  let out = records
  if (view.filters?.length) {
    out = out.filter((rec) => view.filters!.every((f) => passesFilter(rec, f)))
  }
  if (view.sort?.length) {
    out = out
      .map((rec, i) => ({ rec, i }))
      .sort((x, y) => {
        for (const key of view.sort!) {
          const c = compareBy(x.rec, y.rec, key)
          if (c !== 0) return c
        }
        return x.i - y.i
      })
      .map((d) => d.rec)
  }
  if (view.limit !== undefined) {
    out = out.slice(0, Math.max(0, Math.min(Math.floor(view.limit), VIEW_LIMIT_MAX)))
  }
  return out
}

/** The full rendered grid for a collection with its default identity mapping. */
export function defaultGrid(collection: Collection): RangeGrid {
  return renderMapping(collection.fields, collection.records, defaultColumns(collection.fields))
}

/** The rendered grid for a collection through a view + default mapping. */
export function viewedGrid(collection: Collection, view?: CollectionView): RangeGrid {
  const viewed = applyView(collection.records, view)
  return renderMapping(collection.fields, viewed, defaultColumns(collection.fields))
}

/** "12 records · 3 fields" summary label for a collection. */
export function summaryLabel(collection: Collection): string {
  const r = collection.records.length
  const f = collection.fields.length
  return `${r} record${r === 1 ? '' : 's'} · ${f} field${f === 1 ? '' : 's'}`
}

/** How many links each collection has, keyed by collectionId. */
export function countByCollection(links: CollectionLink[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const link of links) counts.set(link.collectionId, (counts.get(link.collectionId) ?? 0) + 1)
  return counts
}
