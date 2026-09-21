import { describe, it, expect } from 'vitest'
import { shellQuote } from './shellQuote'

describe('shellQuote', () => {
  it('leaves a plain path unquoted', () => {
    expect(shellQuote('/Users/me/notes.md')).toBe('/Users/me/notes.md')
    expect(shellQuote('report-v2.final_1.csv')).toBe('report-v2.final_1.csv')
  })

  it('single-quotes a path containing spaces', () => {
    expect(shellQuote('/Users/me/My Documents/file.txt')).toBe("'/Users/me/My Documents/file.txt'")
  })

  it("escapes existing single quotes with '\\''", () => {
    expect(shellQuote("/tmp/it's here.txt")).toBe("'/tmp/it'\\''s here.txt'")
  })

  it('single-quotes shell metacharacters', () => {
    expect(shellQuote('/tmp/a$b*c.txt')).toBe("'/tmp/a$b*c.txt'")
    expect(shellQuote('/tmp/(x).txt')).toBe("'/tmp/(x).txt'")
  })

  it('quotes an empty string', () => {
    expect(shellQuote('')).toBe("''")
  })
})
