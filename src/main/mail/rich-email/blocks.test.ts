import { describe, it, expect } from 'vitest'
import { renderBlock, safeHref, escapeContent } from './blocks'
import { resolveTheme } from './themes'

const theme = resolveTheme('clean')

describe('renderBlock', () => {
  it('renders a text block, escaping HTML and keeping line breaks', () => {
    const html = renderBlock({ kind: 'text', text: 'Hi <b>there</b>\nsecond line' }, theme)
    expect(html).toContain('&lt;b&gt;there&lt;/b&gt;')
    expect(html).toContain('<br />')
    expect(html).toContain('<mj-text>')
  })

  it('renders a metric callout with label + value', () => {
    const html = renderBlock({ kind: 'metric', label: 'MRR', value: '42000' }, theme)
    expect(html).toContain('MRR')
    expect(html).toContain('42000')
    expect(html).toContain(theme.accent) // accent border
  })

  it('renders a table with a header row and body rows', () => {
    const html = renderBlock({ kind: 'table', rows: [['Q', 'Rev'], ['Q1', '10']] }, theme)
    expect(html).toContain('<mj-table')
    expect(html).toContain('<th')
    expect(html).toContain('Q1')
  })

  it('renders a CTA button as a real href, only allowing http(s)', () => {
    expect(renderBlock({ kind: 'cta', label: 'Book', href: 'https://x.io' }, theme)).toContain('href="https://x.io"')
    // javascript: is refused → '#'
    expect(renderBlock({ kind: 'cta', label: 'X', href: 'javascript:alert(1)' }, theme)).toContain('href="#"')
  })

  it('renders a hosted-link button + an honest "opens in Workspace-OS" caption', () => {
    const html = renderBlock({ kind: 'hosted-link', label: 'Open dashboard', target: 'dash' }, theme)
    expect(html).toContain('Open dashboard')
    expect(html).toContain('Opens in Workspace-OS')
  })

  it('empty / unknown blocks render to an empty string (never throws)', () => {
    expect(renderBlock({ kind: 'text', text: '   ' }, theme)).toBe('')
    // @ts-expect-error deliberately unknown kind
    expect(renderBlock({ kind: 'bogus' }, theme)).toBe('')
  })
})

describe('safeHref', () => {
  it('passes http(s) and mailto, refuses everything else', () => {
    expect(safeHref('https://a.com')).toBe('https://a.com')
    expect(safeHref('http://a.com')).toBe('http://a.com')
    expect(safeHref('mailto:x@y.com')).toBe('mailto:x@y.com')
    expect(safeHref('javascript:alert(1)')).toBe('#')
    expect(safeHref('data:text/html,x')).toBe('#')
    expect(safeHref(42)).toBe('#')
  })

  it('upgrades a bare host to https, the way people type a link', () => {
    expect(safeHref('www.example.com')).toBe('https://www.example.com')
    expect(safeHref('example.com')).toBe('https://example.com')
    expect(safeHref('example.co.uk/pricing')).toBe('https://example.co.uk/pricing')
    expect(safeHref('sub.domain.example.com/a/b?c=1#d')).toBe('https://sub.domain.example.com/a/b?c=1#d')
    expect(safeHref('my-site.io')).toBe('https://my-site.io')
  })

  it('trims surrounding whitespace before deciding', () => {
    expect(safeHref('  www.example.com  ')).toBe('https://www.example.com')
  })

  it('reads a protocol-relative link as https', () => {
    expect(safeHref('//cdn.example.com/x')).toBe('https://cdn.example.com/x')
  })

  /**
   * The reason the bare-host pattern forbids a colon before the first slash:
   * without it, a rejected scheme would be re-admitted with https:// glued on
   * the front, which is worse than the hole it was meant to close.
   */
  it('does not turn a dangerous scheme into a bare host', () => {
    expect(safeHref('javascript:alert(1)')).toBe('#')
    expect(safeHref('javascript:fetch("//evil.com")')).toBe('#')
    expect(safeHref('data:text/html;base64,PHNjcmlwdD4=')).toBe('#')
    expect(safeHref('vbscript:msgbox')).toBe('#')
    expect(safeHref('file:///etc/passwd')).toBe('#')
  })

  it('refuses things that are not links at all', () => {
    expect(safeHref('')).toBe('#')
    expect(safeHref('just some words')).toBe('#')
    expect(safeHref('no-dot-here')).toBe('#')
    expect(safeHref('trailing.')).toBe('#')
    expect(safeHref('.leading')).toBe('#')
    expect(safeHref('spaces in.host/x')).toBe('#')
  })

  it('renders the upgraded href into the button', () => {
    const html = renderBlock({ kind: 'cta', label: 'Open', href: 'www.example.com' }, theme)
    expect(html).toContain('href="https://www.example.com"')
  })
})

