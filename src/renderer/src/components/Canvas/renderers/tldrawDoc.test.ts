import { describe, it, expect } from 'vitest'
import { serializeDoc, parseDoc, emptyDoc, isDirty, type CanvasSnapshot } from './tldrawDoc'

/** A snapshot shaped like a real tldraw editor snapshot with a couple of shapes. */
const SNAPSHOT: CanvasSnapshot = {
  document: {
    'shape:a1': { id: 'shape:a1', type: 'geo', x: 10, y: 20, props: { w: 100, h: 80 } },
    'shape:b2': { id: 'shape:b2', type: 'text', x: 50, y: 60, props: { text: 'hello' } },
  },
  session: { currentPageId: 'page:main' },
}

describe('tldrawDoc — serialize/parse round-trip', () => {
  it('round-trips a snapshot with shapes losslessly', () => {
    const text = serializeDoc(SNAPSHOT)
    const back = parseDoc(text)
    expect(back).toEqual(SNAPSHOT)
  })

  it('produces valid, versioned envelope JSON', () => {
    const parsed = JSON.parse(serializeDoc(SNAPSHOT))
    expect(parsed.kind).toBe('workspace-os/canvas')
    expect(parsed.version).toBe(1)
    expect(parsed.snapshot).toEqual(SNAPSHOT)
  })

  it('emptyDoc serialises and re-parses to an empty snapshot', () => {
    const text = JSON.stringify(emptyDoc())
    expect(parseDoc(text)).toEqual({})
  })
})

describe('tldrawDoc — parseDoc never throws, degrades to empty snapshot', () => {
  it('empty string → empty snapshot', () => {
    expect(parseDoc('')).toEqual({})
  })

  it('whitespace-only → empty snapshot', () => {
    expect(parseDoc('   \n\t ')).toEqual({})
  })

  it('null / undefined → empty snapshot', () => {
    expect(parseDoc(null)).toEqual({})
    expect(parseDoc(undefined)).toEqual({})
  })

  it('invalid JSON → empty snapshot (does not throw)', () => {
    expect(parseDoc('{ not valid json')).toEqual({})
    expect(parseDoc('<html></html>')).toEqual({})
  })

  it('foreign / wrong-kind JSON → empty snapshot', () => {
    expect(parseDoc('{"kind":"something-else","snapshot":{"x":1}}')).toEqual({})
    expect(parseDoc('{"version":1,"snapshot":{}}')).toEqual({})
    expect(parseDoc('[1,2,3]')).toEqual({})
    expect(parseDoc('42')).toEqual({})
  })

  it('wrong version → empty snapshot', () => {
    expect(parseDoc('{"kind":"workspace-os/canvas","version":99,"snapshot":{"x":1}}')).toEqual({})
  })

  it('missing snapshot → empty snapshot', () => {
    expect(parseDoc('{"kind":"workspace-os/canvas","version":1}')).toEqual({})
  })
})

describe('tldrawDoc — isDirty', () => {
  it('is false for identical snapshots', () => {
    expect(isDirty(SNAPSHOT, structuredClone(SNAPSHOT))).toBe(false)
  })

  it('is true when a shape changed', () => {
    const changed = structuredClone(SNAPSHOT) as typeof SNAPSHOT
    ;(changed.document as Record<string, { x: number }>)['shape:a1'].x = 999
    expect(isDirty(SNAPSHOT, changed)).toBe(true)
  })

  it('empty vs empty is clean', () => {
    expect(isDirty({}, {})).toBe(false)
  })
})
