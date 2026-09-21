import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'

// browserControl imports electron (app.getPath). Stub it so the pure logic
// (mode selection + screenshot-path guard + drive fns) is node-unit-testable.
vi.mock('electron', () => ({
  app: { getPath: () => '/data' },
  ipcHandle: () => {},
}))

import { normalizeMode, scriptForMode, EXTRACT_MODES } from './extractScript'
import {
  resolveScreenshotPath, navigate, extract, current, map, clearConsent, deepRead,
  dismissCookies, click, scroll, waitFor, back, forward, type,
  captureBrowserGuest, setActiveGuest, registerTab, unregisterTab, requireGuest, resetBrowserGuest,
} from './browserControl'

describe('extraction mode selection', () => {
  it('accepts every known mode verbatim', () => {
    for (const m of EXTRACT_MODES) expect(normalizeMode(m)).toBe(m)
  })

  it('falls back to `text` for unknown / hostile input', () => {
    expect(normalizeMode('evil')).toBe('text')
    expect(normalizeMode(undefined)).toBe('text')
    expect(normalizeMode('alert(1)')).toBe('text')
    expect(normalizeMode({ mode: 'x' })).toBe('text')
  })

  it('maps each mode to a FIXED script string (never agent-supplied JS)', () => {
    for (const m of EXTRACT_MODES) {
      const s = scriptForMode(m)
      expect(typeof s).toBe('string')
      expect(s.length).toBeGreaterThan(0)
    }
    // The links script is the one that reads anchors — sanity-check it's fixed.
    expect(scriptForMode('links')).toContain('querySelectorAll')
  })
})

describe('resolveScreenshotPath (path guard)', () => {
  const roots = ['/data', '/ws']

  it('defaults to a .png under the first root when none given', () => {
    const p = resolveScreenshotPath(undefined, roots)
    expect(p.startsWith('/data' + path.sep)).toBe(true)
    expect(p.endsWith('.png')).toBe(true)
  })

  it('allows a path inside an allowed root', () => {
    expect(resolveScreenshotPath('/ws/shots/a.png', roots)).toBe('/ws/shots/a.png')
  })

  it('rejects traversal outside every root', () => {
    expect(() => resolveScreenshotPath('/etc/evil.png', roots)).toThrow(/under the workspace/)
    expect(() => resolveScreenshotPath('/ws/../etc/x.png', roots)).toThrow(/under the workspace/)
  })

  it('rejects a non-png extension', () => {
    expect(() => resolveScreenshotPath('/ws/a.txt', roots)).toThrow(/\.png/)
  })
})

describe('drive functions (mocked guest)', () => {
  it('extract runs the fixed script and returns {ok,mode,data}', async () => {
    const wc = { executeJavaScript: vi.fn(async () => ({ title: 'T', text: 'hi' })) }
    const r = await extract(wc as never, 'text')
    expect(wc.executeJavaScript).toHaveBeenCalledWith(scriptForMode('text'), true)
    expect(r).toEqual({ ok: true, mode: 'text', data: { title: 'T', text: 'hi' } })
  })

  it('current returns the guest url + title', () => {
    const wc = { getURL: () => 'https://x.test/', getTitle: () => 'X' }
    expect(current(wc as never)).toEqual({ ok: true, url: 'https://x.test/', title: 'X' })
  })

  it('navigate resolves on did-finish-load and returns final url/title', async () => {
    const listeners: Record<string, (...a: unknown[]) => void> = {}
    const wc = {
      on: (ev: string, fn: (...a: unknown[]) => void) => { listeners[ev] = fn },
      removeListener: () => {},
      loadURL: vi.fn(async () => { setTimeout(() => listeners['did-finish-load']?.(), 0) }),
      getURL: () => 'https://x.test/',
      getTitle: () => 'X',
    }
    const r = await navigate(wc as never, 'https://x.test/')
    expect(wc.loadURL).toHaveBeenCalledWith('https://x.test/')
    expect(r).toEqual({ ok: true, url: 'https://x.test/', title: 'X' })
  })

  it('navigate rejects on a real did-fail-load (not the ERR_ABORTED churn)', async () => {
    const listeners: Record<string, (...a: unknown[]) => void> = {}
    const wc = {
      on: (ev: string, fn: (...a: unknown[]) => void) => { listeners[ev] = fn },
      removeListener: () => {},
      loadURL: vi.fn(async () => {
        setTimeout(() => listeners['did-fail-load']?.({}, -3, 'aborted'), 0) // ignored
        setTimeout(() => listeners['did-fail-load']?.({}, -105, 'NAME_NOT_RESOLVED'), 1)
      }),
      getURL: () => '',
      getTitle: () => '',
    }
    await expect(navigate(wc as never, 'https://nope.test/')).rejects.toThrow(/NAME_NOT_RESOLVED/)
  })
})