describe('escapeContent', () => {
  it('escapes the HTML-significant characters', () => {
    expect(escapeContent('<a & b>')).toBe('&lt;a &amp; b&gt;')
  })
})

describe('chart block', () => {
  it('scales bars against the largest value', () => {
    const html = renderBlock(
      { kind: 'chart', bars: [{ label: 'A', value: 50 }, { label: 'B', value: 100 }] },
      theme,
    )
    expect(html).toContain('width:100%')
    expect(html).toContain('width:50%')
  })

  /**
   * The whole point of the CSS-bar approach: no <img>, because Gmail and
   * Outlook strip data: images and the chart would silently vanish for most
   * recipients.
   */
  it('emits no image at all', () => {
    const html = renderBlock({ kind: 'chart', bars: [{ label: 'A', value: 1 }] }, theme)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('data:image')
  })

  it('shows the display string rather than the raw number when given one', () => {
    const html = renderBlock(
      { kind: 'chart', bars: [{ label: 'Revenue', value: 1200000, display: '€1.2M' }] },
      theme,
    )
    expect(html).toContain('€1.2M')
    expect(html).not.toContain('1200000')
  })

  it('uses magnitude so a negative value still draws a comparable bar', () => {
    const html = renderBlock(
      { kind: 'chart', bars: [{ label: 'Down', value: -100 }, { label: 'Up', value: 50 }] },
      theme,
    )
    expect(html).toContain('width:100%')
    expect(html).toContain('width:50%')
  })

  /**
   * A real run produced a "change by quarter" chart where -11.9% drew exactly
   * like growth, in the accent colour, with its own label reading "-11.9%"
   * beside it. Bars that contradict their labels are worse than no chart.
   */
  it('draws a negative bar in a different colour from a positive one', () => {
    const neg = renderBlock({ kind: 'chart', bars: [{ label: 'Down', value: -10 }] }, theme)
    const pos = renderBlock({ kind: 'chart', bars: [{ label: 'Up', value: 10 }] }, theme)
    expect(neg).toContain('#C2410C')
    expect(pos).not.toContain('#C2410C')
    expect(pos).toContain(theme.accent)
  })

  it('grows a negative bar from the other side of the track', () => {
    const html = renderBlock({ kind: 'chart', bars: [{ label: 'Down', value: -100 }] }, theme)
    // The spacer comes FIRST for a negative, so the bar sits to the right of it.
    const spacerAt = html.indexOf('width:0%')
    const barAt = html.indexOf('#C2410C')
    expect(spacerAt).toBeGreaterThan(-1)
    expect(spacerAt).toBeLessThan(barAt)
  })

  it('colours the value label of a negative bar to match', () => {
    const html = renderBlock(
      { kind: 'chart', bars: [{ label: 'Down', value: -12, display: '-11.9%' }] },
      theme,
    )
    expect(html).toMatch(/color:#C2410C[^>]*>-11\.9%/)
  })

  it('does not divide by zero when every value is zero', () => {
    const html = renderBlock(
      { kind: 'chart', bars: [{ label: 'A', value: 0 }, { label: 'B', value: 0 }] },
      theme,
    )
    expect(html).not.toContain('NaN')
    expect(html).toContain('width:0%')
  })

  it('escapes labels', () => {
    const html = renderBlock(
      { kind: 'chart', bars: [{ label: '<script>x</script>', value: 1 }] },
      theme,
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('renders nothing for an empty bar list', () => {
    expect(renderBlock({ kind: 'chart', bars: [] }, theme)).toBe('')
  })

  it('renders the title when present', () => {
    const html = renderBlock(
      { kind: 'chart', title: 'Throughput', bars: [{ label: 'A', value: 1 }] },
      theme,
    )
    expect(html).toContain('Throughput')
  })
})

describe('renderBlock — standard editor blocks', () => {
  it('renders a heading bigger and bold', () => {
    const html = renderBlock({ kind: 'heading', text: 'The <plan>' }, theme)
    expect(html).toContain('font-weight="700"')
    expect(html).toContain('&lt;plan&gt;')
  })

  it('renders a divider', () => {
    expect(renderBlock({ kind: 'divider' }, theme)).toContain('<mj-divider')
  })

  it('renders an image by Content-ID, attribute-safe', () => {
    const html = renderBlock({ kind: 'image', cid: 'img-7', alt: 'Team "photo"' }, theme)
    expect(html).toContain('src="cid:img-7"')
    expect(html).not.toContain('"photo"')
  })

  it('renders nothing for an image whose cid sanitizes away', () => {
    expect(renderBlock({ kind: 'image', cid: '"<>', alt: 'x' }, theme)).toBe('')
  })
})
