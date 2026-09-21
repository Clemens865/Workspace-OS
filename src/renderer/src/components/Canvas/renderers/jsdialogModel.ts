/**
 * LibreOfficeKit JSDialog messages → a dialog tree we can render.
 *
 * Under LOK the engine builds ~200 of its dialogs (Sort, Format Cells, Page
 * Style, Validity, Paragraph, …) as JSON widget trees instead of pixels:
 * LOK_CALLBACK_JSDIALOG carries the full tree when a dialog opens, then
 * `update` messages (a replaced subtree), `action` messages (hide / show /
 * enable / disable / select / focus on one control) and finally `close`.
 * Interaction goes back through sendDialogEvent as
 * `{id, cmd, type, data}` — see JsDialog.tsx.
 *
 * This module is the pure part: parse a message, fold it into the current
 * dialog state, and answer questions about the tree. No DOM, unit-tested.
 */

export interface JsWidget {
  id: string
  type: string
  text?: string
  enabled?: boolean
  visible?: boolean
  checked?: boolean
  children?: JsWidget[]
  /** Arbitrary extra properties the engine attaches (entries, tabs, min, max, …). */
  [key: string]: unknown
}

export interface JsDialogResponse {
  id: string
  response: number
}

export interface JsDialogState {
  id: number
  /** 'dialog' or 'popup' (a floating list such as the AutoFilter dropdown). */
  jsontype: string
  title: string
  dialogid?: string
  root: JsWidget
  responses: JsDialogResponse[]
  initFocus?: string
  /** Popups: engine-reported position (document twips / pixels, per engine). */
  posx?: number
  posy?: number
}

export type JsDialogMessage =
  | { kind: 'full'; state: JsDialogState }
  | { kind: 'update'; id: number; control: JsWidget }
  | { kind: 'action'; id: number; controlId: string; actionType: string; data: Record<string, unknown> }
  | { kind: 'close'; id: number }
  | { kind: 'ignore' }

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
  return undefined
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return undefined
}

/** Normalise one widget node (boost writes booleans/numbers as strings). */
export function normalizeWidget(raw: unknown): JsWidget | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const w: JsWidget = { ...o, id: typeof o.id === 'string' ? o.id : String(o.id ?? ''), type: typeof o.type === 'string' ? o.type : 'container' }
  const en = bool(o.enabled); if (en !== undefined) w.enabled = en
  const vis = bool(o.visible); if (vis !== undefined) w.visible = vis
  const ch = bool(o.checked); if (ch !== undefined) w.checked = ch
  if (Array.isArray(o.children)) w.children = o.children.map(normalizeWidget).filter((c): c is JsWidget => !!c)
  else delete w.children
  return w
}

/** Classify a JSDIALOG payload. Unknown or malformed input → `ignore`. */
export function parseJsDialogMessage(payload: string): JsDialogMessage {
  let o: Record<string, unknown>
  try { o = JSON.parse(payload) as Record<string, unknown> } catch { return { kind: 'ignore' } }
  if (!o || typeof o !== 'object') return { kind: 'ignore' }
  // A message box (Yes/No confirmation, error) arrives with an EMPTY id; the
  // owner attaches the window id from the WINDOW callback that comes with it.
  const isMessageBox = o.type === 'messagebox'
  const id = num(o.id) ?? (isMessageBox ? -1 : undefined)
  if (id === undefined) return { kind: 'ignore' }
  const jsontype = typeof o.jsontype === 'string' ? o.jsontype : 'dialog'
  if (jsontype !== 'dialog' && jsontype !== 'popup') return { kind: 'ignore' }
  const action = o.action
  if (action === 'close') return { kind: 'close', id }
  if (action === 'update') {
    const control = normalizeWidget(o.control)
    return control ? { kind: 'update', id, control } : { kind: 'ignore' }
  }
  if (action === 'action') {
    const d = (o.data && typeof o.data === 'object' ? o.data : {}) as Record<string, unknown>
    const controlId = typeof d.control_id === 'string' ? d.control_id : ''
    const actionType = typeof d.action_type === 'string' ? d.action_type : ''
    if (!controlId || !actionType) return { kind: 'ignore' }
    return { kind: 'action', id, controlId, actionType, data: d }
  }
  if (action === undefined || action === 'created' || action === 'full') {
    const root = normalizeWidget(o)
    if (!root || !Array.isArray(root.children)) return { kind: 'ignore' }
    const responses = Array.isArray(o.responses)
      ? (o.responses as Record<string, unknown>[]).map((r) => ({ id: String(r.id ?? ''), response: num(r.response) ?? 0 })).filter((r) => r.id)
      : []
    return {
      kind: 'full',
      state: {
        id,
        jsontype,
        title: typeof o.title === 'string' ? cleanText(o.title) : (typeof o.text === 'string' ? cleanText(o.text) : ''),
        dialogid: typeof o.dialogid === 'string' ? o.dialogid : undefined,
        root,
        responses,
        initFocus: typeof o.init_focus_id === 'string' && o.init_focus_id ? o.init_focus_id : undefined,
        posx: num(o.posx),
        posy: num(o.posy),
      },
    }
  }
  return { kind: 'ignore' }
}

