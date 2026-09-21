import { describe, it, expect } from 'vitest'
import { validateBasicModule, assertBasicModuleValid } from './validateBasicModule'
import { BASIC_MODULE, BASIC_MODULE_2 } from './lokMacros'

/** StarBasic enforces a ~64KB per-module limit; over it macros silently no-op. */
const MODULE_BYTE_LIMIT = 63000

/** Wraps a raw Basic body in the .xba module envelope the validator expects. */
function wrap(body: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<script:module xmlns:script="http://openoffice.org/2000/script" script:name="Module1" script:language="StarBasic">\n' +
    body +
    '\n</script:module>\n'
  )
}

describe('validateBasicModule — bad snippets', () => {
  it('flags a reserved word used as a Dim variable name (Dim alias)', () => {
    const problems = validateBasicModule(wrap('Sub Foo\n  Dim alias As String\nEnd Sub'))
    expect(problems.some((p) => /reserved.*alias/i.test(p))).toBe(true)
  })

  it('flags a reserved word among multiple comma-separated declarators', () => {
    const problems = validateBasicModule(wrap('Sub Foo\n  Dim ok As Integer, name As String\nEnd Sub'))
    expect(problems.some((p) => /reserved.*"name"/i.test(p))).toBe(true)
  })

  it('flags a reserved word used as a parameter name (oN reads as On)', () => {
    const problems = validateBasicModule(wrap('Function WosX(oN, sName As String)\n  WosX = oN\nEnd Function'))
    expect(problems.some((p) => /reserved.*"oN".*parameter/i.test(p))).toBe(true)
  })

  it('flags a module assembled with literal backslash-n instead of newlines', () => {
    const problems = validateBasicModule(wrap('Sub WosX\\n  Dim a\\nEnd Sub'))
    expect(problems.some((p) => /literal/i.test(p))).toBe(true)
  })

  it('flags a duplicate Sub name', () => {
    const problems = validateBasicModule(wrap('Sub Foo\nEnd Sub\nSub Foo\nEnd Sub'))
    expect(problems.some((p) => /duplicate sub name "Foo"/i.test(p))).toBe(true)
  })

  it('flags a duplicate Function name (case-insensitive)', () => {
    const problems = validateBasicModule(wrap('Function Bar\nEnd Function\nFunction bar\nEnd Function'))
    expect(problems.some((p) => /duplicate function name/i.test(p))).toBe(true)
  })

  it('flags an unescaped < in the Basic body', () => {
    const problems = validateBasicModule(wrap('Sub Foo\n  If n < 0 Then n = 0\nEnd Sub'))
    expect(problems.some((p) => /unescaped "<"/i.test(p))).toBe(true)
  })

  it('flags an unescaped > in the Basic body', () => {
    const problems = validateBasicModule(wrap('Sub Foo\n  If n > 0 Then n = 0\nEnd Sub'))
    expect(problems.some((p) => /unescaped ">"/i.test(p))).toBe(true)
  })

  it('flags a bare & (StarBasic concat) in the Basic body', () => {
    const problems = validateBasicModule(wrap('Sub Foo\n  s = "a" & "b"\nEnd Sub'))
    expect(problems.some((p) => /unescaped "&"/i.test(p))).toBe(true)
  })

  it('assertBasicModuleValid throws, naming the offending token', () => {
    expect(() => assertBasicModuleValid(wrap('Sub Foo\n  Dim alias As String\nEnd Sub'))).toThrow(/alias/)
  })
})

describe('validateBasicModule — clean snippets', () => {
  it('accepts a properly-escaped body (&lt; &gt; &amp;)', () => {
    const clean = wrap('Sub Foo\n  If n &lt; 0 Then n = 0\n  s = "a" &amp; "b"\n  If n &gt; 9 Then n = 9\nEnd Sub')
    expect(validateBasicModule(clean)).toEqual([])
  })

  it('accepts a reserved word as a Sub name (only Dim variables are reserved)', () => {
    expect(validateBasicModule(wrap('Sub WosFindReplace\nEnd Sub'))).toEqual([])
  })

  it('does not treat a reserved substring as a match (Dim aliasName)', () => {
    expect(validateBasicModule(wrap('Sub Foo\n  Dim aliasName As String\nEnd Sub'))).toEqual([])
  })
})

describe('the REAL seeded BASIC modules (regression net)', () => {
  for (const [name, mod] of [
    ['Module1', BASIC_MODULE],
    ['Module2', BASIC_MODULE_2],
  ] as const) {
    it(`${name} passes clean — never silently aborts every macro`, () => {
      expect(validateBasicModule(mod)).toEqual([])
    })

    it(`assertBasicModuleValid does not throw on ${name} (seed path is safe)`, () => {
      expect(() => assertBasicModuleValid(mod)).not.toThrow()
    })

    it(`${name} stays under the ~64KB StarBasic per-module limit`, () => {
      expect(Buffer.byteLength(mod, 'utf8')).toBeLessThan(MODULE_BYTE_LIMIT)
    })
  }
})
