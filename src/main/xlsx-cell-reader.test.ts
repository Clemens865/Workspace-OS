import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import ExcelJS from 'exceljs'
import { readCell } from './xlsx-cell-reader'

/**
 * Proves the engine-free source READER against REAL .xlsx fixtures:
 *   - reads a numeric cell (and a formula's numeric result)
 *   - never modifies the source (byte-identical before/after)
 *   - every fail-safe path returns { ok:false, reason } WITHOUT throwing
 */
describe('readCell (engine-free xlsx reader)', () => {
  let dir: string
  const file = (name = 'book.xlsx'): string => path.join(dir, name)

  async function makeFixture(p = file()): Promise<void> {
    const wb = new ExcelJS.Workbook()
    const s1 = wb.addWorksheet('Summary')
    s1.getCell('B4').value = 1250.5 // numeric source
    s1.getCell('C3').value = 'hello' // text — must be refused
    s1.getCell('D5').value = { formula: 'B4*2', result: 2501 } // formula w/ numeric result
    s1.getCell('E1').value = null // empty — must be refused
    const s2 = wb.addWorksheet('Data')
    s2.getCell('A1').value = 999
    await wb.xlsx.writeFile(p)
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-xlsxr-'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('reads a numeric cell', async () => {
    await makeFixture()
    expect(await readCell(file(), 'Summary', 'B4')).toEqual({ ok: true, value: 1250.5 })
  })

  it('reads a formula cell as its numeric result', async () => {
    await makeFixture()
    expect(await readCell(file(), 'Summary', 'D5')).toEqual({ ok: true, value: 2501 })
  })

  it('reads from a named non-first sheet', async () => {
    await makeFixture()
    expect(await readCell(file(), 'Data', 'A1')).toEqual({ ok: true, value: 999 })
  })

  it('NEVER modifies the source (byte-identical after read)', async () => {
    await makeFixture()
    const before = fs.readFileSync(file())
    await readCell(file(), 'Summary', 'B4')
    expect(fs.readFileSync(file()).equals(before)).toBe(true)
  })

  it('resolves the single sheet when no name is given', async () => {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Only').getCell('A1').value = 42
    await wb.xlsx.writeFile(file('one.xlsx'))
    expect(await readCell(file('one.xlsx'), '', 'A1')).toEqual({ ok: true, value: 42 })
  })

  it('FAIL-SAFE: missing file → fail', async () => {
    expect(await readCell(file('nope.xlsx'), 'Summary', 'B4')).toEqual({ ok: false, reason: 'missing' })
  })

  it('FAIL-SAFE: not a valid xlsx → fail', async () => {
    fs.writeFileSync(file('bad.xlsx'), 'not a zip')
    expect((await readCell(file('bad.xlsx'), 'Summary', 'B4')).reason).toBe('not-valid-xlsx')
  })

  it('FAIL-SAFE: non-.xlsx extension → fail', async () => {
    fs.writeFileSync(file('book.xls'), 'x')
    expect((await readCell(file('book.xls'), 'Summary', 'B4')).reason).toBe('not-xlsx')
  })

  it('FAIL-SAFE: unknown sheet → fail', async () => {
    await makeFixture()
    expect((await readCell(file(), 'Nope', 'B4')).reason).toBe('sheet-not-found')
  })

  it('FAIL-SAFE: malformed cell address → fail', async () => {
    await makeFixture()
    expect((await readCell(file(), 'Summary', 'not-a-cell')).reason).toBe('bad-cell')
  })

  it('FAIL-SAFE: text cell → cell-not-numeric', async () => {
    await makeFixture()
    expect((await readCell(file(), 'Summary', 'C3')).reason).toBe('cell-not-numeric')
  })

  it('FAIL-SAFE: empty cell → cell-not-numeric', async () => {
    await makeFixture()
    expect((await readCell(file(), 'Summary', 'E1')).reason).toBe('cell-not-numeric')
  })
})
