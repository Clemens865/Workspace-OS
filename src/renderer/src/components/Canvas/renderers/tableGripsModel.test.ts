import { describe, expect, it } from 'vitest'
import { bands, borderAt, cellCentre, resizedSizeMm100, tableBox } from './tableGripsModel'
import type { TableGeometry } from './tableGeometry'

const g: TableGeometry = {
  columns: { offset: 1000, left: 0, right: 3000, inner: [1000, 2000] },
  rows: { offset: 500, left: 0, right: 800, inner: [400] },
}

describe('tableGrips', () => {
  it('turns edges into bands in document twips', () => {
    expect(bands(g.columns)).toEqual([
      { index: 0, start: 1000, end: 2000 }, { index: 1, start: 2000, end: 3000 }, { index: 2, start: 3000, end: 4000 },
    ])
    expect(bands(g.rows)).toEqual([{ index: 0, start: 500, end: 900 }, { index: 1, start: 900, end: 1300 }])
  })

  it('gives the table box and cell centres', () => {
    expect(tableBox(g)).toEqual({ x: 1000, y: 500, w: 3000, h: 800 })
    expect(cellCentre(g, 1, 2)).toEqual({ x: 3500, y: 1100 })
    expect(cellCentre(g, 5, 0)).toBeNull()
  })

  it('finds the inner border under a pointer', () => {
    expect(borderAt(g.columns, 2010, 30)).toBe(0)
    expect(borderAt(g.columns, 2990, 30)).toBe(1)
    expect(borderAt(g.columns, 2500, 30)).toBeNull()
  })

  it('computes the resized band size in 1/100 mm with a floor', () => {
    expect(resizedSizeMm100(g.columns, 0, 2440)).toBe(2540) // 1440 twips = 1 inch
    expect(resizedSizeMm100(g.columns, 0, 1010)).toBe(Math.round((200 * 2540) / 1440))
  })
})
