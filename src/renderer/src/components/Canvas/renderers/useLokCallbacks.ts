import { useEffect, useRef } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { perfBump } from './perfCount'
import { normalizeWebUrl, parseHyperlinkPayload } from '../../../lib/officeLinks'

type Rect = { x: number; y: number; w: number; h: number }
type Caret = { x: number; y: number; h: number }

// LOKit callback types (LibreOfficeKitEnums.h).
const CB_INVALIDATE_TILES = 0
const CB_INVALIDATE_VISIBLE_CURSOR = 1
const CB_TEXT_SELECTION = 2
const CB_HYPERLINK_CLICKED = 7
const CB_GRAPHIC_SELECTION = 6
const CB_CURSOR_VISIBLE = 5
const CB_STATE_CHANGED = 8
const CB_DOC_SIZE_CHANGED = 13
const CB_CELL_CURSOR = 17
const CB_CELL_FORMULA = 19
const CB_CONTEXT_MENU = 23
const CB_REDLINE_TABLE_SIZE_CHANGED = 30
const CB_REDLINE_TABLE_ENTRY_MODIFIED = 31
const CB_COMMENT = 32
const CB_CONTEXT_CHANGED = 39
const CB_CELL_SELECTION_AREA = 42
const CB_JSDIALOG = 46
const CB_TABLE_SELECTED = 44
const CB_WINDOW = 36

