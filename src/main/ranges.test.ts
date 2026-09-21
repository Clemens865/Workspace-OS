import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  parseRangeRef,
  refString,
  a1Of,
  colLetters,
  coerceGrid,
  gridsEqual,
  coerceRangeSource,
  planRangeRefresh,
  encodeGridPayload,
  encodeTablePayload,
  RangeStore,
  RANGE_MAX_ROWS,
  type LiveRange,
} from './ranges'

describe('parseRangeRef / refString', () => {
  it('parses a rectangular ref into 0-based bounds', () => {
    expect(parseRangeRef('A1:C4')).toEqual({ startCol: 0, startRow: 0, rows: 4, cols: 3 })
    expect(parseRangeRef('b2:d3')).toEqual({ startCol: 1, startRow: 1, rows: 2, cols: 3 })
  })

  it('accepts a single cell as a 1×1 range', () => {
    expect(parseRangeRef('B2')).toEqual({ startCol: 1, startRow: 1, rows: 1, cols: 1 })
  })

  it('normalizes reversed corners', () => {
    expect(parseRangeRef('C4:A1')).toEqual({ startCol: 0, startRow: 0, rows: 4, cols: 3 })
  })

  it('rejects malformed and oversized refs', () => {
    for (const bad of ['', 'A0:B2', '1A', 'A1:B2:C3', 'A1:', 'A1:ZZZ9999999', 'A1:B999']) {
      expect(parseRangeRef(bad)).toBeNull()
    }
  })

  it('round-trips through refString (canonical form)', () => {
    expect(refString(parseRangeRef('c4:a1')!)).toBe('A1:C4')
    expect(refString(parseRangeRef('b2')!)).toBe('B2')
  })

  it('col letters cover the AA boundary', () => {
    expect(colLetters(0)).toBe('A')
    expect(colLetters(25)).toBe('Z')
    expect(a1Of(26, 0)).toBe('AA1')
  })
})

describe('coerceGrid / gridsEqual', () => {
  it('passes a rectangular grid through, coercing cells', () => {
    expect(coerceGrid([[1, 'a'], [null, 2.5]])).toEqual([[1, 'a'], [null, 2.5]])
    expect(coerceGrid([[NaN, Infinity, true, {}]])).toEqual([[null, null, null, null]])
  })

  it('rejects ragged, empty, and oversized grids', () => {
    expect(coerceGrid([])).toBeNull()
    expect(coerceGrid([[1], [1, 2]])).toBeNull()
    expect(coerceGrid('nope')).toBeNull()
    expect(coerceGrid(Array.from({ length: RANGE_MAX_ROWS + 1 }, () => [1]))).toBeNull()
  })

  it('gridsEqual compares by value and shape', () => {
    expect(gridsEqual([[1, 'a']], [[1, 'a']])).toBe(true)
    expect(gridsEqual([[1]], [[2]])).toBe(false)
    expect(gridsEqual([[1]], [[1], [1]])).toBe(false)
    expect(gridsEqual([[1]], [[1, 1]])).toBe(false)
  })
})

describe('coerceRangeSource', () => {
  it('normalizes a valid source (canonical ref)', () => {
    expect(coerceRangeSource({ kind: 'xlsx-range', filePath: '/x.xlsx', sheet: 'S', ref: 'c4:a1' }))
      .toEqual({ kind: 'xlsx-range', filePath: '/x.xlsx', sheet: 'S', ref: 'A1:C4' })
  })

  it('anything invalid → undefined (literal)', () => {
    expect(coerceRangeSource(undefined)).toBeUndefined()
    expect(coerceRangeSource({ kind: 'literal' })).toBeUndefined()
    expect(coerceRangeSource({ kind: 'xlsx-range', filePath: '', ref: 'A1:B2' })).toBeUndefined()
    expect(coerceRangeSource({ kind: 'xlsx-range', filePath: '/x.xlsx', ref: 'bogus' })).toBeUndefined()
  })
})

