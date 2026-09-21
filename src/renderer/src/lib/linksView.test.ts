import { describe, it, expect } from 'vitest'
import { baseName, humanLocation, groupLinksByFile, countByMetric } from './linksView'
import type { TransclusionLink } from '../types/workspace-api'

const link = (over: Partial<TransclusionLink>): TransclusionLink => ({
  id: 'link-1',
  metricId: 'metric-1',
  filePath: '/w/book.xlsx',
  target: { kind: 'xlsx-cell', sheet: 'Sheet1', cell: 'A1' },
  lastValue: 0,
  ...over,
})

describe('baseName', () => {
  it('takes the last path segment for / and \\ separators', () => {
    expect(baseName('/w/reports/book.xlsx')).toBe('book.xlsx')
    expect(baseName('C:\\docs\\deck.pptx')).toBe('deck.pptx')
    expect(baseName('bare.docx')).toBe('bare.docx')
  })
})

describe('humanLocation (per target kind)', () => {
  it('formats an Excel cell as Sheet!A1', () => {
    expect(humanLocation({ kind: 'xlsx-cell', sheet: 'Sheet1', cell: 'B2' })).toBe('Sheet1!B2')
  })

  it('drops the sheet prefix when the sheet is unknown', () => {
    expect(humanLocation({ kind: 'xlsx-cell', sheet: '', cell: 'C3' })).toBe('C3')
  })

  it('formats a Word content control', () => {
    expect(humanLocation({ kind: 'docx-cc', tag: 'wos-metric-1' })).toBe('¶ content control')
  })

  it('formats a PowerPoint shape with a 1-based slide number', () => {
    expect(humanLocation({ kind: 'pptx-shape', tag: 'wos-metric-1', slide: 0 })).toBe('slide 1 · shape')
    expect(humanLocation({ kind: 'pptx-shape', tag: 'wos-metric-1', slide: 4 })).toBe('slide 5 · shape')
  })

  it('omits the slide when unknown', () => {
    expect(humanLocation({ kind: 'pptx-shape', tag: 'wos-metric-1' })).toBe('shape')
  })
})

describe('groupLinksByFile', () => {
  it('groups by file preserving first-seen order + intra-file order', () => {
    const links = [
      link({ id: 'l1', filePath: '/w/a.xlsx', target: { kind: 'xlsx-cell', sheet: 'S', cell: 'A1' } }),
      link({ id: 'l2', filePath: '/w/b.docx', target: { kind: 'docx-cc', tag: 'wos-metric-1' } }),
      link({ id: 'l3', filePath: '/w/a.xlsx', target: { kind: 'xlsx-cell', sheet: 'S', cell: 'A2' } }),
    ]
    const groups = groupLinksByFile(links)
    expect(groups.map((g) => g.filePath)).toEqual(['/w/a.xlsx', '/w/b.docx'])
    expect(groups[0].fileName).toBe('a.xlsx')
    expect(groups[0].links.map((l) => l.id)).toEqual(['l1', 'l3'])
    expect(groups[1].links.map((l) => l.id)).toEqual(['l2'])
  })

  it('returns [] for no links', () => {
    expect(groupLinksByFile([])).toEqual([])
  })
})

describe('countByMetric', () => {
  it('counts links per metric id', () => {
    const links = [
      link({ metricId: 'metric-1' }),
      link({ metricId: 'metric-1' }),
      link({ metricId: 'metric-2' }),
    ]
    const counts = countByMetric(links)
    expect(counts.get('metric-1')).toBe(2)
    expect(counts.get('metric-2')).toBe(1)
    expect(counts.get('metric-3')).toBeUndefined()
  })
})
