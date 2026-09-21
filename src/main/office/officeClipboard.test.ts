import { describe, it, expect } from 'vitest'
import { createOfficeClipboard, type OfficeClipboardDeps } from './officeClipboard'

/**
 * WOS-009. The engine's clipboard and the macOS pasteboard are separate, and
 * neither is a superset of the other — the engine holds shapes and formatting
 * that have no text form, the pasteboard is the only one other apps can see.
 * These tests pin the rules for choosing between them.
 */

interface Harness {
  deps: OfficeClipboardDeps
  posted: string[]
  system: { text: string; html: string }
  pasted: { data: string; mime?: string }[]
}

function harness(opts: {
  selection?: Record<string, string>
  system?: { text: string; html?: string }
  pasteFails?: string[]
}): Harness {
  const selection = opts.selection ?? {}
  const posted: string[] = []
  const pasted: { data: string; mime?: string }[] = []
  const system = { text: opts.system?.text ?? '', html: opts.system?.html ?? '' }
  const pasteFails = new Set(opts.pasteFails ?? [])

  return {
    posted,
    system,
    pasted,
    deps: {
      getSelection: async (mime = 'text/plain;charset=utf-8') => selection[mime] ?? '',
      pasteBuffer: async (data, mime) => {
        if (mime && pasteFails.has(mime)) return false
        pasted.push({ data, mime })
        return true
      },
      postUno: async (c) => {
        posted.push(c)
      },
      readSystem: () => ({ text: system.text, html: system.html }),
      writeSystem: (v) => {
        system.text = v.text
        system.html = v.html ?? ''
      },
    },
  }
}

const PLAIN = 'text/plain;charset=utf-8'
const HTML = 'text/html'

describe('copy out of a document', () => {
  it('puts the selection on the system pasteboard — the whole point of WOS-009', async () => {
    const h = harness({ selection: { [PLAIN]: 'Dear Sir or Madam', [HTML]: '<p>Dear Sir or Madam</p>' } })
    const out = await createOfficeClipboard(h.deps).handle('.uno:Copy')

    expect(out).toBe('mirrored')
    expect(h.system.text).toBe('Dear Sir or Madam')
    expect(h.system.html).toBe('<p>Dear Sir or Madam</p>')
  })

  it('still posts .uno:Copy, so an in-document paste keeps full fidelity', async () => {
    const h = harness({ selection: { [PLAIN]: 'text' } })
    await createOfficeClipboard(h.deps).handle('.uno:Copy')
    expect(h.posted).toEqual(['.uno:Copy'])
  })

  it('reads the selection BEFORE cutting it away', async () => {
    // If the order were reversed the selection would already be gone and the
    // pasteboard would get nothing — cut would silently destroy the text.
    const order: string[] = []
    const h = harness({ selection: { [PLAIN]: 'gone in a moment' } })
    const deps: OfficeClipboardDeps = {
      ...h.deps,
      getSelection: async (m = PLAIN) => {
        order.push('read')
        return m === PLAIN ? 'gone in a moment' : ''
      },
      postUno: async (c) => {
        order.push('post')
        h.posted.push(c)
      },
    }
    await createOfficeClipboard(deps).handle('.uno:Cut')
    expect(order[0]).toBe('read')
    expect(h.system.text).toBe('gone in a moment')
  })

  it('leaves the pasteboard ALONE for a selection with no text form', async () => {
    // A shape or image. Clearing here would destroy something the user copied
    // in another app and still expects to paste.
    const h = harness({ selection: {}, system: { text: 'copied in another app' } })
    const out = await createOfficeClipboard(h.deps).handle('.uno:Copy')

    expect(out).toBe('engine-only')
    expect(h.system.text).toBe('copied in another app')
    expect(h.posted).toEqual(['.uno:Copy'])
  })
})

describe('paste into a document', () => {
  it('pushes text copied in ANOTHER app into the document', async () => {
    const h = harness({ system: { text: 'from the browser' } })
    const out = await createOfficeClipboard(h.deps).handle('.uno:Paste')

    expect(out).toBe('pasted-external')
    expect(h.pasted).toEqual([{ data: 'from the browser', mime: PLAIN }])
    expect(h.posted).toEqual([]) // NOT .uno:Paste — that reads the engine's own clipboard
  })

  it('prefers HTML so formatting survives', async () => {
    const h = harness({ system: { text: 'bold thing', html: '<b>bold thing</b>' } })
    await createOfficeClipboard(h.deps).handle('.uno:Paste')
    expect(h.pasted).toEqual([{ data: '<b>bold thing</b>', mime: HTML }])
  })

  it('falls back to plain text rather than losing a refused HTML paste', async () => {
    const h = harness({ system: { text: 'plain fallback', html: '<b>x</b>' }, pasteFails: [HTML] })
    const out = await createOfficeClipboard(h.deps).handle('.uno:Paste')
    expect(out).toBe('pasted-external')
    expect(h.pasted).toEqual([{ data: 'plain fallback', mime: PLAIN }])
  })

  it('uses the ENGINE clipboard when the pasteboard still holds our own copy', async () => {
    // Copying a shape then pasting must not be downgraded to text — and after a
    // text copy the engine has the same content with its formatting intact.
    const h = harness({ selection: { [PLAIN]: 'round trip' } })
    const c = createOfficeClipboard(h.deps)
    await c.handle('.uno:Copy')
    const out = await c.handle('.uno:Paste')

    expect(out).toBe('pasted-engine')
    expect(h.posted).toEqual(['.uno:Copy', '.uno:Paste'])
    expect(h.pasted).toEqual([])
  })

  it('switches to the pasteboard once the user copies somewhere else', async () => {
    const h = harness({ selection: { [PLAIN]: 'ours' } })
    const c = createOfficeClipboard(h.deps)
    await c.handle('.uno:Copy')
    h.system.text = 'theirs, copied in Mail' // another app took the pasteboard
    h.system.html = ''
    const out = await c.handle('.uno:Paste')

    expect(out).toBe('pasted-external')
    expect(h.pasted).toEqual([{ data: 'theirs, copied in Mail', mime: PLAIN }])
  })

  it('falls back to the engine when the pasteboard is empty', async () => {
    const h = harness({ system: { text: '' } })
    const out = await createOfficeClipboard(h.deps).handle('.uno:Paste')
    expect(out).toBe('pasted-engine')
    expect(h.posted).toEqual(['.uno:Paste'])
  })

  it('keeps the engine path when a shape copy left nothing to mirror', async () => {
    // Copy a shape (no text form) while the pasteboard holds old text of ours.
    const h = harness({ selection: { [PLAIN]: 'first' } })
    const c = createOfficeClipboard(h.deps)
    await c.handle('.uno:Copy') // mirrors "first"
    const shape = harness({ selection: {}, system: { text: 'first' } })
    const c2 = createOfficeClipboard(shape.deps)
    await c2.handle('.uno:Copy') // a shape — nothing mirrored
    const out = await c2.handle('.uno:Paste')
    // Nothing of ours is on the pasteboard now, so "first" reads as external.
    expect(out).toBe('pasted-external')
  })
})

describe('everything else is left alone', () => {
  it('passes non-clipboard commands straight through', async () => {
    const h = harness({})
    const c = createOfficeClipboard(h.deps)
    for (const cmd of ['.uno:Bold', '.uno:SelectAll', '.uno:Undo', '.uno:CopyHyperlinkLocation']) {
      expect(await c.handle(cmd)).toBe('not-clipboard')
    }
    expect(h.posted).toEqual([]) // the caller posts these, not us
  })
})
