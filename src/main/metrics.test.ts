import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  MetricStore,
  coerceValue,
  coerceSource,
  isSourced,
  planRefresh,
  METRICS_MAX,
  type Metric,
} from './metrics'

describe('MetricStore', () => {
  let dir: string
  let store: MetricStore
  const file = (): string => path.join(dir, 'metrics.json')

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-metric-'))
    store = new MetricStore(file)
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('creates, lists and gets a metric', () => {
    const m = store.create('Q3 Revenue', 23.4)
    expect(m.id).toMatch(/^metric-/)
    expect(m.value).toBe(23.4)
    const list = store.list()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Q3 Revenue')
    expect(store.get(m.id)?.value).toBe(23.4)
  })

  it('updates name and value, bumping updatedAt', () => {
    const m = store.create('Q3 Revenue', 23.4)
    const before = m.updatedAt
    const next = store.update(m.id, { value: 21.9 })
    expect(next?.value).toBe(21.9)
    expect(next?.name).toBe('Q3 Revenue') // unchanged
    expect(next!.updatedAt).toBeGreaterThanOrEqual(before)
    // value-only update leaves the name; name-only leaves the value
    const renamed = store.update(m.id, { name: 'Q3 Rev' })
    expect(renamed?.name).toBe('Q3 Rev')
    expect(renamed?.value).toBe(21.9)
  })

  it('update on an unknown id is a no-op returning undefined', () => {
    expect(store.update('metric-nope', { value: 1 })).toBeUndefined()
  })

  it('removes by id', () => {
    const m = store.create('Temp', 1)
    store.remove(m.id)
    expect(store.list()).toHaveLength(0)
  })

  it('coerces non-finite values to 0 (never corrupt)', () => {
    expect(coerceValue(NaN)).toBe(0)
    expect(coerceValue(Infinity)).toBe(0)
    expect(coerceValue('7' as unknown)).toBe(0)
    expect(coerceValue(5)).toBe(5)
    expect(store.create('Bad', NaN).value).toBe(0)
  })

  it('survives a corrupt file and recovers', () => {
    store.create('One', 1)
    fs.writeFileSync(file(), '{not json', 'utf-8')
    expect(store.list()).toEqual([])
    const m = store.create('Fresh', 2)
    expect(store.list()).toHaveLength(1)
    expect(store.get(m.id)?.value).toBe(2)
  })

  it('caps the list at METRICS_MAX', () => {
    for (let i = 0; i < METRICS_MAX + 5; i++) store.create(`m${i}`, i)
    expect(store.list()).toHaveLength(METRICS_MAX)
  })

  // ---- source-linked metrics (value read live from a real cell) ----

  const xlsxSource = { kind: 'xlsx-cell' as const, filePath: '/m/Model.xlsx', sheet: 'Summary', cell: 'B4' }

  it('creates a sourced metric and persists its source', () => {
    const m = store.create('Revenue', 1250, xlsxSource)
    expect(isSourced(m)).toBe(true)
    const loaded = store.get(m.id)!
    expect(loaded.source).toEqual(xlsxSource)
    expect(loaded.value).toBe(1250) // cached value
  })

  it('BACK-COMPAT: a metric with no source loads as a literal', () => {
    const m = store.create('Legacy', 5)
    const loaded = store.get(m.id)!
    expect(loaded.source).toBeUndefined()
    expect(isSourced(loaded)).toBe(false)
  })

  it('BACK-COMPAT: an on-disk metric missing the source field loads cleanly', () => {
    // Simulate a pre-feature metrics.json (no `source` key at all).
    fs.writeFileSync(
      file(),
      JSON.stringify([{ id: 'metric-old', name: 'Old', value: 7, updatedAt: 1 }]),
      'utf-8',
    )
    const loaded = store.get('metric-old')!
    expect(loaded.value).toBe(7)
    expect(loaded.source).toBeUndefined()
  })

  it('DETACH: patching source to literal drops the source, keeps the value', () => {
    const m = store.create('Revenue', 1250, xlsxSource)
    const detached = store.update(m.id, { source: { kind: 'literal' } })
    expect(detached?.source).toBeUndefined()
    expect(detached?.value).toBe(1250) // value preserved
  })

  it('coerceSource normalizes/validates the source shape', () => {
    expect(coerceSource(xlsxSource)).toEqual(xlsxSource)
    expect(coerceSource({ kind: 'literal' })).toBeUndefined()
    expect(coerceSource(undefined)).toBeUndefined()
    expect(coerceSource({ kind: 'xlsx-cell', filePath: '', sheet: 'S', cell: 'B4' })).toBeUndefined()
    expect(coerceSource({ kind: 'xlsx-cell', filePath: '/f.xlsx', cell: 'B4' })).toEqual({
      kind: 'xlsx-cell', filePath: '/f.xlsx', sheet: '', cell: 'B4',
    })
  })
})

describe('planRefresh (source-linked refresh decision)', () => {
  const sourced = (value: number): Metric => ({
    id: 'metric-1', name: 'Revenue', value, updatedAt: 0,
    source: { kind: 'xlsx-cell', filePath: '/m.xlsx', sheet: 'S', cell: 'B4' },
  })
  const literal = (value: number): Metric => ({ id: 'metric-2', name: 'Lit', value, updatedAt: 0 })

  it('literal metric → literal (no source to read)', () => {
    expect(planRefresh(literal(5), { ok: true, value: 9 })).toEqual({ status: 'literal', value: 5 })
  })

  it('read failed → stale, keeps the cached value', () => {
    expect(planRefresh(sourced(100), { ok: false })).toEqual({ status: 'stale', value: 100 })
  })

  it('read ok but unchanged → unchanged', () => {
    expect(planRefresh(sourced(100), { ok: true, value: 100 })).toEqual({ status: 'unchanged', value: 100 })
  })

  it('read ok and changed → updated with the new value', () => {
    expect(planRefresh(sourced(100), { ok: true, value: 250 })).toEqual({ status: 'updated', value: 250 })
  })

  it('read ok but non-finite value → stale (never corrupts)', () => {
    expect(planRefresh(sourced(100), { ok: true, value: Infinity })).toEqual({ status: 'stale', value: 100 })
  })
})

describe('MetricStore read-through cache (invalidated on write)', () => {
  let dir: string
  let store: MetricStore
  const file = (): string => path.join(dir, 'metrics.json')

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-metric-cache-'))
    store = new MetricStore(file)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('does not re-read the file on repeated list/get after one read (cache hit)', () => {
    store.create('A', 1) // populates the cache via save()
    const spy = vi.spyOn(fs, 'readFileSync')
    // Many reads — none should touch disk while the cache is warm.
    store.list()
    store.list()
    store.get('nope')
    store.list()
    expect(spy).not.toHaveBeenCalled()
  })

  it('a write invalidates the cache so subsequent reads see the new value', () => {
    const m = store.create('Revenue', 10)
    expect(store.get(m.id)?.value).toBe(10)
    store.update(m.id, { value: 42 })
    // Same in-process store: the update must be visible without a stale cache.
    expect(store.get(m.id)?.value).toBe(42)
    store.remove(m.id)
    expect(store.get(m.id)).toBeUndefined()
    expect(store.list()).toEqual([])
  })

  it('reads exactly once for a cold cache, then serves N reads from memory', () => {
    store.create('A', 1)
    // New store instance = cold cache; first load reads disk once, rest are hits.
    const fresh = new MetricStore(file)
    const spy = vi.spyOn(fs, 'readFileSync')
    fresh.list() // 1 disk read to warm the cache
    fresh.list()
    fresh.get('x')
    fresh.list()
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
