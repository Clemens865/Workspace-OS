import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  TransclusionStore,
  resyncDecisions,
  planSyncAll,
  parseA1,
  isValidA1,
  coerceTarget,
  targetKey,
  isSelfSourceLink,
  type Link,
} from './transclusions'
import type { Metric } from './metrics'

describe('parseA1', () => {
  it('parses A1 addresses to 0-based col/row', () => {
    expect(parseA1('A1')).toEqual({ col: 0, row: 0 })
    expect(parseA1('B2')).toEqual({ col: 1, row: 1 })
    expect(parseA1('Z10')).toEqual({ col: 25, row: 9 })
    expect(parseA1('AA1')).toEqual({ col: 26, row: 0 })
    expect(parseA1(' c3 ')).toEqual({ col: 2, row: 2 })
  })

  it('rejects malformed addresses', () => {
    expect(parseA1('')).toBeNull()
    expect(parseA1('1A')).toBeNull()
    expect(parseA1('A0')).toBeNull()
    expect(parseA1('A')).toBeNull()
    expect(parseA1('B2:C3')).toBeNull()
    expect(isValidA1('B2')).toBe(true)
    expect(isValidA1('nope')).toBe(false)
  })
})

const metric = (id: string, value: number): Metric => ({ id, name: id, value, updatedAt: 1 })

describe('coerceTarget (anchor normalization + back-compat)', () => {
  it('accepts the new discriminated xlsx-cell + docx-cc targets', () => {
    expect(coerceTarget({ target: { kind: 'xlsx-cell', sheet: 'Sheet1', cell: 'B2' } })).toEqual({
      kind: 'xlsx-cell', sheet: 'Sheet1', cell: 'B2',
    })
    expect(coerceTarget({ target: { kind: 'docx-cc', tag: 'wos-metric-x' } })).toEqual({
      kind: 'docx-cc', tag: 'wos-metric-x',
    })
  })

  it('normalizes a LEGACY flat {sheet, cell} record to kind:xlsx-cell', () => {
    expect(coerceTarget({ sheet: 'Sheet1', cell: 'A1' })).toEqual({ kind: 'xlsx-cell', sheet: 'Sheet1', cell: 'A1' })
    expect(coerceTarget({ cell: 'C3' })).toEqual({ kind: 'xlsx-cell', sheet: '', cell: 'C3' })
  })

  it('accepts a flat {tag} as docx-cc, and rejects garbage', () => {
    expect(coerceTarget({ tag: 'wos-metric-y' })).toEqual({ kind: 'docx-cc', tag: 'wos-metric-y' })
    expect(coerceTarget({ cell: 'nope' })).toBeNull()
    expect(coerceTarget({})).toBeNull()
    expect(coerceTarget(null)).toBeNull()
  })

  it('accepts the discriminated pptx-shape target, with/without an optional slide', () => {
    expect(coerceTarget({ target: { kind: 'pptx-shape', tag: 'wos-metric-p' } })).toEqual({
      kind: 'pptx-shape', tag: 'wos-metric-p',
    })
    expect(coerceTarget({ target: { kind: 'pptx-shape', tag: 'wos-metric-p', slide: 2 } })).toEqual({
      kind: 'pptx-shape', tag: 'wos-metric-p', slide: 2,
    })
    // a non-finite / non-numeric slide is dropped (never a corrupt anchor)
    expect(coerceTarget({ target: { kind: 'pptx-shape', tag: 'wos-metric-p', slide: NaN } })).toEqual({
      kind: 'pptx-shape', tag: 'wos-metric-p',
    })
    expect(coerceTarget({ target: { kind: 'pptx-shape', tag: '' } })).toBeNull()
  })

  it('targetKey is one-per-anchor and distinguishes the three kinds', () => {
    expect(targetKey('/w/a.xlsx', { kind: 'xlsx-cell', sheet: 'S', cell: 'A1' })).toBe('x|/w/a.xlsx|S|A1')
    expect(targetKey('/w/a.docx', { kind: 'docx-cc', tag: 't' })).toBe('d|/w/a.docx|t')
    expect(targetKey('/w/a.pptx', { kind: 'pptx-shape', tag: 't' })).toBe('p|/w/a.pptx|t')
    // slide is not part of the identity — same tag in a file is the same anchor
    expect(targetKey('/w/a.pptx', { kind: 'pptx-shape', tag: 't', slide: 5 })).toBe('p|/w/a.pptx|t')
  })
})

