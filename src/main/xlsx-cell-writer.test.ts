import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import ExcelJS from 'exceljs'
import { setCellValue } from './xlsx-cell-writer'

/**
 * Proves the engine-free closed-file writer against REAL .xlsx fixtures:
 *   - a numeric cell is updated, everything else stays intact, file stays valid
 *   - every fail-safe path skips-and-reports WITHOUT corrupting the file
 */
describe('setCellValue (engine-free xlsx writer)', () => {
  let dir: string
  const file = (name = 'book.xlsx'): string => path.join(dir, name)

  /** Author a real two-sheet workbook with numbers, text, and a formula. */
  async function makeFixture(p = file()): Promise<void> {
    const wb = new ExcelJS.Workbook()
    const s1 = wb.addWorksheet('Sheet1')
    s1.getCell('A1').value = 10 // numeric target
    s1.getCell('B2').value = 23.4 // numeric target
    s1.getCell('C3').value = 'hello' // text — must be refused
    s1.getCell('D4').value = { formula: 'A1+B2', result: 33.4 } // formula — must be refused
    const s2 = wb.addWorksheet('Data')
    s2.getCell('A1').value = 999 // other-sheet sentinel
    await wb.xlsx.writeFile(p)
  }

  const read = async (p: string): Promise<ExcelJS.Workbook> => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(p)
    return wb
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-xlsx-'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('sets a numeric cell and leaves the rest of the workbook intact', async () => {
    await makeFixture()
    const res = await setCellValue(file(), 'Sheet1', 'B2', 55.5)
    expect(res.ok).toBe(true)

    const wb = await read(file())
    expect(wb.getWorksheet('Sheet1')!.getCell('B2').value).toBe(55.5) // changed
    expect(wb.getWorksheet('Sheet1')!.getCell('A1').value).toBe(10) // untouched
    expect(wb.getWorksheet('Sheet1')!.getCell('C3').value).toBe('hello') // text intact
    expect(wb.getWorksheet('Data')!.getCell('A1').value).toBe(999) // other sheet intact
    // still a valid, re-openable xlsx (read above already proved this)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Sheet1', 'Data'])
  })

  it('does not leave a temp file behind on success', async () => {
    await makeFixture()
    await setCellValue(file(), 'Sheet1', 'A1', 1)
    const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('FAIL-SAFE: missing file → skip, no file created', async () => {
    const res = await setCellValue(file('nope.xlsx'), 'Sheet1', 'A1', 5)
    expect(res).toEqual({ ok: false, reason: 'missing' })
    expect(fs.existsSync(file('nope.xlsx'))).toBe(false)
  })

  it('FAIL-SAFE: not a valid xlsx → skip, original bytes untouched', async () => {
    fs.writeFileSync(file('bad.xlsx'), 'this is not a zip')
    const res = await setCellValue(file('bad.xlsx'), 'Sheet1', 'A1', 5)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('not-valid-xlsx')
    expect(fs.readFileSync(file('bad.xlsx'), 'utf-8')).toBe('this is not a zip')
  })

  it('FAIL-SAFE: unknown sheet → skip, workbook unchanged', async () => {
    await makeFixture()
    const before = fs.readFileSync(file())
    const res = await setCellValue(file(), 'Nope', 'A1', 5)
    expect(res).toEqual({ ok: false, reason: 'sheet-not-found' })
    expect(fs.readFileSync(file()).equals(before)).toBe(true) // byte-identical
  })

  it('FAIL-SAFE: malformed cell address → skip', async () => {
    await makeFixture()
    const res = await setCellValue(file(), 'Sheet1', 'not-a-cell', 5)
    expect(res).toEqual({ ok: false, reason: 'bad-cell' })
  })

  it('FAIL-SAFE: refuses to clobber a formula cell', async () => {
    await makeFixture()
    const res = await setCellValue(file(), 'Sheet1', 'D4', 5)
    expect(res).toEqual({ ok: false, reason: 'cell-has-formula' })
    const wb = await read(file())
    const d4 = wb.getWorksheet('Sheet1')!.getCell('D4')
    expect(d4.type).toBe(ExcelJS.ValueType.Formula) // still a formula
  })

  it('FAIL-SAFE: refuses to clobber a text cell', async () => {
    await makeFixture()
    const res = await setCellValue(file(), 'Sheet1', 'C3', 5)
    expect(res).toEqual({ ok: false, reason: 'cell-has-text' })
    const wb = await read(file())
    expect(wb.getWorksheet('Sheet1')!.getCell('C3').value).toBe('hello')
  })

  it('FAIL-SAFE: non-finite value → skip', async () => {
    await makeFixture()
    expect((await setCellValue(file(), 'Sheet1', 'A1', NaN)).reason).toBe('value-not-finite')
    expect((await setCellValue(file(), 'Sheet1', 'A1', Infinity)).reason).toBe('value-not-finite')
  })

  it('FAIL-SAFE: non-.xlsx extension → skip', async () => {
    fs.writeFileSync(file('book.xls'), 'x')
    expect((await setCellValue(file('book.xls'), 'Sheet1', 'A1', 5)).reason).toBe('not-xlsx')
  })

  it('resolves the single sheet when no name is given', async () => {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Only').getCell('A1').value = 1
    await wb.xlsx.writeFile(file('one.xlsx'))
    const res = await setCellValue(file('one.xlsx'), '', 'A1', 42)
    expect(res.ok).toBe(true)
    expect((await read(file('one.xlsx'))).getWorksheet('Only')!.getCell('A1').value).toBe(42)
  })
})
