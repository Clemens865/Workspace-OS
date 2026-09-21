import { describe, it, expect } from 'vitest'
import {
  buildRichEmail,
  blocksToPlainText,
  metricInsertBlock,
  rangeInsertBlock,
  type RangeLookup,
} from './compose-build'
import type { MetricLookup } from './email-tokens'

function fakeMetrics(map: Record<string, { value: number; name?: string }>): MetricLookup {
  return { get: (id) => (id in map ? { value: map[id].value } : undefined) }
}

function fakeMetricsNamed(map: Record<string, { value: number; name: string }>): MetricLookup {
  return { get: (id) => (id in map ? (map[id] as { value: number; name: string }) : undefined) }
}

function fakeRanges(map: Record<string, { name: string; values: (number | string | null)[][] }>): RangeLookup {
  return { get: (id) => (id in map ? map[id] : undefined) }
}

describe('buildRichEmail (theme + blocks → html + text)', () => {
  it('applies the chosen theme and compiles responsive HTML', async () => {
    const out = await buildRichEmail(
      { themeId: 'editorial', blocks: [{ kind: 'text', text: 'Hello colleague.' }] },
      fakeMetrics({}),
    )
    expect(out.errors).toEqual([])
    expect(out.html).toContain('Hello colleague.')
    expect(out.html).toContain('@media') // responsive marker
    expect(out.html).toContain('#9a6b3f') // editorial accent applied
    expect(out.text).toContain('Hello colleague.')
  })

  it('resolves live {{metric}} tokens true in BOTH html and the text fallback', async () => {
    const out = await buildRichEmail(
      { blocks: [{ kind: 'text', text: 'MRR is {{metric:mrr}} now.' }] },
      fakeMetrics({ mrr: { value: 99000 } }),
    )
    expect(out.html).toContain('99000')
    expect(out.html).not.toContain('{{metric')
    expect(out.text).toContain('99000')
    expect(out.unresolvedTokens).toEqual([])
  })

  it('reports an unknown metric as a VISIBLE placeholder, never blank', async () => {
    const out = await buildRichEmail(
      { blocks: [{ kind: 'metric', label: 'MRR', value: '{{metric:ghost}}' }] },
      fakeMetrics({}),
    )
    expect(out.html).toContain('[metric ghost unavailable]')
    expect(out.unresolvedTokens.map((t) => t.id)).toContain('ghost')
  })

  it('an empty block list still builds valid HTML (no throw)', async () => {
    const out = await buildRichEmail({ blocks: [] }, fakeMetrics({}))
    expect(out.errors).toEqual([])
    expect(typeof out.html).toBe('string')
  })
})

describe('blocksToPlainText', () => {
  it('flattens blocks to text and resolves live tokens', () => {
    const text = blocksToPlainText(
      [
        { kind: 'text', text: 'Update: {{metric:mrr}}' },
        { kind: 'cta', label: 'Book', href: 'https://x.io' },
      ],
      fakeMetrics({ mrr: { value: 5 } }),
    )
    expect(text).toContain('Update: 5')
    expect(text).toContain('Book — https://x.io')
  })
})

describe('metricInsertBlock / rangeInsertBlock', () => {
  it('metricInsertBlock makes a callout whose value is a live token (label = metric name)', () => {
    const block = metricInsertBlock('mrr', fakeMetricsNamed({ mrr: { value: 5, name: 'Monthly Revenue' } }))
    expect(block).toEqual({ kind: 'metric', label: 'Monthly Revenue', value: '{{metric:mrr}}' })
  })

  it('metricInsertBlock for an unknown id still emits a live token (resolves to placeholder later)', () => {
    const block = metricInsertBlock('ghost', fakeMetrics({}))
    expect(block).toEqual({ kind: 'metric', label: 'ghost', value: '{{metric:ghost}}' })
  })

  it('rangeInsertBlock snapshots a range grid into a table block (stringified cells)', () => {
    const block = rangeInsertBlock('r1', fakeRanges({ r1: { name: 'Q', values: [['Q', 'Rev'], [1, 10]] } }))
    expect(block).toEqual({ kind: 'table', rows: [['Q', 'Rev'], ['1', '10']] })
  })

  it('rangeInsertBlock for an unknown id → a visible placeholder table (never blank)', () => {
    const block = rangeInsertBlock('nope', fakeRanges({}))
    expect(block.kind).toBe('table')
    expect(JSON.stringify(block)).toContain('unavailable')
  })
})
