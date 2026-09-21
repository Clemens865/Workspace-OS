import { describe, expect, it } from 'vitest'
import { needsExpandPrompt, parseSortInfo, pickedColumn, plainRange, sortArgs } from './sortModel'

describe('sortModel', () => {
  const info = parseSortInfo('$Sheet1.$B$2:$B$4|$Sheet1.$A$1:$C$4|1\n')!

  it('parses the info line', () => {
    expect(info).toEqual({ selection: '$Sheet1.$B$2:$B$4', region: '$Sheet1.$A$1:$C$4', hasHeader: true })
    expect(parseSortInfo('')).toBeNull()
  })

  it('strips the sheet prefix and dollars', () => {
    expect(plainRange('$Sheet1.$B$2:$B$4')).toEqual({ a: 'B2', b: 'B4' })
    expect(plainRange('$Sheet1.$C$3')).toEqual({ a: 'C3', b: 'C3' })
  })

  it('asks only when the block is wider than the selection', () => {
    expect(needsExpandPrompt(info)).toBe(true)
    expect(needsExpandPrompt({ selection: '$S.$A$1:$C$4', region: '$S.$A$1:$C$4', hasHeader: true })).toBe(false)
    expect(needsExpandPrompt({ selection: '$S.$B$1:$B$1048576', region: '$S.$A$1:$C$4', hasHeader: false })).toBe(true)
  })

  it('names the picked column and builds the sort op', () => {
    expect(pickedColumn(info)).toBe('B')
    expect(sortArgs(info.selection, 'asc', true)).toBe('sort|B2:B4|1|1')
    expect(sortArgs(info.selection, 'desc', false)).toBe('sort|B2:B4|0|0')
  })
})
