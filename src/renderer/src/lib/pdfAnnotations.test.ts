import { describe, it, expect } from 'vitest'
import {
  toPdfPoint, toScreenPoint, toPdfRect, toScreenRect, rectContains,
  mergeLineRects, hexToRgb01, boundsOf, decodeAnnotationDoc, isAnnotation, forPage,
  type Annotation,
} from './pdfAnnotations'

/** A page 800 CSS px tall rendered at 2×, i.e. 400 user-space units. */
const vp = { width: 600, height: 800, scale: 2 }

describe('coordinate conversion', () => {
  it('flips the origin: screen top is PDF top', () => {
    // Screen y=0 (top edge) is the HIGHEST point in PDF space, not the lowest.
    expect(toPdfPoint(0, 0, vp)).toEqual({ x: 0, y: 400 })
    expect(toPdfPoint(0, 800, vp)).toEqual({ x: 0, y: 0 })
  })

  it('divides out the render scale so a zoom does not move anything', () => {
    expect(toPdfPoint(200, 400, vp)).toEqual({ x: 100, y: 200 })
    const zoomed = { ...vp, height: 1600, scale: 4 }
    // Same point on the page at a different zoom → same PDF coordinates.
    expect(toPdfPoint(400, 800, zoomed)).toEqual({ x: 100, y: 200 })
  })

  it('round-trips a point', () => {
    const p = toPdfPoint(123, 456, vp)
    const back = toScreenPoint(p.x, p.y, vp)
    expect(back.x).toBeCloseTo(123)
    expect(back.y).toBeCloseTo(456)
  })

  it("maps a screen rect's TOP edge to the PDF rect's top", () => {
    // The off-by-its-own-height bug: a 40px-tall box at screen y=100 occupies
    // PDF y 330..350 (not 350..370).
    const r = toPdfRect({ x: 100, y: 100, w: 200, h: 40 }, vp)
    expect(r).toEqual({ x: 50, y: 330, w: 100, h: 20 })
    expect(r.y + r.h).toBe(350) // top edge
  })

  it('round-trips a rect', () => {
    const screen = { x: 40, y: 60, w: 120, h: 30 }
    const back = toScreenRect(toPdfRect(screen, vp), vp)
    expect(back.x).toBeCloseTo(screen.x)
    expect(back.y).toBeCloseTo(screen.y)
    expect(back.w).toBeCloseTo(screen.w)
    expect(back.h).toBeCloseTo(screen.h)
  })

  it('a highlight near the page top stays near the top after a round trip', () => {
    // Guards the mirroring bug end-to-end: a rect 10px from the top must come
    // back 10px from the top, not 10px from the bottom.
    const near = { x: 0, y: 10, w: 50, h: 20 }
    expect(toScreenRect(toPdfRect(near, vp), vp).y).toBeCloseTo(10)
  })
})

describe('rectContains', () => {
  const r = { x: 10, y: 10, w: 100, h: 50 }
  it('includes inside points and edges, excludes outside', () => {
    expect(rectContains(r, 50, 30)).toBe(true)
    expect(rectContains(r, 10, 10)).toBe(true)
    expect(rectContains(r, 110, 60)).toBe(true)
    expect(rectContains(r, 5, 30)).toBe(false)
    expect(rectContains(r, 50, 61)).toBe(false)
  })
})

