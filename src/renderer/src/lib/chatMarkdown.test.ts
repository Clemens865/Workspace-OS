import { describe, it, expect } from 'vitest'
import { chatMarkdown, safeHref } from './chatMarkdown'

describe('chat replies as HTML', () => {
  it('renders Markdown: headings, lists, tables, emphasis', () => {
    const html = chatMarkdown('## Plan\n\n- **one**\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<h2>Plan</h2>')
    expect(html).toContain('<strong>one</strong>')
    expect(html).toMatch(/<table>[\s\S]*<td>1<\/td>/)
  })

  it('shows raw HTML in a reply as text, never as elements', () => {
    const html = chatMarkdown('Hi <img src=x onerror="alert(1)"> and\n\n<script>alert(2)</script>\n\n<iframe src="https://evil.example"></iframe>')
    expect(html).not.toMatch(/<img|<script|<iframe/i)
    expect(html).toContain('&lt;img src=x')
  })

  it('keeps web, mail and file links, and drops script links to plain text', () => {
    expect(chatMarkdown('[site](https://example.com)')).toContain('data-chat-link="https://example.com"')
    expect(chatMarkdown('[the deck](<Artifacts/Q3 deck.html>)')).toContain('data-chat-link="Artifacts/Q3 deck.html"')
    const bad = chatMarkdown('[click](javascript:alert(1)) [d](data:text/html,x) [f](file:///etc/passwd)')
    expect(bad).not.toMatch(/javascript:|data:text|file:\/\//)
    expect(bad).toContain('click')
    expect(safeHref('//evil.example/x')).toBeNull()
  })

  it('loads no images: an image becomes a link', () => {
    const html = chatMarkdown('![chart](https://tracker.example/pixel.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain('data-chat-link="https://tracker.example/pixel.png"')
  })

  it('gives code blocks their language and a copy button, escaped', () => {
    const html = chatMarkdown('```ts\nconst a = "<b>"\n```')
    expect(html).toContain('<span>ts</span>')
    expect(html).toContain('data-chat-copy')
    expect(html).toContain('const a = &quot;&lt;b&gt;&quot;')
  })
})