describe('resyncDecisions (fail-safe core)', () => {
  const link = (metricId: string, lastValue: number, cell = 'B2'): Link => ({
    id: `link-${cell}`,
    metricId,
    filePath: '/w/book.xlsx',
    target: { kind: 'xlsx-cell', sheet: 'Sheet1', cell },
    lastValue,
  })

  it('emits an action when the metric changed', () => {
    const metrics = new Map([['m1', metric('m1', 21.9)]])
    const out = resyncDecisions([link('m1', 23.4)], (id) => metrics.get(id))
    expect(out).toEqual([{ link: link('m1', 23.4), value: 21.9 }])
  })

  it('emits nothing when the metric is unchanged', () => {
    const metrics = new Map([['m1', metric('m1', 23.4)]])
    expect(resyncDecisions([link('m1', 23.4)], (id) => metrics.get(id))).toEqual([])
  })

  it('FAIL-SAFE: a missing/deleted metric produces NO action (cell keeps its value)', () => {
    const empty = new Map<string, Metric>()
    const out = resyncDecisions([link('deleted', 23.4)], (id) => empty.get(id))
    expect(out).toEqual([]) // never blanks, never errors — file stays valid
  })

  it('mixes synced, changed and orphaned links correctly', () => {
    const metrics = new Map([
      ['a', metric('a', 100)], // changed (was 50)
      ['b', metric('b', 7)], // unchanged
    ])
    const out = resyncDecisions(
      [link('a', 50, 'A1'), link('b', 7, 'A2'), link('gone', 3, 'A3')],
      (id) => metrics.get(id)
    )
    expect(out).toHaveLength(1)
    expect(out[0].link.target).toEqual({ kind: 'xlsx-cell', sheet: 'Sheet1', cell: 'A1' })
    expect(out[0].value).toBe(100)
  })

  it('drives a docx-cc link the same way (kind-agnostic decision core)', () => {
    const docLink: Link = {
      id: 'link-cc', metricId: 'm1', filePath: '/w/doc.docx',
      target: { kind: 'docx-cc', tag: 'wos-metric-1' }, lastValue: 10,
    }
    const metrics = new Map([['m1', metric('m1', 42)]])
    const out = resyncDecisions([docLink], (id) => metrics.get(id))
    expect(out).toEqual([{ link: docLink, value: 42 }])
  })

  it('drives a pptx-shape link the same way (kind-agnostic decision core)', () => {
    const pptLink: Link = {
      id: 'link-sp', metricId: 'm1', filePath: '/w/deck.pptx',
      target: { kind: 'pptx-shape', tag: 'wos-metric-1', slide: 0 }, lastValue: 10,
    }
    const metrics = new Map([['m1', metric('m1', 42)]])
    const out = resyncDecisions([pptLink], (id) => metrics.get(id))
    expect(out).toEqual([{ link: pptLink, value: 42 }])
  })
})