describe('mergeLineRects', () => {
  it('unions rects on the same line into one quad', () => {
    // Three words on one line would otherwise paint as three boxes with seams.
    const merged = mergeLineRects([
      { x: 10, y: 100, w: 30, h: 12 },
      { x: 42, y: 101, w: 25, h: 12 },
      { x: 70, y: 100, w: 40, h: 12 },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].x).toBe(10)
    expect(merged[0].w).toBe(100) // 10 → 110
  })

  it('keeps separate lines separate', () => {
    const merged = mergeLineRects([
      { x: 10, y: 100, w: 50, h: 12 },
      { x: 10, y: 130, w: 50, h: 12 },
    ])
    expect(merged).toHaveLength(2)
  })

  it('drops zero-area rects (empty text nodes produce them)', () => {
    expect(mergeLineRects([{ x: 0, y: 0, w: 0, h: 12 }, { x: 0, y: 0, w: 10, h: 0 }])).toEqual([])
  })

  it('returns nothing for an empty selection', () => {
    expect(mergeLineRects([])).toEqual([])
  })

  it('respects the line tolerance for slightly-offset rects', () => {
    // Sub/superscript nudges a rect a pixel or two; still the same line.
    expect(mergeLineRects([
      { x: 10, y: 100, w: 30, h: 12 },
      { x: 42, y: 102, w: 25, h: 12 },
    ], 4)).toHaveLength(1)
  })
})

describe('hexToRgb01', () => {
  it('converts to the 0–1 triple PDF uses', () => {
    expect(hexToRgb01('#ffffff')).toEqual({ r: 1, g: 1, b: 1 })
    expect(hexToRgb01('#000000')).toEqual({ r: 0, g: 0, b: 0 })
    expect(hexToRgb01('ff0000').r).toBe(1)
  })

  it('falls back to a readable colour instead of throwing', () => {
    expect(hexToRgb01('nonsense').r).toBeGreaterThan(0)
  })
})

describe('boundsOf', () => {
  it('unions quads into the enclosing rect', () => {
    expect(boundsOf([{ x: 10, y: 10, w: 20, h: 10 }, { x: 40, y: 30, w: 20, h: 10 }]))
      .toEqual({ x: 10, y: 10, w: 50, h: 30 })
  })

  it('is null for no quads', () => {
    expect(boundsOf([])).toBeNull()
  })
})

const highlight: Annotation = {
  id: 'a', kind: 'highlight', page: 1, color: '#ffd400', createdAt: 2,
  quads: [{ x: 1, y: 2, w: 3, h: 4 }],
}

describe('isAnnotation', () => {
  it('accepts each valid kind', () => {
    expect(isAnnotation(highlight)).toBe(true)
    expect(isAnnotation({ id: 'b', kind: 'note', page: 1, color: '#f00', createdAt: 1, x: 5, y: 6 })).toBe(true)
    expect(isAnnotation({ id: 'c', kind: 'ink', page: 1, color: '#f00', createdAt: 1, width: 2, strokes: [[{ x: 1, y: 2 }]] })).toBe(true)
  })

  it('rejects malformed entries rather than rendering them wrong', () => {
    expect(isAnnotation({ ...highlight, quads: [] })).toBe(false)
    expect(isAnnotation({ ...highlight, page: 0 })).toBe(false)
    expect(isAnnotation({ ...highlight, quads: [{ x: 'a', y: 2, w: 3, h: 4 }] })).toBe(false)
    expect(isAnnotation({ id: 'x', kind: 'unknown', page: 1, color: '#f00', createdAt: 1 })).toBe(false)
    expect(isAnnotation(null)).toBe(false)
  })
})

describe('decodeAnnotationDoc', () => {
  it('keeps the valid entries and drops only the broken one', () => {
    // Losing one annotation beats losing the whole document's markup.
    const doc = decodeAnnotationDoc({ version: 1, file: 'a.pdf', annotations: [highlight, { junk: true }] }, 'a.pdf')
    expect(doc.annotations).toHaveLength(1)
  })

  it('returns an empty doc for junk instead of throwing', () => {
    expect(decodeAnnotationDoc(null, 'a.pdf').annotations).toEqual([])
    expect(decodeAnnotationDoc({ annotations: 'nope' }, 'a.pdf').annotations).toEqual([])
  })
})

describe('forPage', () => {
  it('filters by page and paints oldest first', () => {
    const later = { ...highlight, id: 'b', createdAt: 9 }
    const other = { ...highlight, id: 'c', page: 2 }
    expect(forPage([later, highlight, other], 1).map((a) => a.id)).toEqual(['a', 'b'])
  })
})
