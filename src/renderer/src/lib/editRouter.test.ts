import { describe, it, expect, afterEach } from 'vitest'
import { editCommandFor, isTextEntry, resolveEditTarget, runOnTextEntry, runOnWebview, setFieldValue, UNO_FOR, ACTION_FOR } from './editRouter'

/** Minimal element stand-ins — the routing decision is pure DOM inspection. */
function el(tagName: string, extra: Record<string, unknown> = {}): Element {
  return { tagName, ...extra } as unknown as Element
}

describe('isTextEntry', () => {
  it('accepts a textarea and text-ish inputs', () => {
    expect(isTextEntry(el('TEXTAREA'))).toBe(true)
    expect(isTextEntry(el('INPUT', { type: 'text' }))).toBe(true)
    expect(isTextEntry(el('INPUT', { type: 'url' }))).toBe(true)
    expect(isTextEntry(el('INPUT', { type: 'search' }))).toBe(true)
  })

  it('rejects inputs with nothing to copy', () => {
    for (const type of ['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset']) {
      expect(isTextEntry(el('INPUT', { type }))).toBe(false)
    }
  })

  it('accepts contenteditable', () => {
    expect(isTextEntry(el('DIV', { isContentEditable: true }))).toBe(true)
    expect(isTextEntry(el('DIV', { isContentEditable: false }))).toBe(false)
  })

  it('handles no focused element', () => {
    expect(isTextEntry(null)).toBe(false)
  })
})

describe('resolveEditTarget', () => {
  it('sends the command to a focused text entry — this is the WOS-006 fix', () => {
    // The browser address bar. Before the fix, ⌘C here dispatched .uno:Copy into
    // an office document the user wasn't looking at, and copied nothing.
    expect(resolveEditTarget(el('INPUT', { type: 'text' }))).toBe('input')
  })

  it('routes a focused webview to the webview target', () => {
    expect(resolveEditTarget(el('WEBVIEW'))).toBe('webview')
  })

  it('falls through to the canvas, preserving office behaviour', () => {
    expect(resolveEditTarget(el('CANVAS'))).toBe('canvas')
    expect(resolveEditTarget(el('DIV'))).toBe('canvas')
    expect(resolveEditTarget(null)).toBe('canvas')
  })

  it('prefers a text entry over everything — the caret is where the user is looking', () => {
    expect(resolveEditTarget(el('INPUT', { type: 'text', isContentEditable: false }))).toBe('input')
  })
})

describe('runOnWebview', () => {
  it('forwards each command to the guest — the menu accelerator already ate the keystroke', () => {
    // Before this, 'webview' was a deliberate no-op ("the guest owns its own
    // clipboard") — but the custom Edit accelerators CONSUME ⌘X/⌘C/⌘V/⌘A, so
    // the guest never saw them: paste into a browser field did nothing.
    for (const cmd of ['cut', 'copy', 'paste', 'selectAll'] as const) {
      const calls: string[] = []
      const webview = el('WEBVIEW', {
        cut: () => calls.push('cut'),
        copy: () => calls.push('copy'),
        paste: () => calls.push('paste'),
        selectAll: () => calls.push('selectAll'),
      })
      expect(runOnWebview(webview, cmd)).toBe(true)
      expect(calls).toEqual([cmd])
    }
  })

  it('reports false on an element without the editing methods', () => {
    expect(runOnWebview(el('WEBVIEW'), 'paste')).toBe(false)
  })
})

describe('command mapping', () => {
  it('round-trips every command through its menu action id', () => {
    for (const cmd of ['cut', 'copy', 'paste', 'selectAll'] as const) {
      expect(editCommandFor(ACTION_FOR[cmd])).toBe(cmd)
    }
  })

  it('ignores unrelated menu actions', () => {
    expect(editCommandFor('go.quickopen')).toBeNull()
    expect(editCommandFor('office.uno:.uno:Bold')).toBeNull()
    expect(editCommandFor('')).toBeNull()
  })

  it('maps each command to the uno command the canvas expects', () => {
    expect(UNO_FOR.copy).toBe('.uno:Copy')
    expect(UNO_FOR.cut).toBe('.uno:Cut')
    expect(UNO_FOR.paste).toBe('.uno:Paste')
    expect(UNO_FOR.selectAll).toBe('.uno:SelectAll')
  })
})

/**
 * WOS-008. These tests model the two mechanisms that made ⌘V in the mail
 * composer a silent no-op, because neither is visible from a stand-in object.
 *
 * There is no DOM environment in this suite, so the browser pieces that matter
 * are reproduced exactly: `value` is an ACCESSOR on the prototype (as it is on
 * a real HTMLInputElement), and React's controlled-input tracker is an own
 * property that shadows it and caches the last value it saw.
 */

/**
 * Stands in for a real input. The one detail that matters: `value` is an
 * accessor on the PROTOTYPE, as it is on a real HTMLInputElement — that is what
 * lets React shadow it with an own property, and what the fix reaches past.
 */
class FakeInput {
  tagName = 'INPUT'
  _value = ''
  selectionStart = 0
  selectionEnd = 0
  events: string[] = []
  get value(): string {
    return this._value
  }
  set value(v: string) {
    this._value = v
  }
  setSelectionRange(start: number, end: number): void {
    this.selectionStart = start
    this.selectionEnd = end
  }
  dispatchEvent(ev: Event): boolean {
    this.events.push(ev.type)
    return true
  }
}

/**
 * What React does to a controlled <input>: shadow `value` with an own accessor
 * that also records the value, so it can later tell whether the node changed
 * underneath it. If the cache still matches the node, React concludes nothing
 * happened and never fires onChange — which is the bug.
 */