describe('planSyncAll (explicit sync-all decision core)', () => {
  const link = (filePath: string, lastValue: number, cell = 'A1'): Link => ({
    id: `link-${filePath}-${cell}`,
    metricId: 'm1',
    filePath,
    target: { kind: 'xlsx-cell', sheet: 'Sheet1', cell },
    lastValue,
  })

  it('partitions links: open file skipped, in-sync unchanged, drifted to write', () => {
    const links = [
      link('/w/open.xlsx', 10), // open file → skipped (engine owns it)
      link('/w/a.xlsx', 10), // already in sync at metric value 42? no → drift
      link('/w/b.xlsx', 42), // in sync
    ]
    const plan = planSyncAll(links, 42, '/w/open.xlsx')
    expect(plan.openSkipped.map((l) => l.filePath)).toEqual(['/w/open.xlsx'])
    expect(plan.toWrite.map((l) => l.filePath)).toEqual(['/w/a.xlsx'])
    expect(plan.unchanged.map((l) => l.filePath)).toEqual(['/w/b.xlsx'])
  })

  it('the open file is excluded even when its value drifted (handled live)', () => {
    const plan = planSyncAll([link('/w/open.xlsx', 1)], 42, '/w/open.xlsx')
    expect(plan.toWrite).toEqual([])
    expect(plan.openSkipped).toHaveLength(1)
  })

  it('with no open file, every drifted link is a write', () => {
    const plan = planSyncAll([link('/w/a.xlsx', 1), link('/w/b.xlsx', 42)], 42, null)
    expect(plan.toWrite.map((l) => l.filePath)).toEqual(['/w/a.xlsx'])
    expect(plan.unchanged.map((l) => l.filePath)).toEqual(['/w/b.xlsx'])
    expect(plan.openSkipped).toEqual([])
  })

  it('SELF-REFERENCE: a link into the metric\'s own source cell is skipped (loop-safe)', () => {
    const source = { kind: 'xlsx-cell', filePath: '/w/a.xlsx', sheet: 'Sheet1', cell: 'A1' }
    // link('/w/a.xlsx', 1, 'A1') points at exactly the source cell → selfSkipped.
    const plan = planSyncAll([link('/w/a.xlsx', 1, 'A1'), link('/w/a.xlsx', 1, 'A2')], 42, null, source)
    expect(plan.selfSkipped.map((l) => l.target)).toEqual([{ kind: 'xlsx-cell', sheet: 'Sheet1', cell: 'A1' }])
    expect(plan.toWrite.map((l) => (l.target as { cell: string }).cell)).toEqual(['A2']) // the other cell still writes
  })
})

describe('isSelfSourceLink (circular-safety guard)', () => {
  const src = { kind: 'xlsx-cell', filePath: '/w/a.xlsx', sheet: 'S', cell: 'B4' }

  it('true when a link targets the metric\'s exact source cell', () => {
    expect(isSelfSourceLink(src, '/w/a.xlsx', { kind: 'xlsx-cell', sheet: 'S', cell: 'B4' })).toBe(true)
  })

  it('false for a different cell / sheet / file', () => {
    expect(isSelfSourceLink(src, '/w/a.xlsx', { kind: 'xlsx-cell', sheet: 'S', cell: 'B5' })).toBe(false)
    expect(isSelfSourceLink(src, '/w/a.xlsx', { kind: 'xlsx-cell', sheet: 'T', cell: 'B4' })).toBe(false)
    expect(isSelfSourceLink(src, '/w/other.xlsx', { kind: 'xlsx-cell', sheet: 'S', cell: 'B4' })).toBe(false)
  })

  it('false for a literal/undefined source or a non-xlsx anchor', () => {
    expect(isSelfSourceLink(undefined, '/w/a.xlsx', { kind: 'xlsx-cell', sheet: 'S', cell: 'B4' })).toBe(false)
    expect(isSelfSourceLink({ kind: 'literal' }, '/w/a.xlsx', { kind: 'xlsx-cell', sheet: 'S', cell: 'B4' })).toBe(false)
    expect(isSelfSourceLink(src, '/w/a.xlsx', { kind: 'docx-cc', tag: 'wos-metric-1' })).toBe(false)
  })
})

