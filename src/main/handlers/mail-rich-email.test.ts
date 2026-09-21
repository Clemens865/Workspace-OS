import { describe, it, expect, vi } from 'vitest'

/**
 * Handler input-coercion tests for the advanced 1:1 email channels
 * (mail:rich-build, mail:rich-draft, mail:rich-assist, mail:live-data). We
 * register the mail handlers with a fake IpcMain and invoke each channel. The
 * agent-backed paths (brief→MJML draft, writing assist) are mocked to
 * deterministic fakes (no real `claude -p` spawn), and electron's userData path
 * is stubbed so the metrics/ranges singletons can load.
 */

// The brief→MJML agent drafter must never spawn a real subprocess in a unit test.
vi.mock('../mail/rich-email/email-agent-drafter', () => ({
  makeEmailAgentDraftFn: () => async () =>
    '<mjml><mj-body><mj-section><mj-column><mj-text>Hello from the fake agent</mj-text></mj-column></mj-section></mj-body></mjml>',
}))

// The writing-assist agent must not spawn either — return a fixed revised body.
vi.mock('../mail/rich-email/assist-drafter', async (orig) => {
  const actual = await orig<typeof import('../mail/rich-email/assist-drafter')>()
  return { ...actual, makeAssistFn: () => async () => 'A tightened, warmer version of the draft.' }
})

// metrics.ts / ranges.ts read app.getPath('userData'); give a harmless path.
vi.mock('electron', () => ({
  default: { app: { getPath: () => '/tmp/wos-rich-email-test' } },
  app: { getPath: () => '/tmp/wos-rich-email-test' },
}))

import { registerMailHandlers } from './mail'

function fakeIpcMain(): { ipcMain: { handle: (c: string, h: (...a: unknown[]) => unknown) => void }; invoke: (c: string, ...a: unknown[]) => Promise<unknown> } {
  const handlers = new Map<string, (...a: unknown[]) => unknown>()
  return {
    ipcMain: { handle: (c, h) => void handlers.set(c, h) },
    invoke: async (c, ...a) => {
      const h = handlers.get(c)
      if (!h) throw new Error(`no handler for ${c}`)
      return h({}, ...a)
    },
  }
}

const f = fakeIpcMain()
registerMailHandlers(f.ipcMain as never)
type Res = { ok: boolean; value?: any; error?: { code: string; message: string } }
const invoke = (c: string, payload?: unknown): Promise<Res> => f.invoke(c, payload) as Promise<Res>

describe('mail:rich-build handler coercion', () => {
  it('assembles a themed message from text blocks → html + text fallback', async () => {
    const r = await invoke('mail:rich-build', {
      themeId: 'clean',
      blocks: [{ kind: 'text', text: 'Hi there — quick update.' }],
    })
    expect(r.ok).toBe(true)
    expect(r.value.html).toContain('Hi there')
    expect(r.value.html).toContain('@media') // responsive
    expect(r.value.text).toContain('Hi there')
    expect(r.value.errors).toEqual([])
  })

  it('drops invalid blocks and still builds (never throws)', async () => {
    const r = await invoke('mail:rich-build', { blocks: [{ kind: 'bogus' }, { kind: 'text', text: 'Kept.' }] })
    expect(r.ok).toBe(true)
    expect(r.value.html).toContain('Kept.')
  })

  it('coerces a non-object payload to an empty build (still ok)', async () => {
    const r = await invoke('mail:rich-build', undefined)
    expect(r.ok).toBe(true)
    expect(typeof r.value.html).toBe('string')
  })
})

describe('mail:rich-draft handler coercion', () => {
  it('rejects an empty brief with a typed error (no throw)', async () => {
    const r = await invoke('mail:rich-draft', { brief: '   ' })
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('unknown')
  })

  it('coerces a valid brief → compiled html + subject from the fake agent', async () => {
    const r = await invoke('mail:rich-draft', { brief: 'Thank the team' })
    expect(r.ok).toBe(true)
    expect(r.value.html).toContain('Hello from the fake agent')
    expect(r.value.subject).toBe('Thank the team')
  })

  it('coerces a non-string brief → rejected', async () => {
    const r = await invoke('mail:rich-draft', { brief: 12345 })
    expect(r.ok).toBe(false)
  })
})

describe('mail:rich-assist handler', () => {
  it('returns a revised body from the (fake) assistant', async () => {
    const r = await invoke('mail:rich-assist', { action: 'tighten', draft: 'A long rambly draft.' })
    expect(r.ok).toBe(true)
    expect(r.value.body).toContain('tightened')
  })
})

describe('mail:live-data handler', () => {
  it('lists available metrics + ranges when no id is given', async () => {
    const r = await invoke('mail:live-data', {})
    expect(r.ok).toBe(true)
    expect(Array.isArray(r.value.metrics)).toBe(true)
    expect(Array.isArray(r.value.ranges)).toBe(true)
  })

  it('returns a metric-callout block whose value is a live token for a metric id', async () => {
    const r = await invoke('mail:live-data', { metricId: 'nope' })
    expect(r.ok).toBe(true)
    expect(r.value.block.kind).toBe('metric')
    expect(r.value.block.value).toBe('{{metric:nope}}')
  })
})
