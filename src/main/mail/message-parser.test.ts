import { describe, it, expect } from 'vitest'
import { parseMessage, sanitizeHtml } from './message-parser'

/**
 * MIME parsing + sanitization tests. Raw .eml strings are fed straight through
 * the mailparser-based parser — no IMAP server involved.
 */

const CRLF = '\r\n'
function eml(lines: string[]): string {
  return lines.join(CRLF)
}

const MULTIPART = eml([
  'From: Alice Sender <alice@example.com>',
  'To: Bob Reader <bob@example.com>',
  'Cc: carol@example.com',
  'Subject: Quarterly report',
  'Date: Mon, 07 Jul 2026 10:00:00 +0000',
  'Message-ID: <abc123@example.com>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="B"',
  '',
  '--B',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Hello Bob, here is the plain text body.',
  '',
  '--B',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<html><body><p>Hello <b>Bob</b></p></body></html>',
  '',
  '--B--',
  '',
])

const WITH_ATTACHMENT = eml([
  'From: sender@example.com',
  'To: rcpt@example.com',
  'Subject: Invoice attached',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="M"',
  '',
  '--M',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'See the attached invoice.',
  '',
  '--M',
  'Content-Type: application/pdf; name="invoice.pdf"',
  'Content-Disposition: attachment; filename="invoice.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('%PDF-1.4 fake pdf bytes').toString('base64'),
  '',
  '--M--',
  '',
])

const MALICIOUS = eml([
  'From: attacker@evil.example',
  'To: victim@example.com',
  'Subject: You won!',
  'MIME-Version: 1.0',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<html><body>',
  '<script>window.location="http://evil.example/steal"</script>',
  '<p onclick="alert(1)">Click me</p>',
  '<a href="javascript:alert(2)">bad link</a>',
  '<img src="http://tracker.evil.example/pixel.gif?u=victim@example.com" width="1" height="1">',
  '<img src="cid:inline-logo">',
  '<div style="background:url(http://evil.example/bg.png)">x</div>',
  '</body></html>',
  '',
])

