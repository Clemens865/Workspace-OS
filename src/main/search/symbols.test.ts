import { describe, it, expect } from 'vitest'
import { extractSymbols, hasSymbolSupport } from './symbols'

describe('extractSymbols', () => {
  it('extracts markdown headings with levels and line numbers', () => {
    const md = ['# Title', '', 'intro text', '', '## Section One', 'body', '### Sub'].join('\n')
    const syms = extractSymbols('md', md)
    expect(syms.map((s) => s.name)).toEqual(['Title', 'Section One', 'Sub'])
    expect(syms.every((s) => s.kind === 'heading')).toBe(true)
    // 1-based line numbers.
    expect(syms[0].line).toBe(1)
    expect(syms[1].line).toBe(5)
    expect(syms[2].line).toBe(7)
  })

  it('strips trailing closing hashes from ATX headings', () => {
    const syms = extractSymbols('markdown', '## Heading ##')
    expect(syms).toEqual([{ name: 'Heading', kind: 'heading', line: 1 }])
  })

  it('extracts TypeScript functions, classes, interfaces, types and consts', () => {
    const ts = [
      'export function doThing() {}',
      'export class Widget {}',
      'export interface Shape {}',
      'export type Id = string',
      'export const answer = 42',
      'function helper() {}',
    ].join('\n')
    const syms = extractSymbols('ts', ts)
    const byName = Object.fromEntries(syms.map((s) => [s.name, s.kind]))
    expect(byName.doThing).toBe('function')
    expect(byName.Widget).toBe('class')
    expect(byName.Shape).toBe('interface')
    expect(byName.Id).toBe('type')
    expect(byName.answer).toBe('const')
    expect(byName.helper).toBe('function')
    // Symbols come back ordered by line.
    expect(syms[0].name).toBe('doThing')
    expect(syms[0].line).toBe(1)
  })

  it('does not double-count a symbol matched by overlapping patterns', () => {
    const ts = 'export function once() {}'
    const syms = extractSymbols('ts', ts)
    expect(syms.filter((s) => s.name === 'once')).toHaveLength(1)
  })

  it('extracts Python def and class symbols', () => {
    const py = ['class Model:', '    def train(self):', '        pass', 'async def run():', '    pass'].join('\n')
    const syms = extractSymbols('py', py)
    const names = syms.map((s) => s.name)
    expect(names).toContain('Model')
    expect(names).toContain('run')
  })

  it('returns nothing for unsupported types or empty content', () => {
    expect(extractSymbols('pdf', 'some extracted text')).toEqual([])
    expect(extractSymbols('ts', '')).toEqual([])
  })

  it('reports symbol support by extension', () => {
    expect(hasSymbolSupport('md')).toBe(true)
    expect(hasSymbolSupport('TS')).toBe(true)
    expect(hasSymbolSupport('py')).toBe(true)
    expect(hasSymbolSupport('pdf')).toBe(false)
    expect(hasSymbolSupport('png')).toBe(false)
  })
})
