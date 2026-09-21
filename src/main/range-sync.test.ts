import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import ExcelJS from 'exceljs'
import { readRange } from './xlsx-range-reader'
import { setRangeValues } from './xlsx-range-writer'
import { RangeStore, planRangeRefresh, isSourcedRange } from './ranges'
import { RangeLinkStore, planRangeSyncAll } from './rangeLinks'

/**
 * Disk-level proof for live ranges: the engine-free grid reader/writer against
 * REAL .xlsx files, plus the sync-all composition exactly as the IPC handler
 * runs it (ranges.get → planRangeSyncAll → setRangeValues on closed files,
 * advance lastValues on success). Mirrors sync-all.test.ts, grid-sized.
 */
describe('xlsx range reader/writer + sync-all composition', () => {
  let dir: string
  const xlsx = (name: string): string => path.join(dir, name)

  async function makeBook(name: string): Promise<string> {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Sheet1')
    ws.getCell('A1').value = 'Region'
    ws.getCell('B1').value = 'Rev'
    ws.getCell('A2').value = 'EMEA'
    ws.getCell('B2').value = 12.5
    ws.getCell('A3').value = 'APAC'
    ws.getCell('B3').value = 7 // A1:B3 is the canonical source block
    ws.getCell('D1').value = { formula: 'B2+B3', result: 19.5 }
    const p = xlsx(name)
    await wb.xlsx.writeFile(p)
    return p
  }

  const readBack = async (p: string, sheet: string, cell: string): Promise<unknown> => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(p)
    return wb.getWorksheet(sheet)!.getCell(cell).value
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-rangeio-'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('reads a block: numbers, strings, formula results, empties → null', async () => {
    const p = await makeBook('src.xlsx')
    const res = await readRange(p, 'Sheet1', 'A1:B3')
    expect(res.ok).toBe(true)
    expect(res.values).toEqual([
      ['Region', 'Rev'],
      ['EMEA', 12.5],
      ['APAC', 7],
    ])
    const withFormula = await readRange(p, 'Sheet1', 'C1:D1')
    expect(withFormula.values).toEqual([[null, 19.5]]) // empty → null, formula → cached result
  })

  it('read fails safe at the file/sheet/ref level', async () => {
    const p = await makeBook('src.xlsx')
    expect((await readRange(xlsx('ghost.xlsx'), 'Sheet1', 'A1:B2')).reason).toBe('missing')
    expect((await readRange(p, 'NoSheet', 'A1:B2')).reason).toBe('sheet-not-found')
    expect((await readRange(p, 'Sheet1', 'bogus')).reason).toBe('bad-ref')
    expect((await readRange('/tmp/x.txt', '', 'A1')).reason).toBe('not-xlsx')
  })

  it('stamps a block (numbers, strings, null clears) and stays a valid workbook', async () => {
    const p = await makeBook('dst.xlsx')
    const res = await setRangeValues(p, 'Sheet1', 'F1', [
      ['Region', 'Rev'],
      ['EMEA', 99],
      [null, -1],
    ])
    expect(res).toEqual({ ok: true })
    expect(await readBack(p, 'Sheet1', 'F1')).toBe('Region')
    expect(await readBack(p, 'Sheet1', 'G2')).toBe(99)
    expect(await readBack(p, 'Sheet1', 'F3')).toBeNull() // null cleared the cell
    expect(await readBack(p, 'Sheet1', 'G3')).toBe(-1)
    expect(await readBack(p, 'Sheet1', 'B2')).toBe(12.5) // untouched neighbors
  })

  it('refuses the WHOLE block if any target cell holds a formula', async () => {
    const p = await makeBook('dst.xlsx')
    // Anchor C1 → block covers C1:D2, and D1 holds a formula.
    const res = await setRangeValues(p, 'Sheet1', 'C1', [[1, 2], [3, 4]])
    expect(res).toEqual({ ok: false, reason: 'cell-has-formula' })
    expect(await readBack(p, 'Sheet1', 'C1')).toBeNull() // nothing was written at all
  })

  it('skips a missing file / bad grid without touching disk', async () => {
    expect((await setRangeValues(xlsx('ghost.xlsx'), 'Sheet1', 'A1', [[1]])).reason).toBe('missing')
    const p = await makeBook('dst.xlsx')
    expect((await setRangeValues(p, 'Sheet1', 'A1', [[1], [1, 2]] as never)).reason).toBe('bad-grid')
  })

  it('sync-all composition: closed file stamped + lastValues advanced; open file left alone', async () => {
    const src = await makeBook('src.xlsx')
    const open = await makeBook('open.xlsx')
    const closed = await makeBook('closed.xlsx')
    const ranges = new RangeStore(() => path.join(dir, 'ranges.json'))
    const links = new RangeLinkStore(() => path.join(dir, 'links.json'))

    // Seed the range from its real source block (as range:createFromSource does).
    const seed = await readRange(src, 'Sheet1', 'A1:B3')
    const r = ranges.create('KPIs', seed.values, { kind: 'xlsx-range', filePath: src, sheet: 'Sheet1', ref: 'A1:B3' })

    const stale = [[null, null], [null, null], [null, null]] // both blocks out of sync
    links.add({ rangeId: r.id, filePath: open, target: { kind: 'xlsx-block', sheet: 'Sheet1', cell: 'F1' }, lastValues: stale })
    links.add({ rangeId: r.id, filePath: closed, target: { kind: 'xlsx-block', sheet: 'Sheet1', cell: 'F1' }, lastValues: stale })

    // Replay the handler loop with the open file open.
    const plan = planRangeSyncAll(links.forRange(r.id), ranges.get(r.id)!, open)
    expect(plan.openSkipped).toHaveLength(1)
    expect(plan.toWrite).toHaveLength(1)
    for (const link of plan.toWrite) {
      const res = await setRangeValues(link.filePath, link.target.sheet, link.target.cell, r.values)
      expect(res.ok).toBe(true)
      links.add({ rangeId: link.rangeId, filePath: link.filePath, target: link.target, lastValues: r.values })
    }

    expect(await readBack(closed, 'Sheet1', 'F2')).toBe('EMEA')
    expect(await readBack(closed, 'Sheet1', 'G3')).toBe(7)
    expect(await readBack(open, 'Sheet1', 'F1')).toBeNull() // engine owns it — left alone
    const byFile = Object.fromEntries(links.forRange(r.id).map((l) => [l.filePath, l.lastValues]))
    expect(byFile[closed]).toEqual(r.values)
    expect(byFile[open]).toEqual(stale)
  })

  it('refresh composition: source edit on disk → updated grid; deleted source → stale keeps cache', async () => {
    const src = await makeBook('src.xlsx')
    const ranges = new RangeStore(() => path.join(dir, 'ranges.json'))
    const seed = await readRange(src, 'Sheet1', 'A1:B3')
    const r = ranges.create('KPIs', seed.values, { kind: 'xlsx-range', filePath: src, sheet: 'Sheet1', ref: 'A1:B3' })

    // Edit the source block on disk (B2: 12.5 → 40).
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(src)
    wb.getWorksheet('Sheet1')!.getCell('B2').value = 40
    await wb.xlsx.writeFile(src)

    const cur = ranges.get(r.id)!
    expect(isSourcedRange(cur)).toBe(true)
    const plan = planRangeRefresh(cur, await readRange(src, 'Sheet1', 'A1:B3'))
    expect(plan.status).toBe('updated')
    expect(plan.values[1]).toEqual(['EMEA', 40])

    fs.rmSync(src)
    const plan2 = planRangeRefresh(cur, await readRange(src, 'Sheet1', 'A1:B3'))
    expect(plan2).toEqual({ status: 'stale', values: cur.values }) // never blanks
  })
})
