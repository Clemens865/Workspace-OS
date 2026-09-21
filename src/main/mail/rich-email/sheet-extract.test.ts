import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import ExcelJS from 'exceljs'
import { extractSheets, EXTRACT_LIMITS } from './sheet-extract'

/**
 * Extraction, against REAL .xlsx files written to a temp dir.
 *
 * Deliberately not mocking ExcelJS: the things worth testing here are what a
 * real workbook does — a formula cell carrying a cached result, a sheet whose
 * nominal size dwarfs its used area, a file that is not a workbook at all — and
 * a mock would just re-state my assumptions about each.
 */

let dir: string

async function write(name: string, build: (wb: ExcelJS.Workbook) => void): Promise<string> {
  const wb = new ExcelJS.Workbook()
  build(wb)
  const p = path.join(dir, name)
  await wb.xlsx.writeFile(p)
  return p
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-extract-'))
})
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('extractSheets', () => {
  it('reads a simple sheet, header row first', async () => {
    const p = await write('simple.xlsx', (wb) => {
      const ws = wb.addWorksheet('Q3')
      ws.addRow(['Berth', 'Throughput'])
      ws.addRow(['Berth 4', 5150])
      ws.addRow(['Berth 5', 3120])
    })
    const r = await extractSheets(p)
    expect(r.ok).toBe(true)
    expect(r.sheets?.[0].name).toBe('Q3')
    expect(r.sheets?.[0].grid[0]).toEqual(['Berth', 'Throughput'])
    expect(r.sheets?.[0].grid[1][1]).toBe(5150)
    expect(r.sheets?.[0].truncated).toBe(false)
    expect(r.fileName).toBe('simple.xlsx')
  })

  it('reads a formula cell as its cached result', async () => {
    const p = await write('formula.xlsx', (wb) => {
      const ws = wb.addWorksheet('S')
      ws.addRow(['a', 1])
      ws.addRow(['b', 2])
      ws.getCell('B3').value = { formula: 'SUM(B1:B2)', result: 3 }
    })
    const r = await extractSheets(p)
    expect(r.sheets?.[0].grid[2][1]).toBe(3)
  })

  it('caps a long sheet and reports that it did', async () => {
    const p = await write('long.xlsx', (wb) => {
      const ws = wb.addWorksheet('Long')
      for (let i = 0; i < EXTRACT_LIMITS.maxRows + 40; i += 1) ws.addRow([`r${i}`, i])
    })
    const r = await extractSheets(p)
    expect(r.sheets?.[0].grid.length).toBeLessThanOrEqual(EXTRACT_LIMITS.maxRows)
    // Silent truncation is the dangerous case: the prompt must be able to say so.
    expect(r.sheets?.[0].truncated).toBe(true)
  })

  it('caps a wide sheet', async () => {
    const p = await write('wide.xlsx', (wb) => {
      const ws = wb.addWorksheet('Wide')
      ws.addRow(Array.from({ length: EXTRACT_LIMITS.maxCols + 10 }, (_, i) => `c${i}`))
    })
    const r = await extractSheets(p)
    expect(r.sheets?.[0].cols).toBe(EXTRACT_LIMITS.maxCols)
    expect(r.sheets?.[0].truncated).toBe(true)
  })

  it('drops wholly empty rows inside the used area', async () => {
    const p = await write('gappy.xlsx', (wb) => {
      const ws = wb.addWorksheet('G')
      ws.addRow(['a', 1])
      ws.addRow([])
      ws.addRow(['b', 2])
    })
    const r = await extractSheets(p)
    expect(r.sheets?.[0].grid).toHaveLength(2)
  })

  it('skips an empty sheet rather than emitting a blank one', async () => {
    const p = await write('mixed.xlsx', (wb) => {
      wb.addWorksheet('Empty')
      const ws = wb.addWorksheet('Real')
      ws.addRow(['x', 1])
    })
    const r = await extractSheets(p)
    expect(r.sheets?.map((s) => s.name)).toEqual(['Real'])
  })

  it('caps how many sheets are read', async () => {
    const p = await write('many.xlsx', (wb) => {
      for (let i = 0; i < EXTRACT_LIMITS.maxSheets + 3; i += 1) {
        wb.addWorksheet(`S${i}`).addRow(['x', i])
      }
    })
    const r = await extractSheets(p)
    expect(r.sheets?.length).toBe(EXTRACT_LIMITS.maxSheets)
  })

  it('fails with a reason for a workbook with no data', async () => {
    const p = await write('blank.xlsx', (wb) => { wb.addWorksheet('Nothing') })
    const r = await extractSheets(p)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('empty')
  })

  it('refuses a non-xlsx path', async () => {
    const p = path.join(dir, 'notes.txt')
    fs.writeFileSync(p, 'hello')
    const r = await extractSheets(p)
    expect(r).toEqual({ ok: false, reason: 'not-xlsx' })
  })

  it('refuses a missing file', async () => {
    const r = await extractSheets(path.join(dir, 'nope.xlsx'))
    expect(r).toEqual({ ok: false, reason: 'missing' })
  })

  it('reports unreadable rather than throwing on a file that is not a workbook', async () => {
    const p = path.join(dir, 'fake.xlsx')
    fs.writeFileSync(p, 'this is not a zip archive')
    const r = await extractSheets(p)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('unreadable')
  })

  it('rejects an empty path without touching the disk', async () => {
    expect(await extractSheets('')).toEqual({ ok: false, reason: 'bad-path' })
  })
})