describe('interaction drive functions (mocked guest — bridge passthrough)', () => {
  it('dismissCookies runs the fixed script and normalises the result', async () => {
    const wc = { executeJavaScript: vi.fn(async () => ({ clicked: true, label: 'Accept all' })) }
    const r = await dismissCookies(wc as never)
    const [script, userGesture] = wc.executeJavaScript.mock.calls[0]
    expect(userGesture).toBe(true)
    expect(String(script)).toContain('#onetrust-accept-btn-handler')
    expect(r).toEqual({ ok: true, clicked: true, label: 'Accept all' })
  })

  it('dismissCookies reports {clicked:false} (not an error) when none found', async () => {
    const wc = { executeJavaScript: vi.fn(async () => ({ clicked: false })) }
    expect(await dismissCookies(wc as never)).toEqual({ ok: true, clicked: false, label: undefined })
  })

  it('click passes an escaped selector/text and returns the hit', async () => {
    const wc = { executeJavaScript: vi.fn(async () => ({ clicked: true, tag: 'a', text: 'Products', href: 'https://x/p' })) }
    const r = await click(wc as never, 'a.nav', 'Products')
    expect(String(wc.executeJavaScript.mock.calls[0][0])).toContain("'a.nav'")
    expect(r).toEqual({ ok: true, clicked: true, tag: 'a', text: 'Products', href: 'https://x/p' })
  })

  it('click rejects when neither selector nor text is given', async () => {
    const wc = { executeJavaScript: vi.fn() }
    await expect(click(wc as never, '', '')).rejects.toThrow(/selector or text/)
    expect(wc.executeJavaScript).not.toHaveBeenCalled()
  })

  it('scroll returns {scrollY,atBottom}', async () => {
    const wc = { executeJavaScript: vi.fn(async () => ({ scrollY: 1200, atBottom: true })) }
    expect(await scroll(wc as never, 'bottom', undefined)).toEqual({ ok: true, scrollY: 1200, atBottom: true })
  })

  it('waitFor returns {found} and rejects with no target', async () => {
    const wc = { executeJavaScript: vi.fn(async () => ({ found: true })) }
    expect(await waitFor(wc as never, '#ok', '', 1000)).toEqual({ ok: true, found: true })
    await expect(waitFor(wc as never, '', '', 1000)).rejects.toThrow(/selector or text/)
  })

  it('type rejects without a selector and returns {typed} otherwise', async () => {
    const wc = { executeJavaScript: vi.fn(async () => ({ typed: true, tag: 'input' })) }
    await expect(type(wc as never, '', 'hi')).rejects.toThrow(/selector/)
    expect(await type(wc as never, 'input#q', 'hi')).toEqual({ ok: true, typed: true, tag: 'input' })
  })

  it('map runs the fixed perception script and returns {ok,data}', async () => {
    const perceived = { title: 'Acme', url: 'https://acme.com', headings: [], links: [], interactives: [], consent: { present: false, hint: '' } }
    const wc = { executeJavaScript: vi.fn(async () => perceived) }
    const r = await map(wc as never)
    expect(String(wc.executeJavaScript.mock.calls[0][0])).toContain('classify')
    expect(r).toEqual({ ok: true, data: perceived })
  })

  it('clearConsent runs the hardened script and settles on a clear', async () => {
    const wc = {
      executeJavaScript: vi.fn(async () => ({ cleared: true, method: 'wall', wasWall: true })),
      once: (_ev: string, fn: () => void) => setTimeout(fn, 0),
      removeListener: () => {},
    }
    const r = await clearConsent(wc as never)
    // hardened script handles overlay + wall + iframe
    expect(String(wc.executeJavaScript.mock.calls[0][0])).toContain('contentDocument')
    expect(r).toEqual({ ok: true, cleared: true, method: 'wall', wasWall: true })
  })

  it('clearConsent reports {cleared:false, method:none} (not an error) when nothing found', async () => {
    const wc = { executeJavaScript: vi.fn(async () => ({ cleared: false, method: 'none', wasWall: false })) }
    expect(await clearConsent(wc as never)).toEqual({ ok: true, cleared: false, method: 'none', wasWall: false })
  })

  it('back/forward navigate history and return the settled url', async () => {
    const nav = { canGoBack: () => true, goBack: vi.fn(), canGoForward: () => false, goForward: vi.fn() }
    const wc = {
      navigationHistory: nav,
      once: (_ev: string, fn: () => void) => setTimeout(fn, 0),
      removeListener: () => {},
      getURL: () => 'https://x.test/prev',
    }
    expect(await back(wc as never)).toEqual({ ok: true, url: 'https://x.test/prev' })
    expect(nav.goBack).toHaveBeenCalled()
    // forward is a no-op when canGoForward() is false — still returns the url.
    expect(await forward(wc as never)).toEqual({ ok: true, url: 'https://x.test/prev' })
    expect(nav.goForward).not.toHaveBeenCalled()
  })
})