// End-to-end mechanics (engine-free): a source-cell change flows through a metric
// to a CONSUMING doc — proving the whole chain without the LibreOffice engine.
describe('source-cell → metric → consuming doc (engine-free chain)', () => {
  it('a changed source cell refreshes the metric and updates a downstream .xlsx', async () => {
    const { readCell } = await import('./xlsx-cell-reader')
    const { setCellValue } = await import('./xlsx-cell-writer')
    const { planRefresh } = await import('./metrics')
    const ExcelJS = (await import('exceljs')).default

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-chain-'))
    try {
      const fileA = path.join(dir, 'Model.xlsx') // the SOURCE
      const fileB = path.join(dir, 'Report.xlsx') // the CONSUMER
      // FILE_A: source cell Summary!B4 = 100. FILE_B: a cell that transcludes it.
      const wbA = new ExcelJS.Workbook()
      wbA.addWorksheet('Summary').getCell('B4').value = 100
      await wbA.xlsx.writeFile(fileA)
      const wbB = new ExcelJS.Workbook()
      wbB.addWorksheet('Sheet1').getCell('C1').value = 100 // last-synced literal
      await wbB.xlsx.writeFile(fileB)

      // A source-linked metric caching the last read (100).
      const metric: Metric = {
        id: 'metric-rev', name: 'Revenue', value: 100, updatedAt: 1,
        source: { kind: 'xlsx-cell', filePath: fileA, sheet: 'Summary', cell: 'B4' },
      }

      // Someone edits the model's revenue cell on disk → 250.
      await setCellValue(fileA, 'Summary', 'B4', 250)

      // Refresh: read the source, decide, propagate to the consumer (FILE_B).
      const read = await readCell(fileA, 'Summary', 'B4')
      const decision = planRefresh(metric, read)
      expect(decision).toEqual({ status: 'updated', value: 250 })

      const wrote = await setCellValue(fileB, 'Sheet1', 'C1', decision.value)
      expect(wrote.ok).toBe(true)

      // The consuming doc now reflects the new source value.
      const verify = new ExcelJS.Workbook()
      await verify.xlsx.readFile(fileB)
      expect(verify.getWorksheet('Sheet1')!.getCell('C1').value).toBe(250)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('TransclusionStore', () => {
  let dir: string
  let store: TransclusionStore
  const file = (): string => path.join(dir, 'transclusions.json')

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-link-'))
    store = new TransclusionStore(file)
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  const base = { metricId: 'm1', filePath: '/w/book.xlsx', sheet: 'Sheet1', cell: 'B2', lastValue: 23.4 }

  it('adds a link and queries it per-file', () => {
    store.add(base)
    store.add({ ...base, filePath: '/w/other.xlsx', cell: 'A1' })
    const links = store.forFile('/w/book.xlsx')
    expect(links).toHaveLength(1)
    expect(links[0].target).toEqual({ kind: 'xlsx-cell', sheet: 'Sheet1', cell: 'B2' })
    expect(links[0].lastValue).toBe(23.4)
    expect(store.forFile('/w/missing.xlsx')).toHaveLength(0)
  })

  it('stores a docx-cc anchor and is one-per-tag (re-add replaces)', () => {
    const d = { metricId: 'm1', filePath: '/w/doc.docx', lastValue: 5, target: { kind: 'docx-cc' as const, tag: 'wos-metric-1' } }
    store.add(d)
    expect(store.forFile('/w/doc.docx')[0].target).toEqual({ kind: 'docx-cc', tag: 'wos-metric-1' })
    store.add({ ...d, lastValue: 9 }) // same tag → replace
    const links = store.forFile('/w/doc.docx')
    expect(links).toHaveLength(1)
    expect(links[0].lastValue).toBe(9)
    // a different tag in the same file is a distinct link
    store.add({ ...d, target: { kind: 'docx-cc' as const, tag: 'wos-metric-2' } })
    expect(store.forFile('/w/doc.docx')).toHaveLength(2)
  })

  it('stores a pptx-shape anchor and is one-per-tag (re-add replaces)', () => {
    const p = { metricId: 'm1', filePath: '/w/deck.pptx', lastValue: 5, target: { kind: 'pptx-shape' as const, tag: 'wos-metric-1', slide: 0 } }
    store.add(p)
    expect(store.forFile('/w/deck.pptx')[0].target).toEqual({ kind: 'pptx-shape', tag: 'wos-metric-1', slide: 0 })
    store.add({ ...p, lastValue: 9 }) // same tag → replace
    const links = store.forFile('/w/deck.pptx')
    expect(links).toHaveLength(1)
    expect(links[0].lastValue).toBe(9)
    // a different tag in the same file is a distinct link
    store.add({ ...p, target: { kind: 'pptx-shape' as const, tag: 'wos-metric-2', slide: 1 } })
    expect(store.forFile('/w/deck.pptx')).toHaveLength(2)
  })

  it('reads a LEGACY flat {sheet, cell} record from disk as kind:xlsx-cell', () => {
    // Simulate a pre-existing transclusions.json written before the target model.
    fs.writeFileSync(
      file(),
      JSON.stringify([{ id: 'link-legacy', metricId: 'm1', filePath: '/w/legacy.xlsx', sheet: 'Sheet1', cell: 'D4', lastValue: 12 }]),
      'utf-8',
    )
    const links = store.forFile('/w/legacy.xlsx')
    expect(links).toHaveLength(1)
    expect(links[0].target).toEqual({ kind: 'xlsx-cell', sheet: 'Sheet1', cell: 'D4' })
    expect(links[0].lastValue).toBe(12)
  })

  it('is one-per-cell: re-adding the same cell replaces (and persists new lastValue)', () => {
    store.add(base)
    store.add({ ...base, lastValue: 21.9 })
    const links = store.forFile('/w/book.xlsx')
    expect(links).toHaveLength(1)
    expect(links[0].lastValue).toBe(21.9)
    // a different cell in the same file is a distinct link
    store.add({ ...base, cell: 'C3' })
    expect(store.forFile('/w/book.xlsx')).toHaveLength(2)
  })

  it('forMetric gathers a metric’s links across ALL files', () => {
    store.add(base) // m1 in book.xlsx
    store.add({ ...base, filePath: '/w/other.xlsx', cell: 'A1' }) // m1 in other.xlsx
    store.add({ ...base, metricId: 'm2', filePath: '/w/third.xlsx', cell: 'A1' }) // m2 elsewhere
    const m1 = store.forMetric('m1')
    expect(m1).toHaveLength(2)
    expect(new Set(m1.map((l) => l.filePath))).toEqual(new Set(['/w/book.xlsx', '/w/other.xlsx']))
    expect(store.forMetric('m2')).toHaveLength(1)
    expect(store.forMetric('missing')).toEqual([])
  })

  it('allLinks returns every link across all files (link-count source)', () => {
    store.add(base) // m1 in book.xlsx
    store.add({ ...base, filePath: '/w/other.xlsx', cell: 'A1' }) // m1 in other.xlsx
    store.add({ ...base, metricId: 'm2', filePath: '/w/third.xlsx', cell: 'A1' }) // m2 elsewhere
    const all = store.allLinks()
    expect(all).toHaveLength(3)
    expect(new Set(all.map((l) => l.metricId))).toEqual(new Set(['m1', 'm2']))
  })

  it('removes by id and survives a corrupt file', () => {
    const l = store.add(base)
    store.remove(l.id)
    expect(store.forFile('/w/book.xlsx')).toHaveLength(0)
    fs.writeFileSync(file(), 'garbage', 'utf-8')
    expect(store.forFile('/w/book.xlsx')).toEqual([])
    store.add(base)
    expect(store.forFile('/w/book.xlsx')).toHaveLength(1)
  })

  // Mirrors the renderer's live-on-save propagation: forFile(openFile) filtered
  // to the edited metric, then resyncDecisions. The OPEN file gets a write NOW;
  // a link to the same metric in a DIFFERENT file is not written now (it re-syncs
  // on its own next open).
  describe('live propagation to the open doc (decision)', () => {
    const OPEN = '/w/open.xlsx'
    const OTHER = '/w/other.xlsx'

    it('writes a changed metric into a link in the OPEN file, not other files', () => {
      store.add({ metricId: 'm1', filePath: OPEN, sheet: 'Sheet1', cell: 'A1', lastValue: 10 })
      store.add({ metricId: 'm1', filePath: OTHER, sheet: 'Sheet1', cell: 'A1', lastValue: 10 })
      const byId = new Map([['m1', metric('m1', 42)]])

      const openLinks = store.forFile(OPEN).filter((l) => l.metricId === 'm1')
      const actions = resyncDecisions(openLinks, (id) => byId.get(id))
      expect(actions).toHaveLength(1)
      expect(actions[0].link.filePath).toBe(OPEN)
      expect(actions[0].value).toBe(42)

      // The other file is untouched now — its link still holds the stale value.
      expect(store.forFile(OTHER)[0].lastValue).toBe(10)
    })

    it('a changed metric with NO link in the open file is a no-op', () => {
      store.add({ metricId: 'm1', filePath: OTHER, sheet: 'Sheet1', cell: 'A1', lastValue: 10 })
      const byId = new Map([['m1', metric('m1', 42)]])
      const openLinks = store.forFile(OPEN).filter((l) => l.metricId === 'm1')
      expect(resyncDecisions(openLinks, (id) => byId.get(id))).toEqual([])
    })
  })
})