function installReactTracker(node: FakeInput): { wouldFireOnChange: () => boolean } {
  const proto = Object.getOwnPropertyDescriptor(FakeInput.prototype, 'value')!
  let tracked = proto.get!.call(node) as string
  Object.defineProperty(node, 'value', {
    configurable: true,
    get: () => proto.get!.call(node),
    set: (v: string) => {
      tracked = v
      proto.set!.call(node, v)
    },
  })
  return { wouldFireOnChange: () => tracked !== proto.get!.call(node) }
}

function field(value: string, start = value.length, end = start): FakeInput {
  const f = new FakeInput()
  f._value = value
  f.selectionStart = start
  f.selectionEnd = end
  return f
}

const realWindow = globalThis.window
const realInputCtor = globalThis.HTMLInputElement

/** Point the module's native-setter lookup at the fake, and stub the bridge. */
function withBrowser(clipboardText: string, written: string[] = []): void {
  ;(globalThis as Record<string, unknown>)['HTMLInputElement'] = FakeInput
  ;(globalThis as Record<string, unknown>)['window'] = {
    workspace: {
      clipboard: {
        readText: async () => clipboardText,
        writeText: async (t: string) => {
          written.push(t)
          return true
        },
      },
    },
  }
}

afterEach(() => {
  ;(globalThis as Record<string, unknown>)['window'] = realWindow
  ;(globalThis as Record<string, unknown>)['HTMLInputElement'] = realInputCtor
})

describe('setFieldValue — the React value tracker (WOS-008 defect 2)', () => {
  it('a direct assignment is invisible to React, which is why paste vanished', () => {
    // Not asserting our code — asserting the mechanism the old code used, so
    // this test fails loudly if the premise ever stops being true.
    const input = field('')
    const tracker = installReactTracker(input)
    input.value = 'pasted'
    expect(input.value).toBe('pasted') // the DOM node did change
    expect(tracker.wouldFireOnChange()).toBe(false) // …but React never hears about it
  })

  it('writing through the native setter leaves the cache stale, so onChange fires', () => {
    ;(globalThis as Record<string, unknown>)['HTMLInputElement'] = FakeInput
    const input = field('')
    const tracker = installReactTracker(input)
    setFieldValue(input as unknown as HTMLInputElement, 'pasted')
    expect(input.value).toBe('pasted')
    expect(tracker.wouldFireOnChange()).toBe(true)
    expect(input.events).toContain('input')
  })
})

describe('runOnTextEntry paste (WOS-008)', () => {
  it('inserts clipboard text at the caret and updates React state', async () => {
    withBrowser('WORLD')
    const input = field('hello ')
    const tracker = installReactTracker(input)

    const ok = await runOnTextEntry(input as unknown as HTMLElement, 'paste')

    expect(ok).toBe(true)
    expect(input.value).toBe('hello WORLD')
    expect(tracker.wouldFireOnChange()).toBe(true) // the controlled field will keep it
    expect(input.selectionStart).toBe('hello WORLD'.length) // caret after the insert
  })

  it('replaces the selection rather than appending', async () => {
    withBrowser('there')
    const input = field('hello world', 6, 11) // "world" selected
    await runOnTextEntry(input as unknown as HTMLElement, 'paste')
    expect(input.value).toBe('hello there')
  })

  it('reports failure instead of silently doing nothing when the read fails', async () => {
    // The original defect: readText() rejected (clipboard-read denied) and the
    // caller discarded the false, so nothing anywhere said the paste failed.
    ;(globalThis as Record<string, unknown>)['window'] = {
      workspace: {
        clipboard: {
          readText: async () => {
            throw new Error('denied')
          },
        },
      },
    }
    const input = field('untouched')
    const ok = await runOnTextEntry(input as unknown as HTMLElement, 'paste')
    expect(ok).toBe(false)
    expect(input.value).toBe('untouched')
  })

  it('goes through the Electron bridge, never navigator.clipboard', async () => {
    // navigator.clipboard.readText() rejects in this app — the deny-all
    // permission handler refuses `clipboard-read`. If the bridge is bypassed,
    // this throws rather than quietly regressing to the broken path.
    withBrowser('from-bridge')
    // `navigator` is a getter-only global in node, so it has to be redefined.
    const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { readText: () => Promise.reject(new Error('clipboard-read denied')) } },
    })
    try {
      const input = field('')
      const ok = await runOnTextEntry(input as unknown as HTMLElement, 'paste')
      expect(ok).toBe(true)
      expect(input.value).toBe('from-bridge')
    } finally {
      if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator)
    }
  })
})

describe('runOnTextEntry copy/cut (WOS-008)', () => {
  it('copies the selection to the system pasteboard', async () => {
    const written: string[] = []
    withBrowser('', written)
    const input = field('hello world', 6, 11)
    const ok = await runOnTextEntry(input as unknown as HTMLElement, 'copy')
    expect(ok).toBe(true)
    expect(written).toEqual(['world'])
    expect(input.value).toBe('hello world') // copy does not mutate
  })

  it('cut removes the selection and tells React', async () => {
    const written: string[] = []
    withBrowser('', written)
    const input = field('hello world', 5, 11) // " world"
    const tracker = installReactTracker(input)
    const ok = await runOnTextEntry(input as unknown as HTMLElement, 'cut')
    expect(ok).toBe(true)
    expect(written).toEqual([' world'])
    expect(input.value).toBe('hello')
    expect(tracker.wouldFireOnChange()).toBe(true)
  })

  it('an empty selection is a no-op, not a failure', async () => {
    const written: string[] = []
    withBrowser('', written)
    const input = field('hello', 2, 2)
    expect(await runOnTextEntry(input as unknown as HTMLElement, 'copy')).toBe(true)
    expect(written).toEqual([])
  })
})