describe('planRangeRefresh (fail-safe core)', () => {
  const sourced: LiveRange = {
    id: 'range-1',
    name: 'KPIs',
    values: [[1, 2]],
    updatedAt: 0,
    source: { kind: 'xlsx-range', filePath: '/x.xlsx', sheet: 'S', ref: 'A1:B1' },
  }

  it('a literal range is a no-op', () => {
    const literal: LiveRange = { id: 'range-2', name: 'L', values: [[1]], updatedAt: 0 }
    expect(planRangeRefresh(literal, { ok: true, values: [[9]] })).toEqual({ status: 'literal', values: [[1]] })
  })

  it('a failed read keeps the cached grid (stale — never blanks)', () => {
    expect(planRangeRefresh(sourced, { ok: false })).toEqual({ status: 'stale', values: [[1, 2]] })
    expect(planRangeRefresh(sourced, { ok: true, values: undefined })).toEqual({ status: 'stale', values: [[1, 2]] })
  })

  it('same grid → unchanged; different grid → updated with the new values', () => {
    expect(planRangeRefresh(sourced, { ok: true, values: [[1, 2]] }).status).toBe('unchanged')
    expect(planRangeRefresh(sourced, { ok: true, values: [[1, 3]] })).toEqual({ status: 'updated', values: [[1, 3]] })
  })
})

describe('encodeGridPayload (WosSetRangeBlock format)', () => {
  it('encodes numbers, strings and empties with a header line', () => {
    expect(encodeGridPayload('Sheet1', 'E2', [[1.5, 'Rev'], [null, -2]]))
      .toBe('Sheet1|E2\nn:1.5\ts:Rev\ne\tn:-2\n')
  })

  it('flattens delimiter characters inside texts and sheet names', () => {
    expect(encodeGridPayload('My|Sheet', 'A1', [['a\tb\nc']]))
      .toBe('My Sheet|A1\ns:a b c\n')
  })
})

describe('encodeTablePayload (WosSetDocTable / WosSetSlideTable format)', () => {
  it('encodes plain cell text (numbers stringified, empties blank) after the tag', () => {
    expect(encodeTablePayload('wos-range-1-ab', [['Region', 'Rev'], ['EMEA', 12.5], [null, 7]]))
      .toBe('wos-range-1-ab\nRegion\tRev\nEMEA\t12.5\n\t7\n')
  })

  it('flattens delimiter characters inside texts', () => {
    expect(encodeTablePayload('wos-range-1', [['a\tb\nc', 'x']]))
      .toBe('wos-range-1\na b c\tx\n')
  })
})

describe('RangeStore', () => {
  let dir: string
  let store: RangeStore
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-ranges-'))
    store = new RangeStore(() => path.join(dir, 'ranges.json'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('creates, persists and reloads a sourced range', () => {
    const r = store.create('KPIs', [[1, 'a'], [null, 2]], {
      kind: 'xlsx-range', filePath: '/x.xlsx', sheet: 'S', ref: 'a1:b2',
    })
    const fresh = new RangeStore(() => path.join(dir, 'ranges.json'))
    expect(fresh.get(r.id)).toMatchObject({
      name: 'KPIs',
      values: [[1, 'a'], [null, 2]],
      source: { kind: 'xlsx-range', ref: 'A1:B2' },
    })
  })

  it('rejects an invalid grid at create (never persists a bad range)', () => {
    expect(() => store.create('bad', [[1], [1, 2]])).toThrow()
    expect(store.list()).toHaveLength(0)
  })

  it('update patches values and detaches source via a literal patch', () => {
    const r = store.create('K', [[1]], { kind: 'xlsx-range', filePath: '/x.xlsx', sheet: '', ref: 'A1' })
    store.update(r.id, { values: [[2]] })
    expect(store.get(r.id)!.values).toEqual([[2]])
    store.update(r.id, { source: { kind: 'literal' } })
    expect(store.get(r.id)!.source).toBeUndefined()
    expect(store.get(r.id)!.values).toEqual([[2]]) // detaching keeps the cache
  })

  it('survives a corrupt store file (starts fresh)', () => {
    fs.writeFileSync(path.join(dir, 'ranges.json'), '{nope', 'utf-8')
    expect(store.list()).toEqual([])
  })
})
