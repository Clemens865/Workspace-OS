import { describe, it, expect } from 'vitest'
import { parseA1, parseRuns, cellRectFromGeometry } from './calcCellRect'
import type { SheetGeometry } from '../types/workspace-api'

describe('parseA1', () => {
  it('parses to 0-based col/row and rejects garbage', () => {
    expect(parseA1('A1')).toEqual({ col: 0, row: 0 })
    expect(parseA1('C3')).toEqual({ col: 2, row: 2 })
    expect(parseA1('AA1')).toEqual({ col: 26, row: 0 })
    expect(parseA1('nope')).toBeNull()
    expect(parseA1('A0')).toBeNull()
  })
})

describe('parseRuns', () => {
  it('parses run-length "size:last" tokens', () => {
    expect(parseRuns('1000:0 2000:5')).toEqual([
      { size: 1000, last: 0 },
      { size: 2000, last: 5 },
    ])
    expect(parseRuns(undefined)).toEqual([])
    expect(parseRuns('')).toEqual([])
  })
})

describe('cellRectFromGeometry', () => {
  // Uniform grid: every column 1000tw, every row 300tw.
  const uniform: SheetGeometry = {
    commandName: '.uno:SheetGeometryData',
    columns: { sizes: '1000:1023' },
    rows: { sizes: '300:1048575' },
  }

  it('maps A1 to the origin cell', () => {
    expect(cellRectFromGeometry(uniform, 'A1', 0.1)).toEqual({ x: 0, y: 0, w: 100, h: 30 })
  })

  it('offsets by the summed spans before the cell (B2)', () => {
    // col 1 → x = 1000*0.1 = 100; row 1 → y = 300*0.1 = 30.
    expect(cellRectFromGeometry(uniform, 'B2', 0.1)).toEqual({ x: 100, y: 30, w: 100, h: 30 })
  })

  it('honours variable column widths from run-length runs', () => {
    // col 0 = 1000tw, cols 1..5 = 2000tw. C1 = col 2 → start = 1000 + 2000 = 3000.
    const varied: SheetGeometry = {
      commandName: '.uno:SheetGeometryData',
      columns: { sizes: '1000:0 2000:5' },
      rows: { sizes: '300:1048575' },
    }
    expect(cellRectFromGeometry(varied, 'C1', 0.1)).toEqual({ x: 300, y: 0, w: 200, h: 30 })
  })

  it('returns null for null geometry, a bad address, or empty sizes', () => {
    expect(cellRectFromGeometry(null, 'A1', 0.1)).toBeNull()
    expect(cellRectFromGeometry(uniform, 'nope', 0.1)).toBeNull()
    expect(
      cellRectFromGeometry({ commandName: 'x', columns: {}, rows: {} }, 'A1', 0.1)
    ).toBeNull()
  })
})