/** `~Ascending` → `Ascending`, `_Reset` → `Reset` (mnemonic markers). */
export function cleanText(t: unknown): string {
  if (typeof t !== 'string') return ''
  return t.replace(/~/g, '').replace(/(^|[^_])_([A-Za-z])/g, '$1$2')
}

/** Depth-first search by id. */
export function findWidget(root: JsWidget, id: string): JsWidget | null {
  if (root.id === id) return root
  for (const c of root.children ?? []) {
    const f = findWidget(c, id)
    if (f) return f
  }
  return null
}

/** A new tree with the node of that id replaced (or patched) — never mutates. */
function mapWidget(root: JsWidget, id: string, fn: (w: JsWidget) => JsWidget): JsWidget {
  if (root.id === id && id !== '') return fn(root)
  if (!root.children) return root
  let changed = false
  const children = root.children.map((c) => { const n = mapWidget(c, id, fn); if (n !== c) changed = true; return n })
  return changed ? { ...root, children } : root
}

/** Fold an update/action into the state. Full and close are handled by the owner (a new state / removal). */
export function applyJsDialogMessage(state: JsDialogState, msg: JsDialogMessage): JsDialogState {
  if (msg.kind === 'update') {
    return { ...state, root: mapWidget(state.root, msg.control.id, () => msg.control) }
  }
  if (msg.kind === 'action') {
    const patch = (w: JsWidget): JsWidget => {
      switch (msg.actionType) {
        case 'hide': return { ...w, visible: false }
        case 'show': return { ...w, visible: true }
        case 'enable': return { ...w, enabled: true }
        case 'disable': return { ...w, enabled: false }
        case 'select': {
          const pos = num(msg.data.position)
          if (pos === undefined) return w
          if (w.type === 'tabcontrol') return { ...w, selected: pos }
          return { ...w, selectedEntries: [String(pos)], selectedCount: 1 }
        }
        case 'setText': {
          const text = msg.data.text
          return typeof text === 'string' ? { ...w, text } : w
        }
        default: return w
      }
    }
    const next = mapWidget(state.root, msg.controlId, patch)
    if (msg.actionType === 'grab_focus') return { ...state, root: next, initFocus: msg.controlId }
    return next === state.root ? state : { ...state, root: next }
  }
  return state
}

/** A floating popup (the AutoFilter dropdown, a colour picker) rather than a modal dialog. */
export function isPopup(state: JsDialogState): boolean {
  return state.jsontype === 'popup' || state.root.type === 'modalpopup'
}

/** A message box: answered with Enter (default / Yes / OK) or Escape (No / Cancel) on its window. */
export function isMessageBox(state: JsDialogState): boolean {
  return state.root.type === 'messagebox'
}

/** The response buttons (OK / Cancel / …) declared by the dialog, as the engine lists them. */
export function responseIds(state: JsDialogState): Set<string> {
  return new Set(state.responses.map((r) => r.id))
}
