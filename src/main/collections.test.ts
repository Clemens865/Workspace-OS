import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  CollectionStore,
  gridToRecords,
  planCollectionRefresh,
  recordsEqual,
  coerceCollectionSource,
  isSourcedCollection,
} from './collections'
import {
  renderMapping,
  coerceColumns,
  coerceCollectionTarget,
  planCollectionSyncAll,
  CollectionLinkStore,
} from './collectionLinks'

/**
 * Pure-core proof for collections (records→layout): grid→records interpretation,
 * the field-mapped render, the fail-safe refresh, and the sync-all planner. No
 * engine, no real files here — the disk-level proof lives in collection-sync.test.ts.
 */
describe('gridToRecords', () => {
  it('reads row 0 as fields and each subsequent row as a record', () => {
    const grid = [
      ['Name', 'Role', 'Rev'],
      ['Ana', 'Lead', 120],
      ['Bo', 'Eng', 90],
    ]
    const out = gridToRecords(grid)
    expect(out?.fields).toEqual(['Name', 'Role', 'Rev'])
    expect(out?.records).toEqual([
      { Name: 'Ana', Role: 'Lead', Rev: 120 },
      { Name: 'Bo', Role: 'Eng', Rev: 90 },
    ])
  })

  it('de-duplicates repeated headers and fills blank header cells', () => {
    const grid = [
      ['Rev', 'Rev', null],
      [1, 2, 3],
    ]
    const out = gridToRecords(grid)
    expect(out?.fields).toEqual(['Rev', 'Rev 2', 'Field 3'])
    expect(out?.records[0]).toEqual({ Rev: 1, 'Rev 2': 2, 'Field 3': 3 })
  })

  it('a header-only grid yields fields + zero records; empty grid → null', () => {
    expect(gridToRecords([['A', 'B']])).toEqual({ fields: ['A', 'B'], records: [] })
    expect(gridToRecords([])).toBeNull()
  })
})

describe('renderMapping (field-mapped repeated block)', () => {
  const fields = ['Name', 'Role', 'Rev']
  const records = [
    { Name: 'Ana', Role: 'Lead', Rev: 120 },
    { Name: 'Bo', Role: 'Eng', Rev: 90 },
  ]

  it('projects a chosen, ordered, re-headed subset of fields', () => {
    const grid = renderMapping(fields, records, [
      { field: 'Rev', header: 'Revenue' },
      { field: 'Name', header: 'Person' },
    ])
    expect(grid).toEqual([
      ['Revenue', 'Person'],
      [120, 'Ana'],
      [90, 'Bo'],
    ])
  })

  it('an unknown field renders as empty (never throws)', () => {
    const grid = renderMapping(fields, records, [{ field: 'Ghost', header: 'X' }])
    expect(grid).toEqual([['X'], [null], [null]])
  })
})

describe('planCollectionRefresh (fail-safe core)', () => {
  const src = { kind: 'xlsx-range' as const, filePath: '/x.xlsx', sheet: 'S', ref: 'A1:B3' }
  const base = {
    id: 'coll-1', name: 'C', fields: ['Name', 'Rev'], updatedAt: 0, source: src,
    records: [{ Name: 'Ana', Rev: 1 }],
  }

  it('literal collection is a no-op', () => {
    const lit = { ...base, source: undefined }
    expect(planCollectionRefresh(lit, { ok: true, values: [['x'], ['y']] }).status).toBe('literal')
  })

  it('unreadable source keeps the last records (stale, never blank)', () => {
    const plan = planCollectionRefresh(base, { ok: false })
    expect(plan.status).toBe('stale')
    expect(plan.records).toEqual(base.records) // cache preserved
  })

  it('a changed source produces updated fields + records', () => {
    const plan = planCollectionRefresh(base, {
      ok: true,
      values: [['Name', 'Rev'], ['Ana', 5], ['Bo', 9]],
    })
    expect(plan.status).toBe('updated')
    expect(plan.records).toEqual([{ Name: 'Ana', Rev: 5 }, { Name: 'Bo', Rev: 9 }])
  })

  it('an unchanged source reports unchanged', () => {
    const plan = planCollectionRefresh(base, { ok: true, values: [['Name', 'Rev'], ['Ana', 1]] })
    expect(plan.status).toBe('unchanged')
  })
})

describe('recordsEqual', () => {
  it('is order- and value-sensitive per mapped field', () => {
    const f = ['A', 'B']
    expect(recordsEqual(f, [{ A: 1, B: 2 }], f, [{ A: 1, B: 2 }])).toBe(true)
    expect(recordsEqual(f, [{ A: 1, B: 2 }], f, [{ A: 1, B: 3 }])).toBe(false)
    expect(recordsEqual(f, [{ A: 1, B: 2 }], ['A'], [{ A: 1 }])).toBe(false)
  })
})