describe('tab-id → guest resolution (Stage 2)', () => {
  // A minimal guest: a stable webContents id, a destroyed flag, and a captured
  // `destroyed` handler so we can simulate a tab closing.
  function makeGuest(id: number) {
    let destroyed = false
    let onDestroyed: (() => void) | undefined
    return {
      id,
      isDestroyed: () => destroyed,
      once: (ev: string, fn: () => void) => { if (ev === 'destroyed') onDestroyed = fn },
      getURL: () => `https://tab${id}.test/`,
      getTitle: () => `T${id}`,
      kill: () => { destroyed = true; onDestroyed?.() },
    }
  }

  beforeEach(() => resetBrowserGuest())

  it('resolves an EXPLICIT tab id to its registered guest', () => {
    const g1 = makeGuest(11)
    const g2 = makeGuest(22)
    captureBrowserGuest(g1 as never)
    captureBrowserGuest(g2 as never)
    registerTab('tab-a', 11)
    registerTab('tab-b', 22)
    expect(requireGuest('tab-a')).toBe(g1)
    expect(requireGuest('tab-b')).toBe(g2)
  })

  it('falls back to the ACTIVE guest when no tab id is given', () => {
    const g1 = makeGuest(11)
    const g2 = makeGuest(22)
    captureBrowserGuest(g1 as never) // first attach → active by default
    captureBrowserGuest(g2 as never)
    registerTab('tab-a', 11)
    registerTab('tab-b', 22)
    // Default active is g1 (first attach); explicit setActiveGuest re-points it.
    expect(requireGuest()).toBe(g1)
    setActiveGuest(22)
    expect(requireGuest()).toBe(g2)
  })

  it('throws for an unknown / closed tab id (never silently hits the wrong page)', () => {
    const g1 = makeGuest(11)
    captureBrowserGuest(g1 as never)
    registerTab('tab-a', 11)
    expect(() => requireGuest('nope')).toThrow(/no live browser tab/)
    g1.kill() // tab closes → its mapping is dropped
    expect(() => requireGuest('tab-a')).toThrow(/no live browser tab/)
  })

  it('unregisterTab drops the mapping but leaves the active fallback', () => {
    const g1 = makeGuest(11)
    captureBrowserGuest(g1 as never)
    registerTab('tab-a', 11)
    unregisterTab('tab-a')
    expect(() => requireGuest('tab-a')).toThrow(/no live browser tab/)
    // The guest is still attached + active, so an unscoped call still resolves.
    expect(requireGuest()).toBe(g1)
  })

  it('ignores registering a tab for a non-attached / destroyed guest id', () => {
    const g1 = makeGuest(11)
    captureBrowserGuest(g1 as never)
    expect(registerTab('tab-x', 999)).toEqual({ ok: true, tab: null })
    expect(() => requireGuest('tab-x')).toThrow(/no live browser tab/)
  })
})

