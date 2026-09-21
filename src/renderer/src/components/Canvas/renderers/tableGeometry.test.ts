import { describe, expect, it } from 'vitest'
import { cellAtPoint, parseTableSelected } from './tableGeometry'

// Shape of the real payload (Writer, e2e/office/AJ-context-menu.mjs): a 2×2
// table 9972 twips wide starting at x=1418, rows ~500 twips tall from y=2000.
const PAYLOAD = JSON.stringify({
  columns: { left: 0, right: 9972, tableOffset: 1418, entries: [{ position: 4986, min: 0, max: 9972, hidden: false }] },
  rows: { left: 0, right: 1000, tableOffset: 2000, entries: [{ position: 500, min: 0, max: 1000, hidden: false }] },
})

describe('parseTableSelected', () => {
  it('reads both axes, edges relative to the table offset', () => {
    const g = parseTableSelected(PAYLOAD)
    expect(g?.columns).toEqual({ offset: 1418, left: 0, right: 9972, inner: [4986] })
    expect(g?.rows.inner).toEqual([500])
  })
  it('accepts the stringly-typed boost form and rejects the empty selection', () => {
    const g = parseTableSelected('{"columns":{"left":"0","right":"100","tableOffset":"10","entries":[]},"rows":{"left":"0","right":"50","tableOffset":"5","entries":[]}}')
    expect(g?.columns.right).toBe(100)
    expect(parseTableSelected('{}')).toBeNull()
    expect(parseTableSelected('nope')).toBeNull()
  })
})

describe('cellAtPoint', () => {
  const g = parseTableSelected(PAYLOAD)!
  it('finds the cell under a page point', () => {
    expect(cellAtPoint(g, 1418 + 100, 2000 + 100)).toEqual({ row: 0, col: 0 })
    expect(cellAtPoint(g, 1418 + 6000, 2000 + 100)).toEqual({ row: 0, col: 1 })
    expect(cellAtPoint(g, 1418 + 6000, 2000 + 700)).toEqual({ row: 1, col: 1 })
  })
  it('treats an inner edge as the start of the next band', () => {
    expect(cellAtPoint(g, 1418 + 4986, 2000 + 500)).toEqual({ row: 1, col: 1 })
  })
  it('returns null outside the table', () => {
    expect(cellAtPoint(g, 1000, 2100)).toBeNull()
    expect(cellAtPoint(g, 3000, 5000)).toBeNull()
  })
})
