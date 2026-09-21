import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  coerceRangeTarget,
  isSelfSourceRangeLink,
  rangeResyncDecisions,
  planRangeSyncAll,
  rangeTargetKey,
  RangeLinkStore,
  type RangeLink,
} from './rangeLinks'
import type { LiveRange, RangeSource } from './ranges'

const range = (over: Partial<LiveRange> = {}): LiveRange => ({
  id: 'range-1',
  name: 'KPIs',
  values: [[1, 2], ['a', null]],
  updatedAt: 0,
  ...over,
})

const link = (over: Partial<RangeLink> = {}): RangeLink => ({
  id: 'rlink-1',
  rangeId: 'range-1',
  filePath: '/doc.xlsx',
  target: { kind: 'xlsx-block', sheet: 'Sheet1', cell: 'E1' },
  lastValues: [[1, 2], ['a', null]],
  ...over,
})

describe('coerceRangeTarget', () => {
  it('accepts a valid xlsx-block target', () => {
    expect(coerceRangeTarget({ target: { kind: 'xlsx-block', sheet: 'S', cell: 'B2' } }))
      .toEqual({ kind: 'xlsx-block', sheet: 'S', cell: 'B2' })
  })
  it('accepts docx-table and pptx-table targets (the cross-app kinds)', () => {
    expect(coerceRangeTarget({ target: { kind: 'docx-table', tag: 'wos-range-1-ab' } }))
      .toEqual({ kind: 'docx-table', tag: 'wos-range-1-ab' })
    expect(coerceRangeTarget({ target: { kind: 'pptx-table', tag: 'wos-range-1-ab', slide: 2 } }))
      .toEqual({ kind: 'pptx-table', tag: 'wos-range-1-ab', slide: 2 })
    // slide is optional.
    expect(coerceRangeTarget({ target: { kind: 'pptx-table', tag: 'wos-range-1-ab' } }))
      .toEqual({ kind: 'pptx-table', tag: 'wos-range-1-ab' })
  })
  it('rejects a bad kind, missing cell/tag, or malformed A1', () => {
    expect(coerceRangeTarget({ target: { kind: 'xlsx-cell', sheet: 'S', cell: 'B2' } })).toBeNull()
    expect(coerceRangeTarget({ target: { kind: 'xlsx-block', sheet: 'S' } })).toBeNull()
    expect(coerceRangeTarget({ target: { kind: 'xlsx-block', sheet: 'S', cell: 'B0' } })).toBeNull()
    expect(coerceRangeTarget({ target: { kind: 'docx-table' } })).toBeNull()
    expect(coerceRangeTarget({ target: { kind: 'pptx-table', tag: '' } })).toBeNull()
    expect(coerceRangeTarget(undefined)).toBeNull()
  })
})

describe('rangeTargetKey (one-per-anchor identity)', () => {
  it('is distinct per kind and per tag/cell', () => {
    const block = rangeTargetKey('/f', { kind: 'xlsx-block', sheet: 'S', cell: 'E1' })
    const doc = rangeTargetKey('/f', { kind: 'docx-table', tag: 'wos-range-1' })
    const ppt = rangeTargetKey('/f', { kind: 'pptx-table', tag: 'wos-range-1' })
    expect(new Set([block, doc, ppt]).size).toBe(3)
    // A pptx-table key ignores slide (the frame Name is the identity).
    expect(rangeTargetKey('/f', { kind: 'pptx-table', tag: 'wos-range-1', slide: 3 })).toBe(ppt)
  })
})

describe('isSelfSourceRangeLink (overlap guard)', () => {
  const source: RangeSource = { kind: 'xlsx-range', filePath: '/doc.xlsx', sheet: 'Sheet1', ref: 'A1:B2' }
  const grid = [[1, 2], [3, 4]] // written block is 2×2

  it('detects a block overlapping its own source rectangle', () => {
    // Anchor B2 → block covers B2:C3, overlapping source A1:B2 at B2.
    expect(isSelfSourceRangeLink(source, '/doc.xlsx', { kind: 'xlsx-block', sheet: 'Sheet1', cell: 'B2' }, grid)).toBe(true)
    expect(isSelfSourceRangeLink(source, '/doc.xlsx', { kind: 'xlsx-block', sheet: 'Sheet1', cell: 'A1' }, grid)).toBe(true)
  })

  it('a disjoint block, another sheet, or another file is not self-referential', () => {
    expect(isSelfSourceRangeLink(source, '/doc.xlsx', { kind: 'xlsx-block', sheet: 'Sheet1', cell: 'C3' }, grid)).toBe(false)
    expect(isSelfSourceRangeLink(source, '/doc.xlsx', { kind: 'xlsx-block', sheet: 'Sheet2', cell: 'A1' }, grid)).toBe(false)
    expect(isSelfSourceRangeLink(source, '/other.xlsx', { kind: 'xlsx-block', sheet: 'Sheet1', cell: 'A1' }, grid)).toBe(false)
  })

  it('a literal range (no source) is never self-referential', () => {
    expect(isSelfSourceRangeLink(undefined, '/doc.xlsx', { kind: 'xlsx-block', sheet: 'Sheet1', cell: 'A1' }, grid)).toBe(false)
  })

  it('a docx/pptx TABLE anchor can never be self-referential (different file kind)', () => {
    expect(isSelfSourceRangeLink(source, '/doc.xlsx', { kind: 'docx-table', tag: 'wos-range-1' }, grid)).toBe(false)
    expect(isSelfSourceRangeLink(source, '/doc.xlsx', { kind: 'pptx-table', tag: 'wos-range-1' }, grid)).toBe(false)
  })
})