describe('parseMessage', () => {
  it('parses multipart headers, text and sanitized html', async () => {
    const m = await parseMessage(MULTIPART)
    expect(m.subject).toBe('Quarterly report')
    expect(m.from).toEqual([{ name: 'Alice Sender', address: 'alice@example.com' }])
    expect(m.to).toEqual([{ name: 'Bob Reader', address: 'bob@example.com' }])
    expect(m.cc).toEqual([{ name: '', address: 'carol@example.com' }])
    expect(m.messageId).toBe('<abc123@example.com>')
    expect(m.date).toBe('2026-07-07T10:00:00.000Z')
    expect(m.text).toContain('plain text body')
    expect(m.html).toContain('<b>Bob</b>')
    expect(m.attachments).toHaveLength(0)
  })

  it('surfaces attachment metadata', async () => {
    const m = await parseMessage(WITH_ATTACHMENT)
    expect(m.text).toContain('attached invoice')
    expect(m.attachments).toHaveLength(1)
    const att = m.attachments[0]
    expect(att.filename).toBe('invoice.pdf')
    expect(att.contentType).toBe('application/pdf')
    expect(att.size).toBeGreaterThan(0)
    expect(att.inline).toBe(false)
  })

  it('strips scripts and does not auto-load remote images', async () => {
    const m = await parseMessage(MALICIOUS)
    // Scripts + inline handlers gone.
    expect(m.html.toLowerCase()).not.toContain('<script')
    expect(m.html.toLowerCase()).not.toContain('onclick')
    expect(m.html.toLowerCase()).not.toContain('javascript:')
    // The tracker must not LOAD. Its URL is retained inertly (data-blocked-*)
    // so the reader can offer "load images"; what must never survive is a live
    // src/background that the browser would fetch on render.
    expect(m.html).not.toMatch(/\ssrc\s*=\s*["']https?:/)
    expect(m.html).not.toMatch(/\sbackground\s*=\s*["']https?:/)
    expect(m.html).toContain('data-blocked-')
    // And we flag that remote content was blocked so the UI can offer opt-in.
    expect(m.hasBlockedRemoteContent).toBe(true)
  })
})

describe('sanitizeHtml', () => {
  it('removes script/style/iframe/link/meta elements', () => {
    const { html } = sanitizeHtml(
      '<style>body{}</style><iframe src="x"></iframe><link rel="stylesheet" href="x"><meta http-equiv="refresh" content="0;url=http://evil"><p>ok</p>',
    )
    expect(html).toContain('<p>ok</p>')
    expect(html.toLowerCase()).not.toContain('<style')
    expect(html.toLowerCase()).not.toContain('<iframe')
    expect(html.toLowerCase()).not.toContain('<link')
    expect(html.toLowerCase()).not.toContain('<meta')
  })

  it('flags and blocks remote src but leaves local/cid content and returns hadRemote', () => {
    const remote = sanitizeHtml('<img src="https://x.example/a.png">')
    expect(remote.hadRemote).toBe(true)
    // No LIVE src survives — the URL is retained inertly for opt-in loading.
    expect(remote.html).not.toMatch(/\ssrc\s*=\s*["']https/)
    expect(remote.html).toContain('data-blocked-src="https://x.example/a.png"')

    const cid = sanitizeHtml('<img src="cid:logo123">')
    expect(cid.hadRemote).toBe(false)
    expect(cid.html).toContain('cid:logo123')
  })

  it('strips event handlers and javascript: URLs', () => {
    const { html } = sanitizeHtml('<a href="javascript:evil()" onmouseover="x()">t</a>')
    expect(html.toLowerCase()).not.toContain('javascript:')
    expect(html.toLowerCase()).not.toContain('onmouseover')
  })

  it('removes object/embed/applet/noscript/template/frame elements', () => {
    const { html } = sanitizeHtml(
      '<object data="x"></object><embed src="y"><applet code="z"></applet><noscript>n</noscript><template>t</template><frame src="f"><p>keep</p>',
    )
    expect(html).toContain('<p>keep</p>')
    for (const tag of ['object', 'embed', 'applet', 'noscript', 'template', 'frame']) {
      expect(html.toLowerCase()).not.toContain(`<${tag}`)
    }
  })

  it('blocks remote srcset, background and poster attributes and flags hadRemote', () => {
    // The URL is now RETAINED in an inert data-* attribute so "load images" is
    // possible; what must not survive is a LIVE loading attribute. Asserting the
    // hostname is absent would have been asserting the old behaviour, which
    // deliberately changed — so assert the property that actually matters.
    const srcset = sanitizeHtml('<img srcset="https://x.example/a.png 1x">')
    expect(srcset.hadRemote).toBe(true)
    expect(srcset.html).not.toMatch(/\ssrcset\s*=/)
    expect(srcset.html).toContain('data-blocked-srcset=')

    const bg = sanitizeHtml('<body background="http://x.example/bg.png">')
    expect(bg.hadRemote).toBe(true)
    expect(bg.html).not.toMatch(/\sbackground\s*=/)

    const poster = sanitizeHtml('<video poster="//x.example/p.jpg"></video>')
    expect(poster.hadRemote).toBe(true)
    expect(poster.html).not.toMatch(/\sposter\s*=/)
  })

  it('neutralises remote url() in inline styles', () => {
    const { html, hadRemote } = sanitizeHtml('<div style="background:url(http://x.example/b.png)">x</div>')
    expect(hadRemote).toBe(true)
    expect(html).not.toContain('x.example')
    expect(html).toContain("url('')")
  })

  it('strips vbscript: URLs too', () => {
    const { html } = sanitizeHtml('<a href="vbscript:msgbox(1)">t</a>')
    expect(html.toLowerCase()).not.toContain('vbscript:')
  })

  it('leaves clean html with no remote content untouched (hadRemote false)', () => {
    const { html, hadRemote } = sanitizeHtml('<p>Just <b>text</b> and a <a href="https://ok.example">link</a>.</p>')
    expect(hadRemote).toBe(false)
    // A remote href on an anchor is a navigation target, not an auto-loaded
    // resource, so it is preserved (not a src/srcset/background/poster).
    expect(html).toContain('<b>text</b>')
  })
})

describe('parseMessage — edge cases', () => {
  it('handles a plain-text-only message with no html and no attachments', async () => {
    const plain = ['From: a@x.com', 'To: b@x.com', 'Subject: Plain', '', 'Just text.', ''].join('\r\n')
    const m = await parseMessage(plain)
    expect(m.html).toBe('')
    expect(m.hasBlockedRemoteContent).toBe(false)
    expect(m.text).toContain('Just text.')
    expect(m.attachments).toHaveLength(0)
  })

  it('accepts a Buffer as well as a string', async () => {
    const buf = Buffer.from(['From: a@x.com', 'Subject: Buf', '', 'body', ''].join('\r\n'))
    const m = await parseMessage(buf)
    expect(m.subject).toBe('Buf')
  })
})

describe('sanitizeHtml — blocked remote content keeps its URL', () => {
  it('preserves the URL so images can be loaded on request', () => {
    // Previously replaced with "1", which threw the URL away and made the
    // opt-in "load images" the comment promised impossible to build.
    const { html, hadRemote } = sanitizeHtml('<img src="https://tracker.example/px.gif">')
    expect(hadRemote).toBe(true)
    expect(html).toContain('data-blocked-src="https://tracker.example/px.gif"')
    expect(html).not.toContain(' src=')
  })

  it('still issues NO network request in the blocked form', () => {
    const { html } = sanitizeHtml('<img src="https://x/a.png"><img srcset="https://x/b.png 2x">')
    // No live loading attribute survives, so the browser cannot fetch anything.
    expect(html).not.toMatch(/\ssrc\s*=/)
    expect(html).not.toMatch(/\ssrcset\s*=/)
  })

  it('handles protocol-relative URLs', () => {
    const { html } = sanitizeHtml('<img src="//cdn.example/a.png">')
    expect(html).toContain('data-blocked-src="//cdn.example/a.png"')
  })

  it('keeps blocking scripts and handlers regardless', () => {
    const { html } = sanitizeHtml(
      '<img src="https://x/a.png" onerror="alert(1)"><script>alert(2)</script>',
    )
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('<script')
  })

  it('strips angle brackets from a hostile URL before storing it', () => {
    const { html } = sanitizeHtml('<img src="https://x/a.png?a=<b>">')
    expect(html).not.toContain('<b>')
  })

  it('reports no remote content for a purely local message', () => {
    const { hadRemote } = sanitizeHtml('<p>Hello <b>there</b></p>')
    expect(hadRemote).toBe(false)
  })
})

describe('sanitizeHtml — links open in the in-app browser', () => {
  it('gives an http link a target so the click becomes routable', () => {
    // Without this the click does NOTHING: the reader iframe is sandboxed with
    // no navigation permission, so it is swallowed silently and reads as the
    // app being broken.
    const { html } = sanitizeHtml('<a href="https://example.com/x">read more</a>')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('href="https://example.com/x"')
    expect(html).toContain('read more')
  })

  it('adds noopener noreferrer', () => {
    // The opened page must not get a handle back to the opener, and a mail
    // link should not leak where it was clicked from.
    const { html } = sanitizeHtml('<a href="https://example.com">x</a>')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('replaces a hostile target/rel rather than letting it through', () => {
    const { html } = sanitizeHtml('<a target="_self" rel="opener" href="https://x.com">x</a>')
    expect(html).not.toContain('_self')
    expect(html).not.toContain('rel="opener"')
    expect(html).toContain('target="_blank"')
  })

  it('does NOT arm a javascript: link', () => {
    // The rewrite is scoped to http(s); a javascript: href must stay neutralised.
    const { html } = sanitizeHtml('<a href="javascript:evil()">x</a>')
    expect(html.toLowerCase()).not.toContain('javascript:')
    expect(html).not.toContain('target="_blank"')
  })

  it('leaves a mailto: link alone', () => {
    const { html } = sanitizeHtml('<a href="mailto:a@b.com">mail me</a>')
    expect(html).toContain('mailto:a@b.com')
    expect(html).not.toContain('target="_blank"')
  })

  it('keeps other attributes on the link', () => {
    const { html } = sanitizeHtml('<a class="btn" href="https://x.com" title="go">x</a>')
    expect(html).toContain('class="btn"')
    expect(html).toContain('title="go"')
  })

  it('still strips event handlers from a link', () => {
    const { html } = sanitizeHtml('<a href="https://x.com" onclick="evil()">x</a>')
    expect(html).not.toContain('onclick')
    expect(html).toContain('target="_blank"')
  })
})

/**
 * A message whose body references an inline image by Content-ID — a signature
 * logo, the commonest real case. The PNG is a real 1x1 so the bytes round-trip
 * through base64 rather than being a placeholder string.
 */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function withInline(cid: string, ref: string, contentType = 'image/png'): string {
  return eml([
    'From: sender@example.com',
    'To: reader@example.com',
    'Subject: Signature test',
    'MIME-Version: 1.0',
    'Content-Type: multipart/related; boundary="R"',
    '',
    '--R',
    'Content-Type: text/html; charset=utf-8',
    '',
    `<html><body><p>Regards</p><img src="${ref}"></body></html>`,
    '',
    '--R',
    `Content-Type: ${contentType}; name="logo.png"`,
    'Content-Transfer-Encoding: base64',
    `Content-ID: <${cid}>`,
    'Content-Disposition: inline; filename="logo.png"',
    '',
    PNG_1X1,
    '',
    '--R--',
    '',
  ])
}

/**
 * mailparser resolves the ordinary cid: case by itself, so the first test here
 * guards ITS behaviour (a dependency bump could silently take it away) and the
 * case/bracket tests guard ours. Keeping the distinction visible matters: every
 * one of these passed with our fallback removed except the two that exercise
 * it, which is how we learned the reported "inline images never render" was
 * wrong.
 */
describe('inline cid: images', () => {
  it('resolves an ordinary cid: reference — mailparser does this for us', async () => {
    const m = await parseMessage(withInline('logo123', 'cid:logo123'))
    expect(m.html).toContain(`data:image/png;base64,${PNG_1X1}`)
    // The unresolvable scheme must be gone, not merely accompanied.
    expect(m.html).not.toContain('cid:logo123')
  })

  // Ours: mailparser matches the Content-ID exactly and gives up on these.
  it('resolves a reference whose case differs from the Content-ID', async () => {
    const m = await parseMessage(withInline('logo123', 'cid:LOGO123'))
    expect(m.html).toContain('data:image/png;base64,')
    expect(m.html).not.toContain('cid:LOGO123')
  })

  it('resolves a reference that carries angle brackets', async () => {
    const m = await parseMessage(withInline('logo123', 'cid:<logo123>'))
    expect(m.html).toContain('data:image/png;base64,')
  })

  it('leaves a reference with no matching attachment untouched', async () => {
    const m = await parseMessage(withInline('logo123', 'cid:absent'))
    expect(m.html).toContain('cid:absent')
    expect(m.html).not.toContain('data:image/png;base64,')
  })

  /**
   * An SVG is a document that can carry script, so it is not an image for this
   * purpose no matter what the sender's Content-Type says.
   */
  it('refuses to inline image/svg+xml', async () => {
    const m = await parseMessage(withInline('logo123', 'cid:logo123', 'image/svg+xml'))
    expect(m.html).not.toContain('data:image/svg+xml')
    expect(m.html).toContain('cid:logo123')
  })

  it('does not count an inline image as blocked remote content', async () => {
    const m = await parseMessage(withInline('logo123', 'cid:logo123'))
    expect(m.hasBlockedRemoteContent).toBe(false)
  })

  it('still lists the inlined part as an attachment', async () => {
    const m = await parseMessage(withInline('logo123', 'cid:logo123'))
    expect(m.attachments.some((a) => a.inline && a.cid === 'logo123')).toBe(true)
  })
})
