import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPrintRequestFor, printTextDocument } from './printDocument'

afterEach(() => vi.unstubAllGlobals())

function printApi() {
  const document = vi.fn().mockResolvedValue(undefined)
  const list = vi.fn().mockResolvedValue([{ id: 'revenue', value: 12345 }])
  vi.stubGlobal('window', { workspace: { print: { document }, metrics: { list } } })
  return { document, list }
}

describe('document printing', () => {
  it('prints the full Markdown buffer with formatting, live values and its final unsaved paragraph', async () => {
    const { document } = printApi()
    const source = '# Report\n\nRevenue: {{metric:revenue}}\n\n'
      + Array.from({ length: 100 }, (_, i) => `## Section ${i}\n\nThis paragraph belongs to section ${i}.`).join('\n\n')
      + '\n\n**Unsaved final paragraph**'
    await printTextDocument('/work/report.md', source)
    const [title, html] = document.mock.calls[0]
    expect(title).toBe('report.md')
    expect(html).toContain('<h1>Report</h1>')
    expect(html).toContain('Revenue: 12345')
    expect(html).toContain('<h2>Section 99</h2>')
    expect(html).toContain('<strong>Unsaved final paragraph</strong>')
    expect(document).toHaveBeenCalledTimes(1)
  })

  it('escapes code instead of interpreting it as HTML and preserves the last line', async () => {
    const { document, list } = printApi()
    const source = '<script>alert("code")</script>\n' + 'long line '.repeat(2000) + '\nEND'
    await printTextDocument('/work/source.txt', source)
    expect(document.mock.calls[0][1]).toContain('&lt;script&gt;alert(&quot;code&quot;)&lt;/script&gt;')
    expect(document.mock.calls[0][1]).toMatch(/\nEND<\/pre>$/)
    expect(list).not.toHaveBeenCalled()
  })

  it('keeps HTML document styles for the isolated print window', async () => {
    const { document } = printApi()
    const html = '<style>h1{color:navy}</style><h1>Full HTML document</h1>'
    await printTextDocument('/work/report.html', html)
    expect(document).toHaveBeenCalledWith('report.html', html)
  })

  it('still prints Markdown when the metric store is unavailable', async () => {
    const { document, list } = printApi()
    list.mockRejectedValue(new Error('Store unavailable'))
    await printTextDocument('/work/report.md', '# Report\n\n{{metric:revenue}}')
    expect(document.mock.calls[0][1]).toContain('[metric revenue unavailable]')
  })

  it('does not let another open file handle this print request', () => {
    const event = new CustomEvent('wos:print', { detail: { filePath: '/work/current.md' } })
    expect(isPrintRequestFor(event, '/work/current.md')).toBe(true)
    expect(isPrintRequestFor(event, '/work/other.md')).toBe(false)
    expect(isPrintRequestFor(new Event('wos:print'), '/work/current.md')).toBe(false)
  })
})
