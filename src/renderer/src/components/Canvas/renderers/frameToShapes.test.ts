import { describe, it, expect } from 'vitest'
import {
  frameToSlideSpec,
  encodeSlidePayload,
  PT_TO_MM100,
  type FrameSource,
  type TlShape,
} from './frameToShapes'

// A minimal in-memory FrameSource — no tldraw runtime, no DOM. Shapes are keyed
// by id; children are the ordered ids returned for a parent.
function makeSource(shapes: TlShape[], children: Record<string, string[]>): FrameSource {
  const byId = new Map(shapes.map((s) => [s.id, s]))
  return {
    getShape: (id) => byId.get(id),
    getSortedChildIdsForParent: (id) => children[id] ?? [],
  }
}

const FRAME: TlShape = { id: 'frame:1', type: 'frame', x: 100, y: 50, props: { w: 720, h: 540 } }

describe('frameToSlideSpec', () => {
  it('maps a geo rectangle: frame-relative position/size in 1/100 mm, fill + text', () => {
    const rect: TlShape = {
      id: 'shape:r',
      type: 'geo',
      x: 110, // 10px right of the frame origin
      y: 70, // 20px below
      props: { geo: 'rectangle', w: 200, h: 100, color: 'blue', fill: 'solid', text: 'Box' },
    }
    const src = makeSource([FRAME, rect], { 'frame:1': ['shape:r'] })
    const spec = frameToSlideSpec(src, 'frame:1')

    expect(spec.imageFallback).toHaveLength(0)
    expect(spec.shapes).toHaveLength(1)
    const s = spec.shapes[0]
    expect(s.kind).toBe('rect')
    expect(s.x).toBe(Math.round(10 * PT_TO_MM100))
    expect(s.y).toBe(Math.round(20 * PT_TO_MM100))
    expect(s.w).toBe(Math.round(200 * PT_TO_MM100))
    expect(s.h).toBe(Math.round(100 * PT_TO_MM100))
    expect(s.fill).toBe(0x4465e9) // tldraw "blue"
    expect(s.text).toBe('Box')
    // slide size = frame bounds
    expect(spec.slideW).toBe(Math.round(720 * PT_TO_MM100))
    expect(spec.slideH).toBe(Math.round(540 * PT_TO_MM100))
  })

  it('maps a geo ellipse and honours fill:none → fill -1', () => {
    const ell: TlShape = {
      id: 'shape:e',
      type: 'geo',
      x: 100,
      y: 50,
      props: { geo: 'ellipse', w: 80, h: 80, color: 'red', fill: 'none' },
    }
    const src = makeSource([FRAME, ell], { 'frame:1': ['shape:e'] })
    const spec = frameToSlideSpec(src, 'frame:1')
    expect(spec.shapes).toHaveLength(1)
    expect(spec.shapes[0].kind).toBe('ellipse')
    expect(spec.shapes[0].fill).toBe(-1)
  })

  it('maps a text shape with richText and a font size token', () => {
    const txt: TlShape = {
      id: 'shape:t',
      type: 'text',
      x: 100,
      y: 50,
      props: {
        w: 300,
        h: 40,
        size: 'l',
        color: 'black',
        richText: { content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello Slide' }] }] },
      },
    }
    const src = makeSource([FRAME, txt], { 'frame:1': ['shape:t'] })
    const spec = frameToSlideSpec(src, 'frame:1')
    expect(spec.shapes).toHaveLength(1)
    expect(spec.shapes[0].kind).toBe('text')
    expect(spec.shapes[0].text).toBe('Hello Slide')
    expect(spec.shapes[0].fontSize).toBe(24) // 'l' → 24pt
  })

  it('maps a line to a native line spec (end-delta geometry)', () => {
    const line: TlShape = {
      id: 'shape:l',
      type: 'line',
      x: 100,
      y: 50,
      props: {
        color: 'grey',
        points: { a1: { x: 0, y: 0 }, a2: { x: 150, y: 60 } },
      },
    }
    const src = makeSource([FRAME, line], { 'frame:1': ['shape:l'] })
    const spec = frameToSlideSpec(src, 'frame:1')
    expect(spec.shapes).toHaveLength(1)
    expect(spec.shapes[0].kind).toBe('line')
    expect(spec.shapes[0].w).toBe(Math.round(150 * PT_TO_MM100))
    expect(spec.shapes[0].h).toBe(Math.round(60 * PT_TO_MM100))
  })

  it('routes unsupported types (draw/arrow/image) and complex geo to imageFallback', () => {
    const shapes: TlShape[] = [
      FRAME,
      { id: 'shape:d', type: 'draw', x: 100, y: 50, props: {} },
      { id: 'shape:a', type: 'arrow', x: 100, y: 50, props: {} },
      { id: 'shape:i', type: 'image', x: 100, y: 50, props: { w: 10, h: 10 } },
      { id: 'shape:star', type: 'geo', x: 100, y: 50, props: { geo: 'star', w: 40, h: 40 } },
    ]
    const src = makeSource(shapes, { 'frame:1': ['shape:d', 'shape:a', 'shape:i', 'shape:star'] })
    const spec = frameToSlideSpec(src, 'frame:1')
    expect(spec.shapes).toHaveLength(0)
    expect(spec.imageFallback.map((f) => f.id).sort()).toEqual(['shape:a', 'shape:d', 'shape:i', 'shape:star'])
  })

  it('preserves child z-order and mixes native + fallback', () => {
    const shapes: TlShape[] = [
      FRAME,
      { id: 'shape:r', type: 'geo', x: 100, y: 50, props: { geo: 'rectangle', w: 10, h: 10 } },
      { id: 'shape:d', type: 'draw', x: 100, y: 50, props: {} },
      { id: 'shape:e', type: 'geo', x: 100, y: 50, props: { geo: 'ellipse', w: 10, h: 10 } },
    ]
    const src = makeSource(shapes, { 'frame:1': ['shape:r', 'shape:d', 'shape:e'] })
    const spec = frameToSlideSpec(src, 'frame:1')
    expect(spec.shapes.map((s) => s.kind)).toEqual(['rect', 'ellipse'])
    expect(spec.imageFallback).toHaveLength(1)
  })

  it('empty frame → empty spec', () => {
    const src = makeSource([FRAME], { 'frame:1': [] })
    const spec = frameToSlideSpec(src, 'frame:1')
    expect(spec.shapes).toHaveLength(0)
    expect(spec.imageFallback).toHaveLength(0)
  })

  it('missing frame → empty spec (no throw)', () => {
    const src = makeSource([], {})
    const spec = frameToSlideSpec(src, 'frame:none')
    expect(spec.shapes).toHaveLength(0)
    expect(spec.slideW).toBe(0)
  })
})

describe('encodeSlidePayload', () => {
  it('line 1 = size header, then one pipe-delimited line per shape', () => {
    const rect: TlShape = {
      id: 'shape:r',
      type: 'geo',
      x: 100,
      y: 50,
      props: { geo: 'rectangle', w: 100, h: 50, color: 'blue', fill: 'solid', text: 'Hi' },
    }
    const src = makeSource([FRAME, rect], { 'frame:1': ['shape:r'] })
    const payload = encodeSlidePayload(frameToSlideSpec(src, 'frame:1'))
    const lines = payload.trimEnd().split('\n')
    expect(lines[0]).toBe(`${Math.round(720 * PT_TO_MM100)}|${Math.round(540 * PT_TO_MM100)}`)
    const cols = lines[1].split('|')
    expect(cols[0]).toBe('rect')
    expect(cols[5]).toBe(String(0x4465e9)) // fill
    expect(cols[8]).toBe('Hi') // text last
  })

  it('strips newlines/pipes from text so the payload stays line-delimited', () => {
    const txt: TlShape = {
      id: 'shape:t',
      type: 'text',
      x: 100,
      y: 50,
      props: { w: 100, h: 20, text: 'a|b\nc' },
    }
    const src = makeSource([FRAME, txt], { 'frame:1': ['shape:t'] })
    const payload = encodeSlidePayload(frameToSlideSpec(src, 'frame:1'))
    const lines = payload.trimEnd().split('\n')
    expect(lines).toHaveLength(2) // header + 1 shape (no extra line from the \n in text)
    expect(lines[1].split('|').pop()).toBe('a b c')
  })
})