describe('deepRead orchestration (mocked guest drive)', () => {
  // Build a guest whose navigate() resolves immediately, whose executeJavaScript
  // dispatches by which fixed script it was handed (map vs clearConsent vs
  // extract text), and which tracks the "current" url as navigations happen.
  function makeGuest(mapData: unknown) {
    let url = ''
    const listeners: Record<string, ((...a: unknown[]) => void)[]> = {}
    return {
      url: () => url,
      on: (ev: string, fn: (...a: unknown[]) => void) => { (listeners[ev] ??= []).push(fn) },
      once: (_ev: string, fn: () => void) => setTimeout(fn, 0),
      removeListener: () => {},
      getURL: () => url,
      getTitle: () => 'Acme — Home',
      loadURL: vi.fn(async (u: string) => {
        url = u
        setTimeout(() => (listeners['did-finish-load'] ?? []).forEach((f) => f()), 0)
      }),
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes('classify')) return mapData // map()
        if (script.includes('contentDocument')) return { cleared: false, method: 'none', wasWall: false } // clearConsent
        // extract(text): return a page body seeded with contact data.
        return { title: 'Sub', text: `Body of ${url}. Mail info@acme.com Tel +43 1 234 5678` }
      }),
    }
  }

  it('navigates the homepage + top subpages and assembles a profile', async () => {
    const mapData = {
      title: 'Acme',
      links: [
        { text: 'About', href: 'https://acme.com/about', category: 'about' },
        { text: 'Products', href: 'https://acme.com/products', category: 'products' },
        { text: 'LinkedIn', href: 'https://linkedin.com/company/acme', category: 'other' },
        { text: 'Off', href: 'https://other.com/x', category: 'about' },
      ],
    }
    const wc = makeGuest(mapData)
    const { ok, profile } = await deepRead(wc as never, 'https://acme.com', 2, undefined)
    expect(ok).toBe(true)
    // homepage + 2 same-origin subpages navigated (homepage counts as first load)
    const loaded = wc.loadURL.mock.calls.map((c) => c[0])
    expect(loaded).toContain('https://acme.com')
    expect(loaded).toContain('https://acme.com/about')
    expect(loaded).toContain('https://acme.com/products')
    expect(loaded).not.toContain('https://other.com/x')
    expect(profile.pages.map((p) => p.category)).toEqual(['about', 'products'])
    expect(profile.emails).toContain('info@acme.com')
    expect(profile.socials).toContain('https://linkedin.com/company/acme')
    expect(profile.name).toBe('Acme')
  })

  it('rejects a non-http(s) url (no arbitrary scheme)', async () => {
    const wc = makeGuest({ title: '', links: [] })
    await expect(deepRead(wc as never, 'file:///etc/passwd', 2, undefined)).rejects.toThrow(/http/)
  })

  it('notes when there are no same-origin subpages', async () => {
    const wc = makeGuest({ title: 'Acme', links: [{ text: 'Off', href: 'https://other.com/x', category: 'about' }] })
    const { profile, notes } = await deepRead(wc as never, 'https://acme.com', 4, undefined)
    expect(profile.pages).toEqual([])
    expect(notes.join(' ')).toMatch(/no same-origin/)
  })
})
