/**
 * Decides where a clipboard command should go.
 *
 * WOS-006. The office Edit menu binds ⌘X/⌘C/⌘V/⌘A on the APPLICATION menu, so
 * those accelerators fire everywhere — including the browser address bar, the
 * mail composer, and every other input in the app chrome. Sending them straight
 * to the LibreOffice engine meant ⌘C in the address bar dispatched `.uno:Copy`
 * into a document the user wasn't even looking at, and copied nothing.
 *
 * Main can't make this call: it can see which webContents has focus, but not
 * whether the caret is in an <input> or on the document canvas. The renderer
 * can, so the decision lives here.
 *
 * The office context is only cleared when the LOK renderer UNMOUNTS, so merely
 * having a document tab open — even on another surface — was enough to break
 * copy everywhere. Routing by focus fixes it regardless of that bookkeeping.
 */

export type EditCommand = 'cut' | 'copy' | 'paste' | 'selectAll'

/** Where a clipboard command should be executed. */
export type EditTarget = 'input' | 'webview' | 'canvas'

/** True for elements that own their own text editing and selection. */
export function isTextEntry(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA') return true
  if (tag === 'INPUT') {
    // Only text-ish inputs hold a selection worth copying.
    const type = (el as HTMLInputElement).type
    return !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset'].includes(type)
  }
  return (el as HTMLElement).isContentEditable === true
}

/**
 * Pick the target for a clipboard command from whatever currently has focus.
 *
 * Order matters: a focused text entry always wins, because that is where the
 * user's caret visibly is. A <webview> gets the command forwarded to its guest
 * (see runOnWebview — the accelerator has already eaten the keystroke).
 * Everything else falls through to the canvas, which preserves the office
 * behaviour this routing was added to protect.
 */
export function resolveEditTarget(active: Element | null): EditTarget {
  if (isTextEntry(active)) return 'input'
  if (active?.tagName === 'WEBVIEW') return 'webview'
  return 'canvas'
}

/** The `.uno:` command an office canvas expects for each edit command. */
export const UNO_FOR: Record<EditCommand, string> = {
  cut: '.uno:Cut',
  copy: '.uno:Copy',
  paste: '.uno:Paste',
  selectAll: '.uno:SelectAll',
}

/** The menu action ids main sends for each command. */
export const ACTION_FOR: Record<EditCommand, string> = {
  cut: 'edit.cut',
  copy: 'edit.copy',
  paste: 'edit.paste',
  selectAll: 'edit.selectAll',
}

/** Parse a `menu:run-action` id back into an EditCommand, or null. */
export function editCommandFor(actionId: string): EditCommand | null {
  const entry = (Object.keys(ACTION_FOR) as EditCommand[]).find((k) => ACTION_FOR[k] === actionId)
  return entry ?? null
}

/**
 * Read the system pasteboard.
 *
 * WOS-008: `navigator.clipboard.readText()` CANNOT work in this app.
 * `applySessionSecurity` installs a deny-all `setPermissionRequestHandler`, so
 * `clipboard-read` is refused, the promise rejects, and paste silently does
 * nothing. Main reads the pasteboard through Electron's clipboard module
 * instead — no permission, no transient-activation requirement.
 *
 * The navigator fallback is for unit tests and any host without the bridge.
 */
async function readClipboard(): Promise<string> {
  const bridge = globalThis.window?.workspace?.clipboard
  if (bridge) return await bridge.readText()
  return await navigator.clipboard.readText()
}

/** Write the system pasteboard. Same reasoning as readClipboard. */
async function writeClipboard(text: string): Promise<void> {
  const bridge = globalThis.window?.workspace?.clipboard
  if (bridge) {
    if (!(await bridge.writeText(text))) throw new Error('clipboard write refused')
    return
  }
  await navigator.clipboard.writeText(text)
}

/**
 * Replace a field's value in a way React actually notices.
 *
 * WOS-008: React installs its own `value` property on the input node and caches
 * the last value it saw. Assigning `input.value = …` goes THROUGH that setter,
 * so the cache is updated too — and when the `input` event arrives React
 * compares the two, sees no change, and never fires `onChange`. For a
 * controlled field (`value={body}`) the state is never updated and the pasted
 * text disappears on the next render, or is dropped from the sent message.
 *
 * Calling the native prototype setter bypasses React's override, leaving its
 * cache stale — so the change is detected and `onChange` fires.
 */
export function setFieldValue(input: HTMLInputElement | HTMLTextAreaElement, next: string): void {
  // Guarded rather than referenced directly so this stays callable under a
  // non-DOM test environment, where these constructors do not exist.
  const ctor = input.tagName === 'TEXTAREA' ? globalThis.HTMLTextAreaElement : globalThis.HTMLInputElement
  const nativeSetter = ctor && Object.getOwnPropertyDescriptor(ctor.prototype, 'value')?.set
  if (nativeSetter) nativeSetter.call(input, next)
  else input.value = next
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Run a clipboard command on a focused <webview>'s guest page.
 *
 * The Edit accelerators are CUSTOM menu items (they must be, to reach the LOK
 * canvas), and a menu item with a click handler CONSUMES the keystroke — the
 * guest never sees ⌘V. So "the webview handles its own clipboard" was only
 * true for the guest's own context menu, never for the shortcuts: copying in
 * a document and pasting into a browser field did nothing at all. The webview
 * tag exposes the guest's editing verbs directly (cut/copy/paste/selectAll),
 * which is where the swallowed shortcut is handed back.
 *
 * Returns false when the element has no such method (not an attached webview).
 */
export function runOnWebview(el: Element, cmd: EditCommand): boolean {
  const guest = el as unknown as Partial<Record<EditCommand, () => void>>
  const fn = guest[cmd]
  if (typeof fn !== 'function') return false
  fn.call(guest)
  return true
}

/**
 * Run a clipboard command against a focused text entry.
 *
 * Returns false when the command could not be performed, so the caller can
 * decide whether to fall through.
 */
export async function runOnTextEntry(el: HTMLElement, cmd: EditCommand): Promise<boolean> {
  const input = el as HTMLInputElement | HTMLTextAreaElement
  const isField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'

  if (cmd === 'selectAll') {
    if (isField) input.select()
    else document.getSelection()?.selectAllChildren(el)
    return true
  }

  if (cmd === 'paste') {
    let text: string
    try {
      text = await readClipboard()
    } catch {
      return false
    }
    if (!text) return true // empty pasteboard is a no-op, not a failure
    if (isField) {
      const start = input.selectionStart ?? input.value.length
      const end = input.selectionEnd ?? start
      setFieldValue(input, input.value.slice(0, start) + text + input.value.slice(end))
      const caret = start + text.length
      input.setSelectionRange(caret, caret)
    } else {
      document.execCommand('insertText', false, text)
    }
    return true
  }

  // cut / copy
  const selected = isField
    ? input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)
    : (document.getSelection()?.toString() ?? '')
  if (!selected) return true // nothing selected is a no-op, not a failure

  try {
    await writeClipboard(selected)
  } catch {
    return false
  }

  if (cmd === 'cut') {
    if (isField) {
      const start = input.selectionStart ?? 0
      const end = input.selectionEnd ?? 0
      setFieldValue(input, input.value.slice(0, start) + input.value.slice(end))
      input.setSelectionRange(start, start)
    } else {
      document.execCommand('delete')
    }
  }
  return true
}