describe('coerceCollectionSource / coerceColumns / coerceCollectionTarget', () => {
  it('normalizes a valid xlsx-range source; junk → literal', () => {
    expect(coerceCollectionSource({ kind: 'xlsx-range', filePath: '/a.xlsx', sheet: 'S', ref: 'A1:B2' }).kind).toBe('xlsx-range')
    expect(coerceCollectionSource({ kind: 'nope' }).kind).toBe('literal')
    expect(coerceCollectionSource(undefined).kind).toBe('literal')
  })

  it('columns need a field; a missing header defaults to the field name', () => {
    expect(coerceColumns([{ field: 'Rev' }])).toEqual([{ field: 'Rev', header: 'Rev' }])
    expect(coerceColumns([{ field: '', header: 'x' }])).toBeNull()
    expect(coerceColumns([])).toBeNull()
  })

  it('targets validate per kind (A1 cell / namespaced tag)', () => {
    expect(coerceCollectionTarget({ target: { kind: 'xlsx-block', sheet: 'S', cell: 'B2' } })).toEqual({ kind: 'xlsx-block', sheet: 'S', cell: 'B2' })
    expect(coerceCollectionTarget({ target: { kind: 'docx-table', tag: 'wos-collection-x' } })).toEqual({ kind: 'docx-table', tag: 'wos-collection-x' })
    expect(coerceCollectionTarget({ target: { kind: 'xlsx-block', cell: 'nope' } })).toBeNull()
  })
})

describe('planCollectionSyncAll', () => {
  it('partitions into open-skipped / unchanged / to-write, rendering the mapping', () => {
    const collection = {
      id: 'coll-1', name: 'C', fields: ['Name', 'Rev'], updatedAt: 0,
      records: [{ Name: 'Ana', Rev: 5 }],
    }
    const columns = [{ field: 'Name', header: 'Name' }, { field: 'Rev', header: 'Rev' }]
    const rendered = renderMapping(collection.fields, collection.records, columns)
    const links = [
      { id: 'clink-open', collectionId: 'coll-1', filePath: '/open.docx', target: { kind: 'docx-table' as const, tag: 'wos-collection-a' }, columns, lastGrid: [[null]] },
      { id: 'clink-sync', collectionId: 'coll-1', filePath: '/sync.docx', target: { kind: 'docx-table' as const, tag: 'wos-collection-b' }, columns, lastGrid: rendered },
      { id: 'clink-drift', collectionId: 'coll-1', filePath: '/drift.docx', target: { kind: 'docx-table' as const, tag: 'wos-collection-c' }, columns, lastGrid: [['Name', 'Rev'], ['old', 0]] },
    ]
    const plan = planCollectionSyncAll(links, collection, '/open.docx')
    expect(plan.openSkipped.map((l) => l.id)).toEqual(['clink-open'])
    expect(plan.unchanged.map((l) => l.id)).toEqual(['clink-sync'])
    expect(plan.toWrite.map((a) => a.link.id)).toEqual(['clink-drift'])
    expect(plan.toWrite[0].grid).toEqual(rendered)
  })
})

describe('CollectionStore (userData JSON store)', () => {
  it('create/list/update/detach/remove round-trip on a temp file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-coll-store-'))
    try {
      const store = new CollectionStore(() => path.join(dir, 'collections.json'))
      const c = store.create('Roster', ['Name', 'Rev'], [{ Name: 'Ana', Rev: 1 }], {
        kind: 'xlsx-range', filePath: '/a.xlsx', sheet: 'S', ref: 'A1:B2',
      })
      expect(store.list()).toHaveLength(1)
      expect(isSourcedCollection(store.get(c.id)!)).toBe(true)

      // Detach to a literal set (source: literal) keeps the records.
      const detached = store.update(c.id, { source: { kind: 'literal' } })
      expect(detached?.source).toBeUndefined()
      expect(detached?.records).toEqual([{ Name: 'Ana', Rev: 1 }])

      store.remove(c.id)
      expect(store.list()).toHaveLength(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('CollectionLinkStore (one-per-anchor upsert)', () => {
  it('upserts a link on its anchor + drops on remove', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-clink-store-'))
    try {
      const store = new CollectionLinkStore(() => path.join(dir, 'links.json'))
      const cols = [{ field: 'Name', header: 'Name' }]
      const a = store.add({ collectionId: 'coll-1', filePath: '/f.docx', target: { kind: 'docx-table', tag: 'wos-collection-x' }, columns: cols, lastGrid: [['Name'], ['Ana']] })
      // Same anchor (same tag) upserts — still one link.
      store.add({ collectionId: 'coll-1', filePath: '/f.docx', target: { kind: 'docx-table', tag: 'wos-collection-x' }, columns: cols, lastGrid: [['Name'], ['Bo']] })
      expect(store.forCollection('coll-1')).toHaveLength(1)
      store.remove(store.forCollection('coll-1')[0].id)
      expect(store.allLinks()).toHaveLength(0)
      expect(a.id).toMatch(/^clink-/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
