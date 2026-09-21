/**
 * WOS-009 — the bridge between the LibreOffice engine's clipboard and macOS.
 *
 * `.uno:Copy` fills the ENGINE's clipboard, which lives inside the out-of-process
 * LOK host and is invisible to every other application. So copying in a .docx
 * put nothing on the system pasteboard, and nothing copied in Mail or the
 * browser could be pasted into a document. Both directions were missing.
 *
 * This sits at the one place every clipboard path funnels through — `lok:uno` —
 * so the keyboard shortcut, the Edit menu, and Calc's right-click menu are all
 * covered by the same code rather than only the Writer keyboard path.
 *
 * The interesting decision is what PASTE should do, because the two clipboards
 * are not interchangeable:
 *
 *   - The engine's clipboard holds shapes, images and full formatting. Its
 *     content often has no text representation at all.
 *   - The system pasteboard is the only one other apps can see.
 *
 * Always preferring the system pasteboard would silently downgrade an in-document
 * copy of a shape to whatever stale text happened to be on the pasteboard.
 * Always preferring the engine would leave external paste broken, which is the
 * bug. So we track what we last mirrored OUT of the engine: if the pasteboard
 * still holds exactly that, the most recent copy was ours and the engine's
 * richer version wins; if it holds something else, it came from another app and
 * we push those bytes in.
 */

/** Everything this module touches, injected so the policy is testable. */
export interface OfficeClipboardDeps {
  /** Read the document selection as `mime` ('' when it has no such form). */
  getSelection: (mime?: string) => Promise<string>
  /** Insert bytes at the cursor. */
  pasteBuffer: (data: string, mime?: string) => Promise<boolean>
  /** Post a `.uno:` command to the engine unchanged. */
  postUno: (command: string) => Promise<void>
  /** Current system pasteboard. */
  readSystem: () => { text: string; html: string }
  /** Replace the system pasteboard. */
  writeSystem: (value: { text: string; html?: string }) => void
}

const HTML = 'text/html'
const PLAIN = 'text/plain;charset=utf-8'

export type ClipboardOutcome =
  | 'not-clipboard' // caller should post the command normally
  | 'mirrored' // selection copied out to the system pasteboard
  | 'engine-only' // nothing text-shaped to mirror; engine clipboard used alone
  | 'pasted-external' // system pasteboard content pushed into the document
  | 'pasted-engine' // engine's own clipboard used (richer, and it was ours)

export interface OfficeClipboard {
  handle: (command: string) => Promise<ClipboardOutcome>
}

export function createOfficeClipboard(deps: OfficeClipboardDeps): OfficeClipboard {
  // The last text we put on the pasteboard on the document's behalf. Used only
  // to recognise our own copy on the way back in.
  let lastMirrored: string | null = null

  async function copyOut(command: string): Promise<ClipboardOutcome> {
    // Read BEFORE posting: for Cut the selection is gone afterwards.
    const text = await deps.getSelection(PLAIN)
    const html = text ? await deps.getSelection(HTML) : ''

    if (text) {
      deps.writeSystem(html ? { text, html } : { text })
      lastMirrored = text
    } else {
      // A shape or image selection has no text form. Leaving the pasteboard
      // untouched is deliberate — clearing it would destroy something the user
      // copied elsewhere and still expects to be able to paste.
      lastMirrored = null
    }

    // Still post the command: the engine's own clipboard is what makes an
    // in-document paste keep shapes, images and formatting.
    await deps.postUno(command)
    return text ? 'mirrored' : 'engine-only'
  }

  async function pasteIn(command: string): Promise<ClipboardOutcome> {
    const { text, html } = deps.readSystem()

    // Nothing outside, or the pasteboard still holds our own copy — the engine
    // has the same content in a richer form.
    if (!text || text === lastMirrored) {
      await deps.postUno(command)
      return 'pasted-engine'
    }

    // Came from another application. HTML first so formatting survives, but a
    // refused HTML paste must not lose the text — fall back rather than fail.
    if (html && (await deps.pasteBuffer(html, HTML))) return 'pasted-external'
    if (await deps.pasteBuffer(text, PLAIN)) return 'pasted-external'

    await deps.postUno(command)
    return 'pasted-engine'
  }

  return {
    async handle(command: string): Promise<ClipboardOutcome> {
      if (command === '.uno:Copy' || command === '.uno:Cut') return copyOut(command)
      if (command === '.uno:Paste') return pasteIn(command)
      return 'not-clipboard'
    },
  }
}
