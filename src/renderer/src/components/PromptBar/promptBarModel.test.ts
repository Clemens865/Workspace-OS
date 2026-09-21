import { describe, it, expect } from 'vitest'
import { tokenAt, filterFiles, filterCommands, filterCases, replaceToken, mentionBlock, fileName } from './promptBarModel'

describe('tokenAt', () => {
  it('detects an @ token at the caret', () => {
    expect(tokenAt('summarize @rep', 14)).toEqual({ kind: '@', query: 'rep', start: 10, end: 14 })
  })

  it('an @ must start a word — an email address is not a mention', () => {
    expect(tokenAt('mail anna@x.com', 15)).toBeNull()
  })

  it('a slash counts only at the very start — a path is not a command', () => {
    expect(tokenAt('/sum', 4)).toEqual({ kind: '/', query: 'sum', start: 0, end: 4 })
    expect(tokenAt('open /Users/c', 13)).toBeNull()
  })

  it('a completed word (whitespace after) is no longer a token', () => {
    expect(tokenAt('@notes.md next', 14)).toBeNull()
  })

  it('nothing typed → @ still opens with an empty query', () => {
    expect(tokenAt('see @', 5)).toEqual({ kind: '@', query: '', start: 4, end: 5 })
  })
})

describe('filterFiles', () => {
  const files = ['/w/Jobs/scan.xlsx', '/w/notes.md', '/w/cv/Resume.pdf', '/w/Cases/alpla.md']

  it('prefix on the basename wins over substring', () => {
    expect(filterFiles(files, 'no')[0]).toBe('/w/notes.md')
  })

  it('matches case-insensitively on name, then path', () => {
    expect(filterFiles(files, 'resume')).toEqual(['/w/cv/Resume.pdf'])
    expect(filterFiles(files, 'cases')).toEqual(['/w/Cases/alpla.md'])
  })

  it('a subsequence finds what a contiguous substring cannot — cvfon → CV_fonio', () => {
    // A space would END the token, so "cv fonio" is untypeable; the loose
    // match has to do what a second word cannot.
    const cvs = ['/w/cv/Clemens_CV_fonio.pdf', '/w/cv/Clemens_CV_Philips.pdf', '/w/cv/Clemens_CV_ALPLA.pdf']
    expect(filterFiles(cvs, 'cvfon')).toEqual(['/w/cv/Clemens_CV_fonio.pdf'])
    expect(filterFiles(cvs, 'cvphil')).toEqual(['/w/cv/Clemens_CV_Philips.pdf'])
  })

  it('the window fits a whole folder of similar names — twenty CVs are all reachable', () => {
    const many = Array.from({ length: 25 }, (_, i) => `/w/cv/CV_variant_${String(i).padStart(2, '0')}.pdf`)
    expect(filterFiles(many, 'cv')).toHaveLength(25)
  })

  it('still caps at the window size', () => {
    const many = Array.from({ length: 60 }, (_, i) => `/w/f${i}.md`)
    expect(filterFiles(many, 'f')).toHaveLength(40)
    expect(filterFiles(many, 'f', 8)).toHaveLength(8)
  })
})

describe('filterCommands', () => {
  const cmds = [{ name: 'summarize' }, { name: 'office-docgen' }, { name: 'newsical' }]
  it('prefix first, substring after', () => {
    expect(filterCommands(cmds, 'sum').map((c) => c.name)).toEqual(['summarize'])
    expect(filterCommands(cmds, 'gen').map((c) => c.name)).toEqual(['office-docgen'])
  })
})

describe('replaceToken / mentionBlock', () => {
  it('replaces the token and places the caret after the replacement', () => {
    const tok = tokenAt('see @rep now'.slice(0, 8), 8)!
    const r = replaceToken('see @rep now', tok, '')
    expect(r.text).toBe('see  now')
    expect(r.caret).toBe(4)
  })

  it('renders the text-context block for ask surfaces', () => {
    expect(mentionBlock([])).toBe('')
    expect(mentionBlock(['/w/a.md'])).toContain('Files to consider:')
    expect(mentionBlock(['/w/a.md'])).toContain('- /w/a.md')
  })

  it('fileName strips directories', () => {
    expect(fileName('/w/deep/notes.md')).toBe('notes.md')
  })
})

describe('tokenAt — # mentions a case', () => {
  it('opens on a word-start #', () => {
    expect(tokenAt('prep using #ste', 15)).toEqual({ kind: '#', query: 'ste', start: 11, end: 15 })
    expect(tokenAt('#tax', 4)).toEqual({ kind: '#', query: 'tax', start: 0, end: 4 })
  })
  it('ignores a # mid-word (e.g. issue #3)', () => {
    expect(tokenAt('issue#3', 7)).toBeNull()
  })
})

describe('filterCases', () => {
  const cases = [
    { id: 'steuer-2025', title: 'Steuer 2025', status: 'in-progress' },
    { id: 'client-tender', title: 'Client X tender', status: 'open' },
    { id: 'job-hunt', title: 'Job hunt', status: 'open' },
  ]
  it('matches title or id, empty query returns all', () => {
    expect(filterCases(cases, '').length).toBe(3)
    expect(filterCases(cases, 'ste').map((c) => c.id)).toEqual(['steuer-2025'])
    expect(filterCases(cases, 'tender').map((c) => c.id)).toEqual(['client-tender'])
  })
  it('subsequence match on title', () => {
    expect(filterCases(cases, 'jbh').map((c) => c.id)).toEqual(['job-hunt'])
  })
})
