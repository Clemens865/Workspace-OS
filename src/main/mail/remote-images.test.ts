import { describe, it, expect, vi } from 'vitest'
import { loadRemoteImages, normaliseImageUrl, LIMITS, type ImageFetch } from './remote-images'

/**
 * Remote-image loading, with the network injected.
 *
 * The guard tests matter more than the happy path. Moving the fetch from the
 * renderer into main is what makes "Load images" work at all, but it also turns
 * an attacker-chosen URL in an email into a request the main process issues —
 * so the blocked-host list is the part that must not regress.
 */

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

function fakeFetch(
  reply: (url: string) => { ok?: boolean; type?: string | null; body?: Buffer } = () => ({}),
): ImageFetch & { calls: string[] } {
  const calls: string[] = []
  const fn = (async (url: string) => {
    calls.push(url)
    const r = reply(url)
    return {
      ok: r.ok ?? true,
      status: r.ok === false ? 404 : 200,
      contentType: r.type === undefined ? 'image/png' : r.type,
      bytes: async () => {
        const b = r.body ?? PNG
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
      },
    }
  }) as unknown as ImageFetch & { calls: string[] }
  fn.calls = calls
  return fn
}

describe('normaliseImageUrl', () => {
  it('accepts ordinary http and https', () => {
    expect(normaliseImageUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
    expect(normaliseImageUrl('http://cdn.example.com/a.png')).toBe('http://cdn.example.com/a.png')
  })

  it('resolves a protocol-relative URL to https rather than dropping it', () => {
    expect(normaliseImageUrl('//cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
  })

  it('rejects schemes that are not http(s)', () => {
    for (const u of ['javascript:alert(1)', 'file:///etc/passwd', 'data:image/png;base64,AAAA', 'ftp://h/a.png']) {
      expect(normaliseImageUrl(u)).toBeNull()
    }
  })

  /**
   * The whole reason the guard exists: main can reach hosts the renderer never
   * could, and every one of these is a request an email should not be able to
   * make on the user's behalf.
   */
  it('refuses loopback, private, and link-local hosts', () => {
    const blocked = [
      'http://localhost/x.png',
      'http://localhost:8080/admin',
      'http://127.0.0.1/x.png',
      'http://127.1.2.3/x.png',
      'http://10.0.0.5/x.png',
      'http://172.16.4.4/x.png',
      'http://172.31.255.1/x.png',
      'http://192.168.1.1/reboot',
      'http://169.254.169.254/latest/meta-data/',
      'http://0.0.0.0/x.png',
      'http://[::1]/x.png',
      'http://printer.local/x.png',
      'http://239.1.1.1/x.png',
    ]
    for (const u of blocked) expect(normaliseImageUrl(u), u).toBeNull()
  })

  it('still allows public addresses that merely look adjacent to private ones', () => {
    for (const u of ['http://172.32.0.1/a.png', 'http://11.0.0.1/a.png', 'http://192.169.1.1/a.png']) {
      expect(normaliseImageUrl(u), u).not.toBeNull()
    }
  })
})

describe('loadRemoteImages', () => {
  it('returns a data: URI keyed by the ORIGINAL markup url', async () => {
    const f = fakeFetch()
    // Protocol-relative in, so the key must be the original and not the resolved form.
    const res = await loadRemoteImages(['//cdn.example.com/a.png'], f)
    expect(res.loaded).toBe(1)
    expect(res.images['//cdn.example.com/a.png']).toMatch(/^data:image\/png;base64,/)
    expect(f.calls).toEqual(['https://cdn.example.com/a.png'])
  })

  it('never issues a request for a blocked host', async () => {
    const f = fakeFetch()
    const res = await loadRemoteImages(['http://169.254.169.254/latest/meta-data/'], f)
    expect(f.calls).toEqual([])
    expect(res.loaded).toBe(0)
  })

  it('emits the content type from the allow-list, not from the response', async () => {
    // A hostile server answering with a script type must not produce that type.
    const f = fakeFetch(() => ({ type: 'text/html' }))
    const res = await loadRemoteImages(['https://e.com/a.png'], f)
    expect(res.loaded).toBe(0)
    expect(res.failed).toBe(1)
  })

  it('refuses image/svg+xml — an SVG can carry script', async () => {
    const f = fakeFetch(() => ({ type: 'image/svg+xml' }))
    const res = await loadRemoteImages(['https://e.com/a.svg'], f)
    expect(res.loaded).toBe(0)
  })

  it('tolerates a content type with parameters', async () => {
    const f = fakeFetch(() => ({ type: 'image/png; charset=binary' }))
    const res = await loadRemoteImages(['https://e.com/a.png'], f)
    expect(res.loaded).toBe(1)
  })

  it('drops an image past the per-image ceiling', async () => {
    const f = fakeFetch(() => ({ body: Buffer.alloc(LIMITS.maxBytes + 1) }))
    const res = await loadRemoteImages(['https://e.com/big.png'], f)
    expect(res.loaded).toBe(0)
    expect(res.failed).toBe(1)
  })

  it('stops once the whole-message ceiling is reached', async () => {
    const big = Buffer.alloc(LIMITS.maxBytes) // 5 MB each, 20 MB total budget
    const f = fakeFetch(() => ({ body: big }))
    const urls = Array.from({ length: 8 }, (_, i) => `https://e.com/${i}.png`)
    const res = await loadRemoteImages(urls, f)
    expect(res.loaded).toBe(4)
    expect(res.failed).toBe(4)
  })

  it('caps how many images one message can request', async () => {
    const f = fakeFetch()
    const urls = Array.from({ length: LIMITS.maxImages + 25 }, (_, i) => `https://e.com/${i}.png`)
    const res = await loadRemoteImages(urls, f)
    expect(res.requested).toBe(LIMITS.maxImages)
    expect(f.calls.length).toBe(LIMITS.maxImages)
  })

  it('fetches a repeated URL once', async () => {
    const f = fakeFetch()
    const res = await loadRemoteImages(['https://e.com/a.png', 'https://e.com/a.png'], f)
    expect(f.calls.length).toBe(1)
    expect(res.loaded).toBe(1)
  })

  it('lets the other images through when one fails', async () => {
    const f = fakeFetch((u) => (u.includes('bad') ? { ok: false } : {}))
    const res = await loadRemoteImages(['https://e.com/bad.png', 'https://e.com/good.png'], f)
    expect(res.loaded).toBe(1)
    expect(res.failed).toBe(1)
    expect(res.images['https://e.com/good.png']).toBeTruthy()
  })

  it('survives a fetch that throws', async () => {
    const f = (async () => { throw new Error('network down') }) as unknown as ImageFetch
    const res = await loadRemoteImages(['https://e.com/a.png'], f)
    expect(res.failed).toBe(1)
    expect(res.loaded).toBe(0)
  })

  it('treats an empty body as a failure rather than an empty image', async () => {
    const f = fakeFetch(() => ({ body: Buffer.alloc(0) }))
    const res = await loadRemoteImages(['https://e.com/a.png'], f)
    expect(res.loaded).toBe(0)
  })

  it('aborts a request that outruns the timeout', async () => {
    vi.useFakeTimers()
    const slow: ImageFetch = (_url, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const p = loadRemoteImages(['https://e.com/slow.png'], slow)
    await vi.advanceTimersByTimeAsync(LIMITS.timeoutMs + 10)
    const res = await p
    expect(res.failed).toBe(1)
    vi.useRealTimers()
  })
})

/*
 * The real netImageFetch adapter — its redirect handling is the SSRF surface.
 * A CDN answering a first-party image URL with a 302 to a loopback/RFC-1918
 * host must NOT be followed (blind SSRF against the user's network / metadata).
 * We mock global fetch and drive netImageFetch directly.
 */
describe('netImageFetch redirect SSRF guard', () => {
  function mockFetch(handler: (url: string) => { status: number; location?: string; contentType?: string }) {
    return vi.fn(async (url: string) => {
      const r = handler(String(url))
      const headers = new Map<string, string>()
      if (r.location) headers.set('location', r.location)
      headers.set('content-type', r.contentType ?? 'image/png')
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
        arrayBuffer: async () => new ArrayBuffer(4),
      }
    })
  }

  it('refuses to follow a redirect to a blocked internal host', async () => {
    const { netImageFetch } = await import('./remote-images')
    const prev = globalThis.fetch
    globalThis.fetch = mockFetch((url) =>
      url.includes('evil') ? { status: 302, location: 'http://169.254.169.254/latest/meta-data/' } : { status: 200 },
    ) as unknown as typeof fetch
    try {
      const res = await netImageFetch('https://evil.example/pixel.png', new AbortController().signal)
      expect(res.ok).toBe(false)
      expect(res.status).toBe(403) // refused at the redirect guard, not fetched
    } finally { globalThis.fetch = prev }
  })

  it('follows a normal redirect to another public host', async () => {
    const { netImageFetch } = await import('./remote-images')
    const prev = globalThis.fetch
    globalThis.fetch = mockFetch((url) =>
      url.includes('start') ? { status: 302, location: 'https://cdn.example.com/real.png' } : { status: 200 },
    ) as unknown as typeof fetch
    try {
      const res = await netImageFetch('https://start.example/img.png', new AbortController().signal)
      expect(res.ok).toBe(true)
      expect(res.status).toBe(200)
    } finally { globalThis.fetch = prev }
  })

  it('bounds the redirect chain', async () => {
    const { netImageFetch } = await import('./remote-images')
    const prev = globalThis.fetch
    // Every hop redirects to another public host forever.
    let n = 0
    globalThis.fetch = mockFetch(() => ({ status: 302, location: `https://h${n++}.example/x.png` })) as unknown as typeof fetch
    try {
      const res = await netImageFetch('https://h.example/x.png', new AbortController().signal)
      expect(res.ok).toBe(false)
      expect(res.status).toBe(508) // hop limit
    } finally { globalThis.fetch = prev }
  })
})
