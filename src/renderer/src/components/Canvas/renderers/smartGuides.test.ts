import { describe, expect, it } from 'vitest'
import { parseSiblingRects, snapRect } from './smartGuides'

describe('smartGuides', () => {
  const sib = [{ x: 1000, y: 1000, w: 2000, h: 1000 }]

  it('snaps a left edge to a sibling left edge within tolerance', () => {
    const r = snapRect({ x: 1040, y: 5000, w: 500, h: 500 }, sib, null, 60)
    expect(r.rect.x).toBe(1000)
    expect(r.guides.find((g) => g.axis === 'v')?.pos).toBe(1000)
    expect(r.rect.y).toBe(5000)
  })

  it('snaps centres too, and spans the guide across both boxes', () => {
    const r = snapRect({ x: 1760, y: 4000, w: 500, h: 500 }, sib, null, 60) // centre 2010 vs sibling centre 2000
    expect(r.rect.x).toBe(1750)
    const g = r.guides.find((x) => x.axis === 'v')!
    expect(g.pos).toBe(2000)
    expect(g.from).toBe(1000)
    expect(g.to).toBe(4500)
  })

  it('uses the page centre and edges', () => {
    const r = snapRect({ x: 4960, y: 100, w: 100, h: 100 }, [], { w: 10000, h: 8000 }, 60)
    expect(r.rect.x).toBe(4950) // centred on the page
    expect(r.guides[0]).toMatchObject({ axis: 'v', pos: 5000 })
  })

  it('leaves the box alone beyond tolerance', () => {
    const r = snapRect({ x: 1300, y: 5000, w: 500, h: 500 }, sib, null, 60)
    expect(r.rect).toEqual({ x: 1300, y: 5000, w: 500, h: 500 })
    expect(r.guides).toEqual([])
  })

  it('parses sibling rects and drops the selected shape', () => {
    const rects = parseSiblingRects('0|1400|628|25199|2629|0\n1|5000|5000|7000|4500|1\nbad\n')
    expect(rects).toHaveLength(1)
    expect(rects[0]).toEqual({ x: 794, y: 356, w: 14286, h: 1490 })
  })
})
