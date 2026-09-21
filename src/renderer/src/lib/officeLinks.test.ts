import { describe, it, expect, vi, afterEach } from 'vitest'
import { normalizeWebUrl, parseHyperlinkPayload } from './officeLinks'

describe('normalizeWebUrl', () => {
  it('keeps https:// URLs as-is', () => {
    expect(normalizeWebUrl('https://www.domain.com')).toBe('https://www.domain.com')
    expect(normalizeWebUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1')
  })

  it('keeps http:// URLs as-is', () => {
    expect(normalizeWebUrl('http://example.com')).toBe('http://example.com')
  })

  it('lower-cases the scheme but keeps the rest', () => {
    expect(normalizeWebUrl('HTTPS://Example.com/Path')).toBe('https://Example.com/Path')
  })

  it('prefixes bare www. hosts with https://', () => {
    expect(normalizeWebUrl('www.domain.com')).toBe('https://www.domain.com')
    expect(normalizeWebUrl('  www.domain.com/x  ')).toBe('https://www.domain.com/x')
  })

  it('prefixes a bare domain with https://', () => {
    expect(normalizeWebUrl('domain.com')).toBe('https://domain.com')
  })

  it('rejects mailto: links', () => {
    expect(normalizeWebUrl('mailto:me@example.com')).toBeNull()
  })

  it('rejects file: links', () => {
    expect(normalizeWebUrl('file:///Users/x/doc.pdf')).toBeNull()
  })

  it('rejects other schemes (tel, ftp, javascript)', () => {
    expect(normalizeWebUrl('tel:+123')).toBeNull()
    expect(normalizeWebUrl('ftp://host/file')).toBeNull()
    expect(normalizeWebUrl('javascript:alert(1)')).toBeNull()
  })

  it('rejects empty / whitespace / non-url text', () => {
    expect(normalizeWebUrl('')).toBeNull()
    expect(normalizeWebUrl('   ')).toBeNull()
    expect(normalizeWebUrl('just some text')).toBeNull()
  })
})

describe('parseHyperlinkPayload', () => {
  it('returns a bare URL payload unchanged', () => {
    expect(parseHyperlinkPayload('https://x.com')).toBe('https://x.com')
  })

  it('extracts href from a JSON payload', () => {
    expect(parseHyperlinkPayload('{"text":"click","href":"https://x.com"}')).toBe('https://x.com')
  })

  it('extracts url when there is no href', () => {
    expect(parseHyperlinkPayload('{"url":"https://y.com"}')).toBe('https://y.com')
  })

  it('falls back to raw text for malformed JSON', () => {
    expect(parseHyperlinkPayload('{not json')).toBe('{not json')
  })
})

describe('hyperlink payload → navigate dispatch', () => {
  // No DOM env in this suite (node); stub the window.dispatchEvent + CustomEvent
  // the renderer handler uses so we can assert the event WITHOUT jsdom.
  const g = globalThis as unknown as {
    window?: { dispatchEvent: (e: unknown) => boolean }
    CustomEvent?: unknown
  }
  const hadWindow = 'window' in g
  const hadCE = 'CustomEvent' in g

  afterEach(() => {
    vi.restoreAllMocks()
    if (!hadWindow) delete g.window
    if (!hadCE) delete g.CustomEvent
  })

  // Mirrors the useLokCallbacks handler: parse → normalize → dispatch the
  // existing wos:browser-navigate event with the URL for the in-app browser.
  function handleHyperlink(payload: string): void {
    const url = normalizeWebUrl(parseHyperlinkPayload(payload))
    if (url) window.dispatchEvent(new CustomEvent('wos:browser-navigate', { detail: { url } }))
  }

  it('dispatches wos:browser-navigate with the normalized url for a web link', () => {
    const dispatchEvent = vi.fn(() => true)
    g.CustomEvent = class {
      type: string
      detail: unknown
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type
        this.detail = init?.detail
      }
    }
    g.window = { dispatchEvent }
    handleHyperlink('www.domain.com')
    expect(dispatchEvent).toHaveBeenCalledTimes(1)
    const ev = (dispatchEvent.mock.calls[0] as unknown[])[0] as { type: string; detail: unknown }
    expect(ev.type).toBe('wos:browser-navigate')
    expect(ev.detail).toEqual({ url: 'https://www.domain.com' })
  })

  it('does NOT dispatch for a mailto: link', () => {
    const dispatchEvent = vi.fn(() => true)
    g.window = { dispatchEvent }
    handleHyperlink('mailto:me@example.com')
    expect(dispatchEvent).not.toHaveBeenCalled()
  })
})