describe('rangeResyncDecisions (fail-safe core)', () => {
  it('missing range → NO action (block keeps its last literals)', () => {
    expect(rangeResyncDecisions([link()], () => undefined)).toEqual([])
  })

  it('grid unchanged → no action; grid changed → one write action', () => {
    const r = range()
    expect(rangeResyncDecisions([link()], () => r)).toEqual([])
    const changed = range({ values: [[9, 2], ['a', null]] })
    const actions = rangeResyncDecisions([link()], () => changed)
    expect(actions).toHaveLength(1)
    expect(actions[0].values).toEqual([[9, 2], ['a', null]])
  })

  it('never writes a sourced range back over its own source block', () => {
    const r = range({
      values: [[9, 9], [9, 9]],
      source: { kind: 'xlsx-range', filePath: '/doc.xlsx', sheet: 'Sheet1', ref: 'E1:F2' },
    })
    // The link's anchor E1 IS the source rectangle → skipped despite the drift.
    expect(rangeResyncDecisions([link()], () => r)).toEqual([])
  })
})

describe('planRangeSyncAll', () => {
  it('partitions open / in-sync / self-source / to-write', () => {
    const r = range({
      values: [[9]],
      source: { kind: 'xlsx-range', filePath: '/src.xlsx', sheet: 'S', ref: 'A1' },
    })
    const openL = link({ id: 'rlink-open', filePath: '/open.xlsx' })
    const syncedL = link({ id: 'rlink-sync', filePath: '/b.xlsx', lastValues: [[9]] })
    const selfL = link({ id: 'rlink-self', filePath: '/src.xlsx', target: { kind: 'xlsx-block', sheet: 'S', cell: 'A1' } })
    const staleL = link({ id: 'rlink-stale', filePath: '/c.xlsx', lastValues: [[1]] })
    const plan = planRangeSyncAll([openL, syncedL, selfL, staleL], r, '/open.xlsx')
    expect(plan.openSkipped.map((l) => l.id)).toEqual(['rlink-open'])
    expect(plan.unchanged.map((l) => l.id)).toEqual(['rlink-sync'])
    expect(plan.selfSkipped.map((l) => l.id)).toEqual(['rlink-self'])
    expect(plan.toWrite.map((l) => l.id)).toEqual(['rlink-stale'])
  })
})

describe('RangeLinkStore', () => {
  let dir: string
  let store: RangeLinkStore
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-rlinks-'))
    store = new RangeLinkStore(() => path.join(dir, 'links.json'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('adds, persists and reloads a link', () => {
    const l = store.add({
      rangeId: 'range-1',
      filePath: '/doc.xlsx',
      target: { kind: 'xlsx-block', sheet: 'S', cell: 'E1' },
      lastValues: [[1, 'a']],
    })
    const fresh = new RangeLinkStore(() => path.join(dir, 'links.json'))
    expect(fresh.forFile('/doc.xlsx')).toEqual([l])
    expect(fresh.forRange('range-1')).toEqual([l])
  })

  it('adds a docx-table and a pptx-table link (the cross-app kinds persist)', () => {
    const d = store.add({ rangeId: 'range-1', filePath: '/r.docx', target: { kind: 'docx-table', tag: 'wos-range-1-a' }, lastValues: [[1, 'a']] })
    const p = store.add({ rangeId: 'range-1', filePath: '/r.pptx', target: { kind: 'pptx-table', tag: 'wos-range-1-b', slide: 0 }, lastValues: [[1, 'a']] })
    const fresh = new RangeLinkStore(() => path.join(dir, 'links.json'))
    expect(fresh.forFile('/r.docx')).toEqual([d])
    expect(fresh.forFile('/r.pptx')).toEqual([p])
    expect(fresh.forRange('range-1')).toHaveLength(2)
  })

  it('upserts one-per-anchor (same file+sheet+cell replaces)', () => {
    store.add({ rangeId: 'range-1', filePath: '/d.xlsx', target: { kind: 'xlsx-block', sheet: 'S', cell: 'E1' }, lastValues: [[1]] })
    store.add({ rangeId: 'range-2', filePath: '/d.xlsx', target: { kind: 'xlsx-block', sheet: 'S', cell: 'E1' }, lastValues: [[2]] })
    const all = store.allLinks()
    expect(all).toHaveLength(1)
    expect(all[0].rangeId).toBe('range-2')
    expect(all[0].lastValues).toEqual([[2]])
  })

  it('throws on a bad target or grid, persisting nothing', () => {
    expect(() => store.add({ rangeId: 'range-1', filePath: '/d.xlsx', target: { kind: 'xlsx-block', sheet: 'S', cell: '??' }, lastValues: [[1]] })).toThrow()
    expect(() => store.add({ rangeId: 'range-1', filePath: '/d.xlsx', target: { kind: 'xlsx-block', sheet: 'S', cell: 'A1' }, lastValues: [[1], [1, 2]] })).toThrow()
    expect(store.allLinks()).toEqual([])
  })

  it('drops corrupt records on load (fail-safe)', () => {
    fs.writeFileSync(path.join(dir, 'links.json'), JSON.stringify([
      { id: 'rlink-ok', rangeId: 'range-1', filePath: '/d.xlsx', target: { kind: 'xlsx-block', sheet: 'S', cell: 'A1' }, lastValues: [[1]] },
      { id: 'rlink-bad', rangeId: 'range-1', filePath: '/d.xlsx', target: { kind: 'xlsx-block', sheet: 'S', cell: 'A1' }, lastValues: 'nope' },
      { id: 42 },
    ]), 'utf-8')
    expect(store.allLinks().map((l) => l.id)).toEqual(['rlink-ok'])
  })
})
