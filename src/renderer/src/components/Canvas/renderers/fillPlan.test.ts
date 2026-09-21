import { describe, expect, it } from 'vitest'
import { FILL_DIR, planFill, spanA1 } from './fillPlan'
import { cellAtTwips, colToLetters, toA1 } from '../../../lib/calcCellRect'

describe('A1 helpers', () => {
  it('formats columns and cells', () => {
    expect(colToLetters(0)).toBe('A')
    expect(colToLetters(25)).toBe('Z')
    expect(colToLetters(26)).toBe('AA')
    expect(toA1(1, 2)).toBe('B3')
    expect(spanA1({ col: 0, row: 0, cols: 2, rows: 3 })).toBe('A1:B3')
  })
})

describe('cellAtTwips', () => {
  // Two column widths: A–B at 1000 twips, C onward at 2000; rows all 300.
  const g = { commandName: '', columns: { sizes: '1000:1 2000:1023' }, rows: { sizes: '300:1048575' } }
  it('resolves points inside and across run boundaries', () => {
    expect(cellAtTwips(g, 10, 10)).toEqual({ col: 0, row: 0 })
    expect(cellAtTwips(g, 1999, 350)).toEqual({ col: 1, row: 1 })
    expect(cellAtTwips(g, 2000, 0)).toEqual({ col: 2, row: 0 })
    expect(cellAtTwips(g, 2000 + 4500, 0)).toEqual({ col: 4, row: 0 })
  })
  it('never goes negative and copes with missing geometry', () => {
    expect(cellAtTwips(g, -50, -50)).toEqual({ col: 0, row: 0 })
    expect(cellAtTwips(null, 1, 1)).toBeNull()
  })
})

describe('planFill', () => {
  const src = { col: 0, row: 0, cols: 1, rows: 2 } // A1:A2
  it('extends downward from a two-cell series', () => {
    expect(planFill(src, { col: 0, row: 4 })).toEqual({ range: 'A1:A5', dir: FILL_DIR.TO_BOTTOM, count: 2, span: { col: 0, row: 0, cols: 1, rows: 5 } })
  })
  it('extends to the right, keeping the source rows', () => {
    const p = planFill({ col: 1, row: 1, cols: 1, rows: 1 }, { col: 4, row: 1 })
    expect(p?.range).toBe('B2:E2')
    expect(p?.dir).toBe(FILL_DIR.TO_RIGHT)
    expect(p?.count).toBe(1)
  })
  it('fills upward and leftward when dragged that way', () => {
    expect(planFill({ col: 2, row: 5, cols: 1, rows: 1 }, { col: 2, row: 2 })?.range).toBe('C3:C6')
    expect(planFill({ col: 2, row: 5, cols: 1, rows: 1 }, { col: 2, row: 2 })?.dir).toBe(FILL_DIR.TO_TOP)
    expect(planFill({ col: 3, row: 0, cols: 1, rows: 1 }, { col: 1, row: 0 })?.range).toBe('B1:D1')
  })
  it('picks the dominant axis on a diagonal drag', () => {
    expect(planFill(src, { col: 3, row: 2 })?.dir).toBe(FILL_DIR.TO_RIGHT)
    expect(planFill(src, { col: 1, row: 6 })?.dir).toBe(FILL_DIR.TO_BOTTOM)
  })
  it('is a no-op inside the source', () => {
    expect(planFill(src, { col: 0, row: 1 })).toBeNull()
  })
})
