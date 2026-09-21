import { describe, it, expect } from 'vitest'
import { buildMap, relKey, mapStatus, fileGlyph, type MapInput } from './mapModel'
import type { WorkCase } from '../../types/workspace-api'

const ROOT = '/Users/me/ws'

function wcase(over: Partial<WorkCase> = {}): WorkCase {
  return {
    id: 'c1',
    type: 'application',
    title: 'Yorizon',
    description: '',
    subject: '',
    status: 'drafted',
    artifacts: [],
    notes: [],
    acted: [],
    created: '2026-09-01T10:00:00Z',
    updated: '2026-09-01T10:00:00Z',
    ...over,
  }
}

function input(over: Partial<MapInput> = {}): MapInput {
  return {
    root: ROOT,
    cases: [],
    runs: [],
    metrics: [],
    links: [],
    waiting: new Set(['drafted', 'interview', 'offer']),
    terminal: new Set(['won', 'lost', 'done']),
    ...over,
  }
}

describe('relKey', () => {
  it('strips the root from an absolute path and leaves a relative one alone', () => {
    expect(relKey(`${ROOT}/out/letter.docx`, ROOT)).toBe('out/letter.docx')
    expect(relKey('out/letter.docx', ROOT)).toBe('out/letter.docx')
    expect(relKey('./out/letter.docx', ROOT)).toBe('out/letter.docx')
  })
  it('keeps a foreign absolute path whole, and copes with no root', () => {
    expect(relKey('/elsewhere/x.md', ROOT)).toBe('elsewhere/x.md')
    expect(relKey('/a/b.md', null)).toBe('a/b.md')
    expect(relKey(`${ROOT}/`, ROOT)).toBe('')
  })
})

describe('buildMap — territories and documents', () => {
  it("a run's absolute artifact and a case's relative one are the same document", () => {
    const m = buildMap(
      input({
        cases: [wcase({ artifacts: ['out/letter.docx'] })],
        runs: [{ agentName: 'Elias', sessionName: 's', artifacts: [{ path: `${ROOT}/out/letter.docx`, name: 'letter.docx' }] }],
      }),
    )
    expect(m.territories).toHaveLength(1)
    const [f] = m.territories[0].files
    expect(f.key).toBe('out/letter.docx')
    expect(f.abs).toBe(`${ROOT}/out/letter.docx`)
    expect(f.agents).toEqual(['Elias'])
    expect(f.kind).toBe('docx')
    expect(m.loose).toEqual([])
  })

  it('what an agent made outside any case is loose, never hidden', () => {
    const m = buildMap(
      input({
        runs: [{ agentName: null, sessionName: 'Agent 2', artifacts: [{ path: `${ROOT}/scratch/notes.md`, name: 'notes.md' }] }],
      }),
    )
    expect(m.territories).toEqual([])
    expect(m.loose.map((f) => f.name)).toEqual(['notes.md'])
    expect(m.loose[0].agents).toEqual(['Agent 2'])
  })

  it('warm cases first, settled ones last, newest otherwise', () => {
    const m = buildMap(
      input({
        cases: [
          wcase({ id: 'old', title: 'Old', status: 'applied', updated: '2026-08-01T00:00:00Z' }),
          wcase({ id: 'won', title: 'Won', status: 'won', updated: '2026-09-02T00:00:00Z' }),
          wcase({ id: 'new', title: 'New', status: 'applied', updated: '2026-09-01T00:00:00Z' }),
          wcase({ id: 'hot', title: 'Hot', status: 'offer', updated: '2026-07-01T00:00:00Z' }),
        ],
      }),
    )
    expect(m.territories.map((t) => t.id)).toEqual(['hot', 'new', 'old', 'won'])
    expect(m.territories[0].warm).toBe(true)
    expect(m.territories[3].settled).toBe(true)
  })
})

describe('buildMap — live links', () => {
  const metrics: MapInput['metrics'] = [
    { id: 'm1', name: 'Q3 revenue', value: 120, updatedAt: 0, source: { kind: 'xlsx-cell', filePath: `${ROOT}/fin/q3.xlsx`, sheet: 'S', cell: 'B2' } },
    { id: 'm2', name: 'Headcount', value: 42, updatedAt: 0 },
  ]
  const links: MapInput['links'] = [
    { id: 'l1', metricId: 'm1', filePath: `${ROOT}/deck/board.pptx`, target: { kind: 'pptx-shape', tag: 'rev' }, lastValue: 120 },
    { id: 'l2', metricId: 'm1', filePath: `${ROOT}/memo.docx`, target: { kind: 'docx-cc', tag: 'rev' }, lastValue: 100 },
    { id: 'l3', metricId: 'm2', filePath: `${ROOT}/memo.docx`, target: { kind: 'docx-cc', tag: 'hc' }, lastValue: 42 },
    { id: 'gone', metricId: 'missing', filePath: `${ROOT}/x.docx`, target: { kind: 'docx-cc', tag: 'x' }, lastValue: 1 },
  ]

  it('draws file → file for a sourced metric and marks the out-of-step copy warm', () => {
    const m = buildMap(input({ metrics, links }))
    const l1 = m.links.find((l) => l.id === 'l1')!
    const l2 = m.links.find((l) => l.id === 'l2')!
    expect(l1.from).toBe('fin/q3.xlsx')
    expect(l1.to).toBe('deck/board.pptx')
    expect(l1.stale).toBe(false)
    expect(l2.stale).toBe(true)
    expect(m.loose.find((f) => f.key === 'memo.docx')?.warm).toBe(true)
    expect(m.loose.find((f) => f.key === 'deck/board.pptx')?.warm).toBe(false)
  })

  it('a hand-typed metric has no source file; a link to an unknown metric is dropped', () => {
    const m = buildMap(input({ metrics, links }))
    expect(m.links.find((l) => l.id === 'l3')?.from).toBeNull()
    expect(m.links.find((l) => l.id === 'gone')).toBeUndefined()
    expect(m.metrics.map((x) => [x.name, x.links, x.stale])).toEqual([
      ['Q3 revenue', 2, 1],
      ['Headcount', 1, 0],
    ])
  })

  it('the source spreadsheet joins a case when the case holds it', () => {
    const m = buildMap(input({ metrics, links, cases: [wcase({ artifacts: ['fin/q3.xlsx'] })] }))
    expect(m.territories[0].files[0].abs).toBe(`${ROOT}/fin/q3.xlsx`)
    expect(m.loose.map((f) => f.key)).not.toContain('fin/q3.xlsx')
  })

  it('counts everything in the status line', () => {
    const m = buildMap(input({ metrics, links, cases: [wcase()] }))
    expect(m.status).toBe('1 case · 3 documents · 3 live links · 1 out of step.')
  })
})

describe('labels', () => {
  it('mapStatus', () => {
    expect(mapStatus(0, 0, 0, 0)).toBe('Nothing to map yet — the first case or document will appear here.')
    expect(mapStatus(2, 1, 0, 0)).toBe('2 cases · 1 document.')
  })
  it('fileGlyph', () => {
    expect(fileGlyph('pptx')).toBe('◧')
    expect(fileGlyph('xlsx')).toBe('▦')
    expect(fileGlyph('docx')).toBe('▤')
    expect(fileGlyph('zip')).toBe('•')
  })
})