/** 0-based column index → spreadsheet letter (0→A, 26→AA). */
function colToLetter(col: number): string {
  let s = ''
  let n = col + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

interface UseLokCallbacksArgs {
  caretTwRef: MutableRefObject<{ x: number; y: number } | null>
  cellCurTwRef: MutableRefObject<Rect | null>
  graphicSelTwRef: MutableRefObject<Rect | null>
  textEditRef: MutableRefObject<boolean>
  pxPerTwipRef: MutableRefObject<number>
  dirtyRectRef: MutableRefObject<Rect | null>
  dirtyRafRef: MutableRefObject<number | null>
  setCaret: Dispatch<SetStateAction<Caret | null>>
  setCaretVisible: Dispatch<SetStateAction<boolean>>
  setCellCursor: Dispatch<SetStateAction<Rect | null>>
  setCellAddr: Dispatch<SetStateAction<string>>
  setCellContent: Dispatch<SetStateAction<string>>
  setGraphicSel: Dispatch<SetStateAction<Rect | null>>
  setSelRects: Dispatch<SetStateAction<Rect[]>>
  setActive: Dispatch<SetStateAction<Record<string, string>>>
  setDialog: Dispatch<SetStateAction<{ id: number; title: string; w: number; h: number } | null>>
  scheduleRepaint: () => void
  scheduleRegionRepaint: (x: number, y: number, w: number, h: number) => void
  /** Evict cached tiles under a dirty twip rect (part-aware when given). */
  evictTiles?: (x: number, y: number, w: number, h: number, part?: number) => void
  /** Evict a whole part's cached tiles (EMPTY / whole-doc invalidation). */
  evictTilePart?: (part?: number) => void
  /**
   * The engine grew/shrank the document (twips). Writer lays out LAZILY — a
   * big .docx opens reporting only the laid-out portion and announces the rest
   * here; ignoring it froze the doc at its initial size (a long-standing bug
   * for large Word files, windowed or not).
   */
  onDocSizeChanged?: (w: number, h: number) => void
  /**
   * The engine answered a right-click with its context menu for the target
   * under the pointer (JSON: commands, enabled and checked state). Rendered by
   * LokRenderer through officeMenu.ts.
   */
  onContextMenu?: (payload: string) => void
  /** Table edges under the cursor/selection (JSON, `{}` when none) — see tableGeometry.ts. */
  onTableSelected?: (payload: string) => void
  /** SEARCH_RESULT_SELECTION (found, payload JSON) / SEARCH_NOT_FOUND (not found, the search string). */
  onSearch?: (found: boolean, payload: string) => void
  /** The sidebar context, e.g. `swriter Table`, `simpress DrawText`, `scalc Cell`. */
  onContextChanged?: (payload: string) => void
  /** Calc: the marked cell range as one px rect (null when none). */
  setCellSelArea?: Dispatch<SetStateAction<Rect | null>>
  /** An engine dialog as a JSON widget tree (full / update / action / close) — see jsdialogModel.ts. */
  onJsDialog?: (payload: string) => void
  /** A comment or tracked change was added/changed/removed — re-query the lists. */
  onReviewChanged?: (kind: 'comment' | 'redline', payload: string) => void
  cancelSettleRepaint: () => void
}

/**
 * Engine callback stream for the LOK renderer: track the cursor + drive repaints.
 * This build does not emit INVALIDATE_TILES on text edits (those repaint from
 * input), but it does for shape/format/structural changes — and we repaint only
 * the dirty region it reports (scheduleRegionRepaint), not the whole document.
 *
 * Extracted verbatim from LokRenderer — the effect keeps its original dependency
 * array [scheduleRepaint, scheduleRegionRepaint, cancelSettleRepaint]; all state
 * setters + twips refs it drives are passed in so identities are unchanged.
 */
export function useLokCallbacks({
  caretTwRef,
  cellCurTwRef,
  graphicSelTwRef,
  textEditRef,
  pxPerTwipRef,
  dirtyRectRef,
  dirtyRafRef,
  setCaret,
  setCaretVisible,
  setCellCursor,
  setCellAddr,
  setCellContent,
  setGraphicSel,
  setSelRects,
  setActive,
  setDialog,
  scheduleRepaint,
  scheduleRegionRepaint,
  evictTiles,
  evictTilePart,
  onDocSizeChanged,
  onContextMenu,
  onTableSelected,
  onSearch,
  onContextChanged,
  setCellSelArea,
  onJsDialog,
  onReviewChanged,
  cancelSettleRepaint,
}: UseLokCallbacksArgs): void {
  const jsDialogRef = useRef(onJsDialog)
  jsDialogRef.current = onJsDialog
  const reviewRef = useRef(onReviewChanged)
  reviewRef.current = onReviewChanged
  // The subscription effect deliberately keeps its narrow dependency array; the
  // menu handler is read through a ref so a re-created callback never forces a
  // resubscribe (which would drop callbacks in flight).
  const contextMenuRef = useRef(onContextMenu)
  contextMenuRef.current = onContextMenu
  const tableSelectedRef = useRef(onTableSelected)
  tableSelectedRef.current = onTableSelected
  const searchRef = useRef(onSearch)
  searchRef.current = onSearch
  const contextChangedRef = useRef(onContextChanged)
  contextChangedRef.current = onContextChanged
  useEffect(() => {
    // Last-emitted px rects, so an unchanged caret/cell-cursor/graphic-selection
    // callback (the common case per keystroke) skips its setState + object alloc
    // entirely — no re-render, no garbage. Reset when the effect re-subscribes.
    let lastCaret: Caret | null = null
    let lastCellCur: Rect | null = null
    const off = window.workspace.lok.onCallback((cb) => {
      if (cb.type === CB_INVALIDATE_TILES) {
        // payload: "x, y, width, height[, part]" twips, or "EMPTY" = whole doc.
        // A real rect → repaint just that region; otherwise fall back to a full
        // (debounced) repaint. paintRegion clamps, so an oversized rect is safe.
        // Either way the TILE CACHE is evicted for the FULL (unclamped) dirty
        // area first — an off-window tile someone scrolls back to must never
        // show pre-edit pixels as final.
        const txt = cb.payload.trim()
        const n = txt.split(',').map((s) => parseInt(s.trim(), 10))
        if (!txt || txt.startsWith('EMPTY') || n.length < 4 || Number.isNaN(n[0]) || n[2] <= 0 || n[3] <= 0) {
          evictTilePart?.()
          scheduleRepaint()
        } else {
          evictTiles?.(n[0], n[1], n[2], n[3], n.length >= 5 && !Number.isNaN(n[4]) ? n[4] : undefined)
          scheduleRegionRepaint(n[0], n[1], n[2], n[3])
        }
      } else if (cb.type === CB_DOC_SIZE_CHANGED) {
        // payload: "width, height" twips.
        const n = cb.payload.split(',').map((s) => parseInt(s.trim(), 10))
        if (n.length >= 2 && !Number.isNaN(n[0]) && !Number.isNaN(n[1]) && n[0] > 0 && n[1] > 0) {
          onDocSizeChanged?.(n[0], n[1])
        }
      } else if (cb.type === CB_INVALIDATE_VISIBLE_CURSOR) {
        // payload: "x, y, width, height" in twips
        const n = cb.payload.split(',').map((s) => parseInt(s.trim(), 10))
        if (n.length >= 4 && !Number.isNaN(n[0])) {
          const p = pxPerTwipRef.current
          caretTwRef.current = { x: n[0], y: n[1] }
          const cx = Math.round(n[0] * p), cy = Math.round(n[1] * p), ch = Math.max(2, Math.round(n[3] * p))
          // Skip the setState + alloc when the caret px rect is identical to the
          // last one (the engine re-emits this callback often with no movement).
          if (!lastCaret || lastCaret.x !== cx || lastCaret.y !== cy || lastCaret.h !== ch) {
            perfBump('setCaret')
            lastCaret = { x: cx, y: cy, h: ch }
            setCaret(lastCaret)
          }
          setCaretVisible(true)
          textEditRef.current = true // caret present → editing text (in a shape or the doc)
        }
      } else if (cb.type === CB_HYPERLINK_CLICKED) {
        // The user clicked a hyperlink in the document (e.g. a URL cell in Calc).
        // payload: the URL, or JSON {text, href}. Route http(s) links to the
        // IN-APP Browser surface via the existing wos:browser-navigate event —
        // NOT the OS browser. Non-web schemes (mailto:/file:/…) are ignored here
        // and left to LibreOffice's default handling.
        const url = normalizeWebUrl(parseHyperlinkPayload(cb.payload))
        if (url) {
          window.dispatchEvent(new CustomEvent('wos:browser-navigate', { detail: { url } }))
        }
      } else if (cb.type === CB_CURSOR_VISIBLE) {
        const on = cb.payload.includes('true')
        setCaretVisible(on)
        textEditRef.current = on
      } else if (cb.type === CB_CELL_CURSOR) {
        // payload: "x, y, w, h, …" twips (the active spreadsheet cell), or
        // "EMPTY" when there's no cell cursor. Drives the cell selection box.
        const txt = cb.payload.trim()
        if (!txt || txt === 'EMPTY') {
          cellCurTwRef.current = null
          if (lastCellCur) { lastCellCur = null; setCellCursor(null) }
        }
        else {
          const n = txt.split(',').map((s) => parseInt(s.trim(), 10))
          if (n.length >= 4 && !Number.isNaN(n[0]) && n[2] > 0) {
            const p = pxPerTwipRef.current
            cellCurTwRef.current = { x: n[0], y: n[1], w: n[2], h: n[3] }
            const px = n[0] * p, py = n[1] * p, pw = n[2] * p, ph = n[3] * p
            // A caret move within the same cell re-emits this with an unchanged
            // rect — skip the setCellCursor re-render + alloc when it hasn't moved.
            if (!lastCellCur || lastCellCur.x !== px || lastCellCur.y !== py || lastCellCur.w !== pw || lastCellCur.h !== ph) {
              perfBump('setCellCursor')
              lastCellCur = { x: px, y: py, w: pw, h: ph }
              setCellCursor(lastCellCur)
            }
          }
          // Trailing col,row (twips payload "x,y,w,h,col,row") → A1 address.
          if (n.length >= 6 && !Number.isNaN(n[4]) && !Number.isNaN(n[5])) {
            setCellAddr(`${colToLetter(n[4])}${n[5] + 1}`)
          }
        }
      } else if (cb.type === CB_GRAPHIC_SELECTION) {
        // payload: "x, y, w, h" twips (selected shape bounds), or "EMPTY" /
        // a zero-size rect on deselect.
        //
        // Selection is drawn by our instant DOM overlay (graphicSel), so the
        // engine's own in-tile selection frame + handles are redundant. The
        // engine bakes those marks into any tile painted while the shape is
        // selected — they can't be suppressed via the LOKit API (proven: neither
        // paintPartTile nor a separate render view omits them). The only lever is
        // WHEN we repaint: a plain select doesn't reflow the document, so we (1)
        // cancel the click's pending settle repaint — which would otherwise bake
        // the marks under our overlay ~220ms later, the laggy "second frame" —
        // and (2) repaint the PREVIOUS selection's region, which clears any marks
        // a prior move/resize settle may have baked there (that shape is now
        // deselected, so it re-renders clean).
        const prev = graphicSelTwRef.current
        const txt = cb.payload.trim()
        const n = txt.split(',').map((s) => parseInt(s.trim(), 10))
        const isSel = txt && txt !== 'EMPTY' && n.length >= 4 && !Number.isNaN(n[0]) && n[2] > 0 && n[3] > 0
        // A shape got SELECTED → the click/keystroke that caused it only moved the
        // selection, nothing reflowed: drop the redundant settle bake. On DESELECT
        // we keep the settle — it's the safe cleanup that repaints away any marks a
        // prior move/resize baked. Guard: while editing text INSIDE a shape, an
        // autogrow fires this same callback and its settle carries the typed glyphs.
        if (isSel && !textEditRef.current) cancelSettleRepaint()
        // Clear stale engine marks a prior move/resize baked at the OLD bounds when
        // the selection jumps straight to a different shape (that shape is now
        // deselected, so it re-renders clean). onMouseDown handles the click-away
        // case; this covers keyboard/programmatic selection changes.
        const PAD = 220 // twips — cover handles that sit just outside the bounds
        if (prev && isSel && (prev.x !== n[0] || prev.y !== n[1] || prev.w !== n[2] || prev.h !== n[3])) {
          scheduleRegionRepaint(prev.x - PAD, prev.y - PAD, prev.w + 2 * PAD, prev.h + 2 * PAD)
        }
        if (!isSel) {
          graphicSelTwRef.current = null
          setGraphicSel(null)
        } else {
          const p = pxPerTwipRef.current
          graphicSelTwRef.current = { x: n[0], y: n[1], w: n[2], h: n[3] }
          setGraphicSel({ x: n[0] * p, y: n[1] * p, w: n[2] * p, h: n[3] * p })
        }
      } else if (cb.type === CB_CELL_FORMULA) {
        // payload: the active cell's content/formula (Calc).
        setCellContent(cb.payload ?? '')
      } else if (cb.type === CB_TEXT_SELECTION) {
        // payload: "x, y, w, h; x, y, w, h; …" twips, or "" / "EMPTY" when none.
        const p = pxPerTwipRef.current
        const txt = cb.payload.trim()
        const rects = !txt || txt === 'EMPTY' ? [] : txt.split(';').map((s) => s.split(',').map((n) => parseInt(n.trim(), 10)))
          .filter((a) => a.length >= 4 && !Number.isNaN(a[0]))
          .map(([x, y, w, h]) => ({ x: x * p, y: y * p, w: w * p, h: h * p }))
        setSelRects(rects)
      } else if (cb.type === CB_STATE_CHANGED) {
        // payload: ".uno:Bold=true" — reflect on ribbon buttons.
        const eq = cb.payload.indexOf('=')
        if (eq > 0 && cb.payload.startsWith('.uno:')) {
          const cmd = cb.payload.slice(0, eq)
          const val = cb.payload.slice(eq + 1)
          // Only allocate a new `active` object (→ Ribbon re-render) when a value
          // actually changed; an identical STATE_CHANGED returns the same identity
          // so React bails out of the render entirely.
          setActive((prev) => {
            if (prev[cmd] === val) return prev
            perfBump('setActive.changed')
            return { ...prev, [cmd]: val }
          })
        }
      } else if (cb.type === CB_CONTEXT_MENU) {
        contextMenuRef.current?.(cb.payload)
      } else if (cb.type === CB_COMMENT) {
        reviewRef.current?.('comment', cb.payload)
      } else if (cb.type === CB_REDLINE_TABLE_SIZE_CHANGED || cb.type === CB_REDLINE_TABLE_ENTRY_MODIFIED) {
        reviewRef.current?.('redline', cb.payload)
      } else if (cb.type === CB_JSDIALOG) {
        jsDialogRef.current?.(cb.payload)
      } else if (cb.type === CB_CELL_SELECTION_AREA) {
        // payload: "x, y, w, h" twips of the marked range, or "EMPTY".
        const txt = cb.payload.trim()
        const n = txt.split(',').map((s) => parseInt(s.trim(), 10))
        if (!txt || txt === 'EMPTY' || n.length < 4 || Number.isNaN(n[0]) || n[2] <= 0 || n[3] <= 0) setCellSelArea?.(null)
        else { const p = pxPerTwipRef.current; setCellSelArea?.({ x: n[0] * p, y: n[1] * p, w: n[2] * p, h: n[3] * p }) }
      } else if (cb.type === CB_TABLE_SELECTED) {
        tableSelectedRef.current?.(cb.payload)
      } else if (cb.type === 12 || cb.type === 15) {
        searchRef.current?.(cb.type === 15, cb.payload)
      } else if (cb.type === CB_CONTEXT_CHANGED) {
        contextChangedRef.current?.(cb.payload)
      } else if (cb.type === CB_WINDOW) {
        // A LibreOffice dialog opened — show it as an overlay (Phase F).
        let p: Record<string, string>
        try { p = JSON.parse(cb.payload) } catch { return }
        if (p.action === 'created' && p.type === 'dialog') {
          const [dw, dh] = (p.size ?? '400, 300').split(',').map((n) => parseInt(n.trim(), 10))
          setDialog({ id: Number(p.id), title: p.title ?? 'Dialog', w: dw || 400, h: dh || 300 })
        }
      }
    })
    return () => {
      off()
      if (dirtyRafRef.current != null) { cancelAnimationFrame(dirtyRafRef.current); dirtyRafRef.current = null }
      dirtyRectRef.current = null
    }
  }, [scheduleRepaint, scheduleRegionRepaint, cancelSettleRepaint])
}
