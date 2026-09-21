import { describe, it, expect } from 'vitest'
import {
  renderMarkdown,
  resolveLiveTokens,
  resolveTokensOutsideCode,
  buildPreviewHtml,
  metricLookupFrom,
  type MetricLookup,
} from './markdownPreview'

/** A fake live-metric store for the pipeline tests. */
function lookup(values: Record<string, number>): MetricLookup {
  return { get: (id) => (id in values ? { value: values[id] } : undefined) }
}

describe('renderMarkdown', () => {
  it('renders headings, bold, lists, links and code', async () => {
    const html = await renderMarkdown(
      '# Title\n\n**bold** and _em_\n\n- one\n- two\n\n[link](https://x.test)\n\n`code`',
    )
    expect(html).toMatch(/<h1[^>]*>Title<\/h1>/)
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>em</em>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('href="https://x.test"')
    expect(html).toContain('<code>code</code>')
  })
})

describe('resolveLiveTokens', () => {
  it('replaces a known token with the live value, not the raw token', () => {
    const r = resolveLiveTokens('MRR is {{metric:mrr}} today', lookup({ mrr: 42000 }))
    expect(r.text).toBe('MRR is 42000 today')
    expect(r.text).not.toContain('{{metric')
    expect(r.unresolved).toHaveLength(0)
  })

  it('unknown id → visible placeholder + reported, never blank', () => {
    const r = resolveLiveTokens('x {{metric:ghost}} y', lookup({}))
    expect(r.text).toBe('x [metric ghost unavailable] y')
    expect(r.text).not.toContain('{{metric')
    expect(r.unresolved).toEqual([{ token: '{{metric:ghost}}', id: 'ghost', reason: 'unknown' }])
  })

  it('non-finite value → placeholder + reported unreadable', () => {
    const r = resolveLiveTokens('{{metric:nan}}', { get: () => ({ value: NaN }) })
    expect(r.text).toBe('[metric nan unavailable]')
    expect(r.unresolved[0].reason).toBe('unreadable')
  })
})

describe('resolveTokensOutsideCode (code-fence decision)', () => {
  it('does NOT resolve tokens inside inline code spans', () => {
    const r = resolveTokensOutsideCode('live {{metric:mrr}} vs `{{metric:mrr}}`', lookup({ mrr: 7 }))
    expect(r.text).toBe('live 7 vs `{{metric:mrr}}`')
  })

  it('does NOT resolve tokens inside fenced code blocks', () => {
    const md = 'value {{metric:mrr}}\n\n```\nembed {{metric:mrr}} here\n```'
    const r = resolveTokensOutsideCode(md, lookup({ mrr: 7 }))
    expect(r.text).toContain('value 7')
    expect(r.text).toContain('embed {{metric:mrr}} here')
  })
})

describe('buildPreviewHtml (full pipeline)', () => {
  it('resolves the token and renders it into HTML, not the raw token', async () => {
    const { html } = await buildPreviewHtml('# ARR\n\nWe hit {{metric:arr}} this year.', lookup({ arr: 1200000 }))
    expect(html).toContain('1200000')
    expect(html).not.toContain('{{metric')
    expect(html).toMatch(/<h1[^>]*>ARR<\/h1>/)
  })

  it('unknown id → placeholder in the html, reported, never blank', async () => {
    const { html, unresolved } = await buildPreviewHtml('MRR: {{metric:mrr}}', lookup({}))
    expect(html).toContain('[metric mrr unavailable]')
    expect(html).not.toContain('{{metric')
    expect(unresolved).toHaveLength(1)
  })

  it('strips a <script> injected via the markdown (defence-in-depth)', async () => {
    const { html } = await buildPreviewHtml('Hi\n\n<script>alert(1)</script>\n\n<img src=x onerror="steal()">', lookup({}))
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
    expect(html).not.toMatch(/onerror/i)
  })

  it('keeps a literal token shown inside a code fence in the rendered <code>', async () => {
    const { html } = await buildPreviewHtml('```\n{{metric:mrr}}\n```', lookup({ mrr: 9 }))
    expect(html).toContain('{{metric:mrr}}')
    expect(html).not.toContain('>9<')
  })
})

describe('metricLookupFrom', () => {
  it('maps a metrics list by id', () => {
    const lk = metricLookupFrom([{ id: 'a', value: 1 }, { id: 'b', value: 2 }])
    expect(lk.get('a')).toEqual({ value: 1 })
    expect(lk.get('z')).toBeUndefined()
  })
})
