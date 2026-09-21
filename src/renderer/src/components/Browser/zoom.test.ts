import { describe, it, expect } from 'vitest'
import { originOf, levelToPercent, clampLevel, MIN_LEVEL, MAX_LEVEL } from './zoom'

/**
 * Persistence is deliberately NOT tested here, because it is deliberately not
 * ours: Chromium stores zoom per origin inside the persistent partition. An
 * earlier version of this module kept a parallel record in localStorage, and
 * the two disagreed — a fresh launch reported level 5 for a site whose stored
 * level had just been cleared. What is left is the arithmetic.
 */

describe('the zoom ladder', () => {
  it('reports familiar percentages', () => {
    expect(levelToPercent(0)).toBe(100)
    expect(levelToPercent(1)).toBe(120)
    expect(levelToPercent(2)).toBe(144)
    expect(levelToPercent(-1)).toBe(83)
  })

  it('clamps rather than zooming to nothing or to absurdity', () => {
    expect(clampLevel(-99)).toBe(MIN_LEVEL)
    expect(clampLevel(99)).toBe(MAX_LEVEL)
    expect(clampLevel(2)).toBe(2)
  })
})

describe('the origin a zoom belongs to', () => {
  it('is the scheme, host and port', () => {
    expect(originOf('https://a.com/page?x=1#y')).toBe('https://a.com')
    expect(originOf('http://localhost:5173/x')).toBe('http://localhost:5173')
  })

  it('separates http from https, as the web does', () => {
    expect(originOf('http://a.com/')).not.toBe(originOf('https://a.com/'))
  })

  it('is empty for something that is not a url', () => {
    expect(originOf('about:blank')).toBe('')
    expect(originOf('')).toBe('')
  })
})
