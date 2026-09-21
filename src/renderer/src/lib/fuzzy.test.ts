import { describe, it, expect } from 'vitest'
import { fuzzyScore, rankFiles } from './fuzzy'

describe('fuzzyScore', () => {
  it('matches an exact substring with the highest scores', () => {
    const exact = fuzzyScore('report', 'q3-report.docx')
    const scattered = fuzzyScore('report', 'r-e-p-o-r-t-x.md')
    expect(exact).not.toBeNull()
    expect(scattered).not.toBeNull()
    expect(exact!).toBeGreaterThan(scattered!)
  })

  it('matches subsequences case-insensitively', () => {
    expect(fuzzyScore('QRep', 'Quarterly Report.docx')).not.toBeNull()
    expect(fuzzyScore('qrd', 'quarterly-report.docx')).not.toBeNull()
  })

  it('rejects non-subsequences', () => {
    expect(fuzzyScore('xyz', 'report.docx')).toBeNull()
    expect(fuzzyScore('reportzz', 'report.docx')).toBeNull()
  })

  it('prefers word-boundary matches', () => {
    const boundary = fuzzyScore('qr', 'quarterly-report.md') // q + r both start words
    const interior = fuzzyScore('qr', 'squire.md') // scattered mid-word subsequence
    expect(boundary!).toBeGreaterThan(interior!)
  })

  it('returns 0 for an empty query (matches everything)', () => {
    expect(fuzzyScore('', 'anything.txt')).toBe(0)
  })
})

describe('rankFiles', () => {
  const files = [
    '/ws/notes/meeting-notes.md',
    '/ws/reports/q3-report.docx',
    '/ws/deep/nested/other.txt',
  ]

  it('drops non-matching files', () => {
    const ranked = rankFiles('report', files)
    expect(ranked.map((r) => r.path)).toEqual(['/ws/reports/q3-report.docx'])
  })

  it('weights basename matches over path-only matches', () => {
    const ranked = rankFiles('notes', ['/ws/notes/other.txt', '/ws/x/meeting-notes.md'])
    expect(ranked[0].path).toBe('/ws/x/meeting-notes.md')
  })

  it('puts recents first on an empty query', () => {
    const ranked = rankFiles('', files, ['/ws/deep/nested/other.txt'])
    expect(ranked[0].path).toBe('/ws/deep/nested/other.txt')
    expect(ranked).toHaveLength(3)
  })

  it('boosts recent files on ties', () => {
    const a = '/ws/a/plan.md'
    const b = '/ws/b/plan.md'
    const ranked = rankFiles('plan', [a, b], [b])
    expect(ranked[0].path).toBe(b)
  })
})
