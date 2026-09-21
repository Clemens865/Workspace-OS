import { describe, it, expect } from 'vitest'
import { applySuggestion, suggestFunctions, tokenAt, CALC_FUNCTIONS } from './calcFunctions'

describe('tokenAt', () => {
  it('finds the name being typed right after =', () => {
    expect(tokenAt('=SU', 3)).toEqual({ word: 'SU', start: 1 })
  })

  it('suggests nothing when the cell is not a formula', () => {
    // A plain text or numeric cell has no functions to offer.
    expect(tokenAt('SU', 2).word).toBe('')
    expect(tokenAt('123', 3).word).toBe('')
  })

  it('finds a name after an operator, mid-formula', () => {
    const t = tokenAt('=SUM(A1)+AV', 11)
    expect(t.word).toBe('AV')
    expect(t.start).toBe(9)
  })

  it('finds a name after an opening bracket and after a separator', () => {
    expect(tokenAt('=IF(SU', 6).word).toBe('SU')
    expect(tokenAt('=IF(A1;SU', 9).word).toBe('SU')
  })

  it('does NOT treat a cell reference as a half-typed function', () => {
    // "A1" is a reference; offering functions there would be noise.
    expect(tokenAt('=A1', 3).word).toBe('')
  })

  it('reads from the caret, not the end of the text', () => {
    expect(tokenAt('=SUM(A1)', 3)).toEqual({ word: 'SU', start: 1 })
  })

  it('upper-cases so lower-case typing still matches', () => {
    expect(tokenAt('=su', 3).word).toBe('SU')
  })
})

describe('suggestFunctions', () => {
  it('returns nothing for an empty word', () => {
    expect(suggestFunctions('')).toEqual([])
  })

  it('puts the shorter, commoner name first for a shared prefix', () => {
    const names = suggestFunctions('SUM').map((f) => f.name)
    expect(names[0]).toBe('SUM')
    expect(names).toContain('SUMIF')
    expect(names).toContain('SUMIFS')
  })

  it('is case-insensitive', () => {
    expect(suggestFunctions('vlook').map((f) => f.name)).toContain('VLOOKUP')
  })

  it('finds a half-remembered name by substring', () => {
    expect(suggestFunctions('LOOK').map((f) => f.name)).toContain('VLOOKUP')
  })

  it('does not substring-match on a single character — too noisy', () => {
    for (const f of suggestFunctions('X')) expect(f.name.startsWith('X')).toBe(true)
  })

  it('respects the limit', () => {
    expect(suggestFunctions('S', 3)).toHaveLength(3)
  })
})

describe('applySuggestion', () => {
  const fn = (name: string) => CALC_FUNCTIONS.find((f) => f.name === name)!

  it('replaces the partial name and puts the caret inside the brackets', () => {
    const r = applySuggestion('=SU', tokenAt('=SU', 3), fn('SUM'), 3)
    expect(r.text).toBe('=SUM()')
    expect(r.caret).toBe(5) // between ( and )
  })

  it('puts the caret AFTER the brackets for a no-argument function', () => {
    const r = applySuggestion('=TOD', tokenAt('=TOD', 4), fn('TODAY'), 4)
    expect(r.text).toBe('=TODAY()')
    expect(r.caret).toBe(8)
  })

  it('preserves text on both sides when completing mid-formula', () => {
    const text = '=SUM(A1)+AV'
    const r = applySuggestion(text, tokenAt(text, 11), fn('AVERAGE'), 11)
    expect(r.text).toBe('=SUM(A1)+AVERAGE()')
  })

  it('keeps a trailing tail intact', () => {
    const text = '=SU+1'
    const r = applySuggestion(text, tokenAt(text, 3), fn('SUM'), 3)
    expect(r.text).toBe('=SUM()+1')
  })
})

describe('the catalog itself', () => {
  it('has no duplicate names', () => {
    const names = CALC_FUNCTIONS.map((f) => f.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('gives every function a plain-language description', () => {
    for (const f of CALC_FUNCTIONS) {
      expect(f.desc.length).toBeGreaterThan(0)
      expect(f.name).toBe(f.name.toUpperCase())
    }
  })
})
