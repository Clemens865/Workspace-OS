import { Marked, type Tokens } from 'marked'
import { sanitizeHtml } from './sanitizeHtml'

/**
 * A chat reply, as HTML the app can show in its own window.
 *
 * Unlike the note preview (sanitized AND isolated in a sandboxed iframe), a
 * chat message renders in the app's own DOM, next to the workspace bridge, and
 * a reply can carry text a web page planted. So the only tags in the output
 * are the ones marked writes for Markdown: raw HTML in a reply is shown as
 * text, never parsed; links keep only web, mail and workspace-file targets;
 * images become links (nothing loads from the network). The regex sanitizer
 * then runs once more as a second net.
 *
 * Links carry `data-chat-link`: the view opens web links in the in-app browser
 * and file paths on the stage. Code blocks carry a copy button.
 */

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Where a link may go: the web, mail, or a file (absolute or workspace-relative path). Null: shown as text. */
export function safeHref(raw: string): string | null {
  const href = raw.trim()
  if (/^(https?:|mailto:)/i.test(href)) return href
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null // javascript:, data:, file:, vbscript:…
  if (!href || href.startsWith('//')) return null
  return href
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html(t: Tokens.HTML | Tokens.Tag): string {
      return esc(t.text)
    },
    link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, t: Tokens.Link): string {
      const text = this.parser.parseInline(t.tokens)
      const href = safeHref(t.href)
      return href ? `<a href="#" data-chat-link="${esc(href)}" title="${esc(href)}">${text}</a>` : text
    },
    image(t: Tokens.Image): string {
      const href = safeHref(t.href)
      const label = esc(t.text || t.href)
      return href ? `<a href="#" data-chat-link="${esc(href)}">${label}</a>` : label
    },
    code(t: Tokens.Code): string {
      const lang = (t.lang ?? '').split(/\s/)[0]
      return `<div class="chat-code"><div class="chat-code-head"><span>${esc(lang)}</span><button type="button" data-chat-copy>Copy</button></div><pre><code>${esc(t.text)}</code></pre></div>`
    },
  },
})

export function chatMarkdown(md: string): string {
  return sanitizeHtml(marked.parse(md, { async: false }) as string).html
}
