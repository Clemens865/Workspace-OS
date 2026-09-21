import { useCallback, useRef } from 'react'
import { parseSiblingRects, snapRect, type Guide } from './smartGuides'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { captureGhost, chooseSettlePlan, type DragGhost } from './dragGhost'

type Rect = { x: number; y: number; w: number; h: number }
type PenPt = { tx: number; ty: number }

// com.sun.star.awt.Key codes for non-printable keys.
const KEY: Record<string, { char: number; code: number }> = {
  Backspace: { char: 8, code: 1283 },
  Enter: { char: 13, code: 1280 },
  Tab: { char: 9, code: 1282 },
  Delete: { char: 0, code: 1286 },
  ArrowLeft: { char: 0, code: 1026 },
  ArrowRight: { char: 0, code: 1027 },
  ArrowUp: { char: 0, code: 1025 },
  ArrowDown: { char: 0, code: 1024 },
  Home: { char: 0, code: 1028 },
  End: { char: 0, code: 1029 },
  Escape: { char: 0, code: 1281 },
}

/** Twips → UNO 1/100 mm (the unit every shape geometry macro speaks).
 *  1 inch = 1440 twips = 2540 hundredths of a mm. Exported for the unit test:
 *  the real-engine e2e drives the macros in 1/100 mm directly, so a wrong ratio
 *  here would land shapes in the wrong place with every engine test still green. */
export function tw2mm(t: number): number {
  return Math.round((t * 2540) / 1440)
}

/** Minimum gap between MOUSEMOVEs forwarded during a text-selection drag. The
 *  engine is single-threaded; a per-frame move backlogs it for tens of seconds
 *  on a real deck, and the highlight is a DOM overlay that doesn't need them. */
const TEXT_DRAG_MOVE_MS = 100

/** Hard ceiling on how long the drag ghost may stay up waiting for the settle
 *  repaint. Generous next to the ~300ms a real deck costs, but bounded: a stuck
 *  opaque preview over the slide is worse than a late repaint. */
const GHOST_MAX_MS = 2000

/** Scales a rect (twips) by a handle drag: 'se' grows right/down, 'nw' moves
 *  the origin, edge handles resize one axis. Clamped to a minimum size.
 *  Exported for the unit test — its x/y output is what the model-API commit
 *  turns into the shape's origin shift. */
export function resizeRectBy(
  o: { x: number; y: number; w: number; h: number },
  handle: string,
  dx: number,
  dy: number,
): { x: number; y: number; w: number; h: number } {
  let { x, y, w, h } = o
  if (handle.includes('e')) w += dx
  if (handle.includes('s')) h += dy
  if (handle.includes('w')) { x += dx; w -= dx }
  if (handle.includes('n')) { y += dy; h -= dy }
  if (w < 100) w = 100
  if (h < 100) h = 100
  return { x, y, w, h }
}

interface UseLokInputArgs {
  canvasRef: MutableRefObject<HTMLCanvasElement | null>
  docWrapRef: MutableRefObject<HTMLDivElement | null>
  docRef: MutableRefObject<{ w: number; h: number } | null>
  textEditRef: MutableRefObject<boolean>
  /** True when the open document is a spreadsheet — Delete-key semantics differ. */
  isCalcRef: MutableRefObject<boolean>
  /** The Calc scroll container (.calcGrid) — the viewport edge auto-scroll acts on. */
  scrollElRef?: MutableRefObject<HTMLElement | null>
  /** Re-window the Calc canvas (throttled) so auto-scrolled rows render. */
  scheduleWindowRepaint?: (ms?: number) => void
  graphicSelTwRef: MutableRefObject<Rect | null>
  pxPerTwipRef: MutableRefObject<number>
  /** Where the last button press landed (twips) — a menu pick acts there. */
  lastPointerTwRef?: MutableRefObject<{ x: number; y: number } | null>
  penModeRef: MutableRefObject<boolean>
  penPtsRef: MutableRefObject<PenPt[]>
  finishPenRef: MutableRefObject<() => Promise<void>>
  setGraphicSel: Dispatch<SetStateAction<Rect | null>>
  /** Smart guides shown while a shape is dragged (document twips). */
  setGuides?: Dispatch<SetStateAction<Guide[]>>
  setPenPts: Dispatch<SetStateAction<PenPt[]>>
  setPenMode: Dispatch<SetStateAction<boolean>>
  setDirty: Dispatch<SetStateAction<boolean>>
  /** The shape's own pixels, flown with the pointer and held at the drop point
   *  until the engine repaint lands (see dragGhost.ts). */
  setDragGhost: Dispatch<SetStateAction<DragGhost | null>>
  scheduleRepaint: () => void
  scheduleFullPaint: (delay?: number) => void
  scheduleRegionRepaint: (x: number, y: number, w: number, h: number) => void
  /** Awaitable region paint — the ghost clears on its resolution, not a timer. */
  paintRegion: (x: number, y: number, w: number, h: number) => Promise<void>
  doSave: () => Promise<void>
  runUno: (command: string) => void
}

interface LokInputHandlers {
  onKeyDown: (e: React.KeyboardEvent) => void
  onMouseDown: (e: React.MouseEvent) => void
  onMouseMove: (e: React.MouseEvent) => void
  onMouseUp: (e: React.MouseEvent) => void
  /** Right-click → the engine (true when the point was on the document). */
  onContextMenuEvent: (e: React.MouseEvent) => boolean
}

/**
 * Pointer + keyboard input for the LOK renderer: forwards keystrokes/clicks/drags
 * to the engine, runs the pen tool, and drives the optimistic shape move/resize
 * overlay (armed on mousedown, follows the pointer, settles one region paint on
 * drop). Extracted verbatim from LokRenderer — the private drag refs (dragging,
 * shapeMove, shapeResize, pendingMove, moveRaf) live here since nothing else
 * touched them, and every handler keeps its original deps array + semantics.
 */
export function useLokInput({
  canvasRef,
  docWrapRef,
  docRef,
  textEditRef,
  isCalcRef,
  graphicSelTwRef,
  pxPerTwipRef,
  lastPointerTwRef,
  penModeRef,
  penPtsRef,
  finishPenRef,
  setGraphicSel,
  setGuides,
  setPenPts,
  setPenMode,
  setDirty,
  setDragGhost,
  scheduleRepaint,
  scheduleFullPaint,
  scheduleRegionRepaint,
  paintRegion,
  scrollElRef,
  scheduleWindowRepaint,
  doSave,
  runUno,
}: UseLokInputArgs): LokInputHandlers {
  const draggingRef = useRef(false)
  // Shape-move drag: armed on mousedown inside the selected shape; the overlay
  // follows the pointer optimistically and pixels settle with one paint on drop.
  const shapeMoveRef = useRef<{ sx: number; sy: number; orig: Rect; moved: boolean; snapped?: Rect } | null>(null)
  // Sibling shape boxes read once per drag (WosShapeRects) for smart guides.
  const siblingsRef = useRef<Rect[]>([])
  // Shape-resize drag: armed on mousedown in a handle zone of the selected
  // shape; the overlay scales with the pointer while the engine's own handle
  // drag performs the actual resize underneath.
  const shapeResizeRef = useRef<{ handle: string; sx: number; sy: number; orig: Rect; moved: boolean } | null>(null)
  // Time throttle for engine mousemove forwarding during a text-selection drag.
  const lastMoveSentRef = useRef(0)
  // Pixels copied off the canvas when a shape drag arms, reused for every frame
  // of that drag. Captured on mousedown (before anything moves) rather than on
  // first movement, so the copy is of the shape at rest.
  const ghostBmpRef = useRef<HTMLCanvasElement | null>(null)

  /** Copy the selected shape's pixels so the drag can fly a real preview. */
  const armGhost = useCallback((g: Rect) => {
    const canvas = canvasRef.current
    if (!canvas) { ghostBmpRef.current = null; return }
    const p = pxPerTwipRef.current
    ghostBmpRef.current = captureGhost(
      canvas,
      { x: g.x * p, y: g.y * p, w: g.w * p, h: g.h * p },
      window.devicePixelRatio || 1,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Show the ghost at a twips rect (converted to the overlay's CSS px). */
  const showGhost = useCallback((r: Rect, committed: boolean) => {
    const bmp = ghostBmpRef.current
    if (!bmp) return
    const p = pxPerTwipRef.current
    setDragGhost({ canvas: bmp, x: r.x * p, y: r.y * p, w: r.w * p, h: r.h * p, committed })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- input ----
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Pen tool: Enter closes the polygon, Escape cancels it.
    if (penModeRef.current) {
      if (e.key === 'Enter') { e.preventDefault(); void finishPenRef.current(); return }
      if (e.key === 'Escape') { e.preventDefault(); penPtsRef.current = []; setPenPts([]); setPenMode(false); return }
    }
    if (e.metaKey || e.ctrlKey) {
      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        void doSave()
      } else if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        runUno('.uno:Undo')
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault()
        runUno('.uno:Redo')
      } else if (k === 'a') {
        e.preventDefault()
        runUno('.uno:SelectAll')
      } else if (k === 'c') {
        e.preventDefault()
        runUno('.uno:Copy')
      } else if (k === 'v') {
        e.preventDefault()
        runUno('.uno:Paste')
      } else if (k === 'x') {
        e.preventDefault()
        runUno('.uno:Cut')
      }
      return // let other shortcuts pass; don't inject as text
    }
    e.preventDefault()
    /**
     * Delete/Backspace on a SELECTED (non-editing) Calc cell clears it directly.
     *
     * The Mac's delete key sends Backspace, and Calc's Backspace opens the
     * "Delete Contents" dialog — which can never render in this headless
     * setup, so the key silently did nothing and the cell looked immortal
     * until you double-clicked into edit mode. `.uno:ClearContents` is the
     * dialog-free clear, verified against the real engine (paste → clear →
     * empty). While EDITING a cell the engine owns the key, deleting one
     * character, as it should.
     */
    if (isCalcRef.current && !textEditRef.current && (e.key === 'Delete' || e.key === 'Backspace')) {
      runUno('.uno:ClearContents')
      return
    }
    const special = KEY[e.key]
    if (e.key === 'Escape') { graphicSelTwRef.current = null; setGraphicSel(null) } // deselect clears the overlay
    if (special) {
      // Shift extends the selection (LOK shift modifier = 0x1000 on the key code).
      const code = e.shiftKey ? special.code | 0x1000 : special.code
      void window.workspace.lok.key(0, special.char, code)
      void window.workspace.lok.key(1, special.char, code)
      if (e.shiftKey) scheduleFullPaint(40) // selection spans tiles
      else { setDirty(true); scheduleRepaint() }
    } else if (e.key.length === 1) {
      const cc = e.key.charCodeAt(0)
      void window.workspace.lok.key(0, cc, 0)
      void window.workspace.lok.key(1, cc, 0)
      setDirty(true)
      scheduleRepaint()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Convert a viewport point (clientX/Y) to document twips.
  //
  // Mapped relative to docWrap, NOT the canvas. docWrap is the doc-coordinate
  // element (doc-sized, at the document origin); its bounding rect already
  // carries the scroll offset, so this is scroll-correct. For Writer/Impress
  // the canvas fills docWrap, so the two are identical — but for Calc the
  // canvas is only a viewport WINDOW translated to the scroll origin, and
  // mapping to it would place every click at the window's local offset instead
  // of the true cell. docWrap is right for all three. Taking raw client coords
  // (not a React event) lets the auto-scroll loop reuse it with the last
  // pointer while content scrolls under a stationary cursor.
  const twipsAt = useCallback((clientX: number, clientY: number) => {
    const host = docWrapRef.current
    if (!host) return null
    const rect = host.getBoundingClientRect()
    const p = pxPerTwipRef.current
    return { x: Math.round((clientX - rect.left) / p), y: Math.round((clientY - rect.top) / p) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const evToTwips = useCallback((e: React.MouseEvent) => twipsAt(e.clientX, e.clientY), [twipsAt])

  // ── Edge auto-scroll during a cell-selection drag ──────────────────────────
  // A plain scroll container does not scroll when you drag a held button to its
  // edge, so drag-selecting past the fold was impossible (worse once the canvas
  // only paints the visible window — the rows below weren't even rendered). Every
  // spreadsheet solves this the same way: while dragging near the viewport edge,
  // scroll toward it, keep forwarding the pointer so the engine extends the
  // selection, and repaint the newly-exposed rows.
  //
  // The loop runs CONTINUOUSLY for the whole drag and reads the LIVE pointer each
  // tick — it does not start/stop as the pointer crosses the edge zone. An
  // earlier version stopped itself the moment the pointer left the 32px zone and
  // relied on a fresh mousemove to restart; holding still just outside the zone,
  // or a re-window transiently misreading the scroll range, then wedged it (the
  // "gets stuck" report). A single always-on loop that simply idles when the
  // pointer isn't near an edge cannot get stuck.
  const cellDragRef = useRef(false)                 // a plain cell-selection drag is live
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const autoScrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopAutoScroll = useCallback(() => {
    if (autoScrollTimerRef.current) { clearInterval(autoScrollTimerRef.current); autoScrollTimerRef.current = null }
  }, [])

  /** Scroll velocity (px/tick) from how far the live pointer sits INTO an edge. */
  const edgeVelocity = useCallback((scroller: HTMLElement, ptr: { x: number; y: number }): { dx: number; dy: number } => {
    const EDGE = 40       // px from the visible edge where auto-scroll kicks in
    const MAX_STEP = 56   // px per tick at full overshoot
    const r = scroller.getBoundingClientRect()
    // The edge is the VISIBLE edge: clamp the scroller's rect to the window, so a
    // grid taller/wider than the window still auto-scrolls at the window edge
    // (where the cursor can actually reach) rather than a layout edge off-screen.
    const edgeBottom = Math.min(r.bottom, window.innerHeight)
    const edgeTop = Math.max(r.top, 0)
    const edgeRight = Math.min(r.right, window.innerWidth)
    const edgeLeft = Math.max(r.left, 0)
    // Distance INTO the zone (positive = scroll that way). Past the edge entirely
    // (pointer dragged beyond the window) keeps full speed rather than cutting out.
    const step = (over: number): number => Math.min(MAX_STEP, Math.max(6, Math.round((over / EDGE) * MAX_STEP)))
    let dy = 0, dx = 0
    if (ptr.y > edgeBottom - EDGE) dy = step(ptr.y - (edgeBottom - EDGE))
    else if (ptr.y < edgeTop + EDGE) dy = -step((edgeTop + EDGE) - ptr.y)
    if (ptr.x > edgeRight - EDGE) dx = step(ptr.x - (edgeRight - EDGE))
    else if (ptr.x < edgeLeft + EDGE) dx = -step((edgeLeft + EDGE) - ptr.x)
    return { dx, dy }
  }, [])

  /** Ensure the always-on drag loop is running (started once per cell drag). */
  const ensureAutoScroll = useCallback(() => {
    if (autoScrollTimerRef.current) return
    autoScrollTimerRef.current = setInterval(() => {
      const s = scrollElRef?.current
      const p = lastPointerRef.current
      if (!cellDragRef.current || !s || !p) { stopAutoScroll(); return } // drag ended
      const { dx, dy } = edgeVelocity(s, p)
      if (dx === 0 && dy === 0) return // pointer not near an edge — idle, stay alive
      // Clamp to the STABLE scroll range; never read scrollTop back to decide
      // "done" (this CSS-grid container leaves it stale until layout flushes, so
      // the scroll still accumulates tick to tick). scrollTo/'instant' overrides
      // any CSS scroll-behavior that would otherwise animate and stall it.
      const maxY = Math.max(0, s.scrollHeight - s.clientHeight)
      const maxX = Math.max(0, s.scrollWidth - s.clientWidth)
      s.scrollTo({
        top: Math.max(0, Math.min(maxY, s.scrollTop + dy)),
        left: Math.max(0, Math.min(maxX, s.scrollLeft + dx)),
        behavior: 'instant' as ScrollBehavior,
      })
      // Cursor is stationary at the edge while content scrolled → this maps to a
      // further cell; forward it so the engine extends the selection.
      const t = twipsAt(p.x, p.y)
      if (t) void window.workspace.lok.mouse({ type: 2, x: t.x, y: t.y, count: 1, buttons: 1, modifier: 0 })
      scheduleWindowRepaint?.() // throttled inside (~60ms) so it never starves the loop
    }, 30)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twipsAt, edgeVelocity, stopAutoScroll, scheduleWindowRepaint])

  // Click places the cursor / selects a cell; drag selects a range; double-click
  // selects a word. Proper down → move → up sequence.
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    docWrapRef.current?.focus()
    const t = evToTwips(e)
    if (!t) return
    if (lastPointerTwRef) lastPointerTwRef.current = { x: t.x, y: t.y }
    // Pen tool: clicks add vertices (not engine input). Clicking near the first
    // point (with ≥3 points) closes the polygon.
    if (penModeRef.current) {
      const pts = penPtsRef.current
      if (pts.length >= 3 && Math.hypot(t.x - pts[0].tx, t.y - pts[0].ty) < 400) { void finishPenRef.current(); return }
      penPtsRef.current = [...pts, { tx: t.x, ty: t.y }]
      setPenPts(penPtsRef.current)
      return
    }
    draggingRef.current = true
    const count = e.detail >= 2 ? 2 : 1
    // LOK mouse modifier (vcl KEY_SHIFT = 0x1000, as LOOL sends): shift-click
    // extends the selection (multi-select).
    const mod = e.shiftKey ? 0x1000 : 0
    // Clicking outside the selected shape (beyond a handle-grab margin) deselects
    // — clear the overlay now; the engine re-emits GRAPHIC_SELECTION if the click
    // landed on another shape. Clicking in a handle zone arms a shape RESIZE
    // overlay; clicking inside arms a shape MOVE: the overlay follows the pointer
    // optimistically (PowerPoint feel) and the geometry is committed through the
    // model API on release. Shift-clicks do neither — they add to the selection.
    const g = graphicSelTwRef.current
    if (g && !e.shiftKey) {
      const m = 200 // twips ≈ handle grab zone
      const inside = t.x >= g.x - m && t.x <= g.x + g.w + m && t.y >= g.y - m && t.y <= g.y + g.h + m
      // Clicking away deselects: drop the overlay now, and repaint the old shape's
      // region so any engine selection frame a prior move/resize baked into those
      // tiles is cleared (the shape re-renders deselected = clean). Without this,
      // the cancelled settle repaint could leave a stale gray frame behind.
      if (!inside) {
        graphicSelTwRef.current = null; setGraphicSel(null)
        const PAD = 220
        scheduleRegionRepaint(g.x - PAD, g.y - PAD, g.w + 2 * PAD, g.h + 2 * PAD)
      }
      // Arm the optimistic move/resize overlay. In text-edit mode the gesture
      // splits the way PowerPoint splits it: dragging the FRAME (the border
      // band, or a handle) moves/resizes the box, dragging the text INTERIOR
      // selects text. Without that split every drag inside a text box became a
      // text selection and the box could not be moved at all.
      else if (count === 1) {
        // Handle-zone hit test: the 8 resize handles (corners + edge midpoints).
        const xs = { w: g.x, c: g.x + g.w / 2, e: g.x + g.w }
        const ys = { n: g.y, m: g.y + g.h / 2, s: g.y + g.h }
        const handles: [string, number, number][] = [
          ['nw', xs.w, ys.n], ['n', xs.c, ys.n], ['ne', xs.e, ys.n],
          ['w', xs.w, ys.m], ['e', xs.e, ys.m],
          ['sw', xs.w, ys.s], ['s', xs.c, ys.s], ['se', xs.e, ys.s],
        ]
        const hit = handles.find(([, hx, hy]) => Math.abs(t.x - hx) <= m && Math.abs(t.y - hy) <= m)
        // The text interior = inside the bounds, clear of the border band. On a
        // box narrower than two margins it's empty, so a small shape always moves.
        const interior =
          t.x > g.x + m && t.x < g.x + g.w - m && t.y > g.y + m && t.y < g.y + g.h - m
        if (hit) {
          shapeResizeRef.current = { handle: hit[0], sx: t.x, sy: t.y, orig: { ...g }, moved: false }
          armGhost(g)
        } else if (!textEditRef.current || !interior) {
          // Grabbing the frame while the caret is in the box means "move the
          // box", so leave text-edit first (Escape → object selection). The
          // geometry macros read CurrentController.Selection, which is a text
          // range — not a shape — while text editing is active.
          if (textEditRef.current) {
            const esc = KEY.Escape
            void window.workspace.lok.key(0, esc.char, esc.code)
            void window.workspace.lok.key(1, esc.char, esc.code)
            textEditRef.current = false
          }
          shapeMoveRef.current = { sx: t.x, sy: t.y, orig: { ...g }, moved: false }
          armGhost(g)
        }
        if (shapeMoveRef.current && setGuides) {
          siblingsRef.current = []
          void window.workspace.lok.officeMacro('WosShapeRects', '').then((r) => { siblingsRef.current = parseSiblingRects(r.raw) }).catch(() => { /* no guides */ })
        }
        // else: caret is in the text body — the engine owns this drag.
      }
    }
    void window.workspace.lok.mouse({ type: 0, x: t.x, y: t.y, count, buttons: 1, modifier: mod }) // BUTTONDOWN
    if (count === 2) scheduleFullPaint(40) // word selection highlight
    // A plain cell-selection drag (Calc, no shape armed) is eligible for edge
    // auto-scroll. Start the always-on loop now; it idles until the pointer
    // nears an edge and is cleared on mouseup.
    cellDragRef.current = isCalcRef.current && !shapeMoveRef.current && !shapeResizeRef.current
    lastPointerRef.current = { x: e.clientX, y: e.clientY }
    if (cellDragRef.current) ensureAutoScroll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evToTwips])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingRef.current) return
    lastPointerRef.current = { x: e.clientX, y: e.clientY }
    const t = evToTwips(e)
    if (!t) return
    const rz = shapeResizeRef.current
    const mv = shapeMoveRef.current
    if (rz) {
      // Shape resize: scale the overlay with the drag. The engine sees nothing
      // until release, when WosShapeSize applies the real geometry.
      const dx = t.x - rz.sx, dy = t.y - rz.sy
      if (!rz.moved && Math.hypot(dx, dy) > 60) rz.moved = true
      if (rz.moved) {
        const r = resizeRectBy(rz.orig, rz.handle, dx, dy)
        const p = pxPerTwipRef.current
        setGraphicSel({ x: r.x * p, y: r.y * p, w: r.w * p, h: r.h * p })
        showGhost(r, false) // the copied pixels stretch with the handle
      }
    } else if (mv) {
      // Shape move: slide the overlay locally for instant feedback. Nothing
      // reaches the engine mid-drag, so a drag costs the engine nothing; the
      // canvas repaints ONCE on drop, after WosShapeMove lands the position.
      const dx = t.x - mv.sx, dy = t.y - mv.sy
      if (!mv.moved && Math.hypot(dx, dy) > 60) mv.moved = true
      if (mv.moved) {
        const p = pxPerTwipRef.current
        const raw = { x: mv.orig.x + dx, y: mv.orig.y + dy, w: mv.orig.w, h: mv.orig.h }
        // Smart guides: snap to sibling edges/centres and the page (8 px tolerance).
        const snap = setGuides && !e.altKey ? snapRect(raw, siblingsRef.current, docRef.current, 8 / p) : { rect: raw, guides: [] }
        mv.snapped = snap.rect
        setGuides?.(snap.guides)
        setGraphicSel({ x: snap.rect.x * p, y: snap.rect.y * p, w: snap.rect.w * p, h: snap.rect.h * p })
        showGhost(snap.rect, false)
      }
    } else {
      // Plain text-selection drag — the engine owns it. Both halves of what this
      // used to do per frame were engine floods: a MOUSEMOVE every rAF, plus a
      // repaint of the whole visible region every rAF. On a real deck that
      // backlogged the single thread for ~20s. Now the moves are throttled to
      // TEXT_DRAG_MOVE_MS and NOTHING is repainted here — the highlight is the
      // CB_TEXT_SELECTION selRects DOM overlay, which never needed tiles. The
      // final endpoint still lands exactly, because BUTTONUP carries it.
      const now = performance.now()
      if (now - lastMoveSentRef.current >= TEXT_DRAG_MOVE_MS) {
        lastMoveSentRef.current = now
        void window.workspace.lok.mouse({ type: 2, x: t.x, y: t.y, count: 1, buttons: 1, modifier: e.shiftKey ? 0x1000 : 0 }) // MOUSEMOVE
      }
      // The always-on auto-scroll loop reads lastPointerRef (updated at the top
      // of this handler) each tick — no per-move start/stop needed.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evToTwips])

  // The document region currently VISIBLE on screen, in twips. Derived from the
  // canvas's scroll container (.pages / .pagesImpress, overflow:auto): the part
  // of the canvas inside the scroll viewport is all the user can actually see.
  // Used to bound the shape-drag settle so a far drag never fetches off-screen
  // tiles. Returns null if the geometry is unavailable (→ caller keeps its rect).
  const visibleDocRect = useCallback((): Rect | null => {
    const canvas = canvasRef.current
    const doc = docRef.current
    if (!canvas || !doc) return null
    // Nearest scrollable ancestor (the doc surface scroller).
    let scroller: HTMLElement | null = canvas.parentElement
    while (scroller && scroller.scrollHeight <= scroller.clientHeight && scroller.scrollWidth <= scroller.clientWidth) {
      scroller = scroller.parentElement
    }
    const p = pxPerTwipRef.current
    if (!p) return null
    const cr = canvas.getBoundingClientRect()
    const vr = (scroller ?? canvas).getBoundingClientRect()
    // Intersection of the canvas and the viewport, in CSS px relative to the canvas.
    const left = Math.max(cr.left, vr.left) - cr.left
    const top = Math.max(cr.top, vr.top) - cr.top
    const right = Math.min(cr.right, vr.right) - cr.left
    const bottom = Math.min(cr.bottom, vr.bottom) - cr.top
    if (right <= left || bottom <= top) return null
    return { x: left / p, y: top / p, w: (right - left) / p, h: (bottom - top) / p }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Settle pixels after a shape move/resize commit by repainting only the UNION
  // of the shape's OLD and NEW bounds (a few tiles) instead of the whole 15-tile
  // canvas. A short 30ms delay lets the engine finish applying the move so the
  // fetched tiles reflect the new position; scheduleRegionRepaint then coalesces
  // it onto the next frame.
  //
  // A far (corner-to-corner) drag makes that union span most of the slide — the
  // old code escalated to a FULL paint there, which is exactly the ~120ms pause
  // this pass exists to avoid. Instead we CLAMP the settle to the visible
  // viewport: everything off-screen is irrelevant to what the user sees, and the
  // engine's GRAPHIC_SELECTION callback already fixed the overlay. So a big drag
  // now costs only the on-screen tiles, never a whole-doc repaint.
  //
  // settleRect computes that clamped rect; settleShapeRegion schedules it (the
  // no-ghost path) and commitShapeGeometry awaits it (the ghost path, which needs
  // to know when the real pixels are down before removing the preview).
  const settleRect = useCallback((oldB: Rect, newB: Rect): Rect | null => {
    const PAD = 220 // twips — cover selection handles just outside the bounds
    let x0 = Math.min(oldB.x, newB.x) - PAD
    let y0 = Math.min(oldB.y, newB.y) - PAD
    let x1 = Math.max(oldB.x + oldB.w, newB.x + newB.w) + PAD
    let y1 = Math.max(oldB.y + oldB.h, newB.y + newB.h) + PAD
    const vis = visibleDocRect()
    if (vis) {
      // Clamp the union to what's actually on screen (never larger than the viewport).
      x0 = Math.max(x0, vis.x)
      y0 = Math.max(y0, vis.y)
      x1 = Math.min(x1, vis.x + vis.w)
      y1 = Math.min(y1, vis.y + vis.h)
    }
    const w = x1 - x0, h = y1 - y0
    if (w <= 0 || h <= 0) return null // nothing on-screen changed
    return { x: x0, y: y0, w, h }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleDocRect])

  const settleShapeRegion = useCallback((oldB: Rect, newB: Rect) => {
    const r = settleRect(oldB, newB)
    if (!r) { scheduleRepaint(); return }
    window.setTimeout(() => scheduleRegionRepaint(r.x, r.y, r.w, r.h), 30)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settleRect, scheduleRegionRepaint, scheduleRepaint])

  // Commit a finished shape drag through the MODEL API and settle the pixels.
  //
  // This is the crux of the interaction layer: the engine is fast at selecting
  // (~1.2ms) and fast at moving a shape via the model API, but driving an edit
  // by replaying mouse events through it is neither reliable nor cheap. So the
  // overlay owns the drag visually and the geometry lands here — WosShapeSize
  // for the new size (which keeps the top-left anchored), then WosShapeMove for
  // however far the top-left itself travelled (a 'nw'/'n'/'w' handle moves the
  // origin as well as the size).
  const commitShapeGeometry = useCallback(async (oldB: Rect, newB: Rect, resized: boolean) => {
    const macro = window.workspace.lok.macro
    let committed = false
    try {
      if (resized && (newB.w !== oldB.w || newB.h !== oldB.h)) {
        await macro('WosShapeSize', `${tw2mm(newB.w)}|${tw2mm(newB.h)}`)
      }
      const dx = newB.x - oldB.x, dy = newB.y - oldB.y
      if (dx !== 0 || dy !== 0) await macro('WosShapeMove', `${tw2mm(dx)}|${tw2mm(dy)}`)
      committed = true
    } catch {
      /* engine re-emits GRAPHIC_SELECTION; the overlay corrects itself */
    }
    // With a ghost on screen we can settle deliberately instead of firing one
    // coalesced repaint and hoping: await the paints, then drop the ghost, so the
    // real pixels are already down when it disappears (no flash of the old state).
    if (ghostBmpRef.current && committed) {
      const settle = async (): Promise<void> => {
        if (chooseSettlePlan(oldB, newB) === 'old-then-new') {
          // Disjoint: erase the vacated spot FIRST so the duplicate image is gone
          // fast (a smaller paint), then bring in the destination.
          const a = settleRect(oldB, oldB)
          const b = settleRect(newB, newB)
          if (a) await paintRegion(a.x, a.y, a.w, a.h)
          if (b) await paintRegion(b.x, b.y, b.w, b.h)
        } else {
          // Overlapping: one union paint is cheaper and looks the same, since the
          // stale pixels sit behind the ghost anyway.
          const u = settleRect(oldB, newB)
          if (u) await paintRegion(u.x, u.y, u.w, u.h)
        }
      }
      try {
        // Watchdog: a wedged engine can leave a tile fetch pending forever, and an
        // un-cleared ghost is an opaque patch stuck over the slide — far worse than
        // a late repaint. Whatever happens, the preview comes down.
        await Promise.race([settle(), new Promise((r) => window.setTimeout(r, GHOST_MAX_MS))])
      } catch {
        /* fall through — the ghost still clears below */
      }
      ghostBmpRef.current = null
      setDragGhost(null)
      return
    }
    ghostBmpRef.current = null
    setDragGhost(null)
    settleShapeRegion(oldB, newB)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settleShapeRegion, settleRect, paintRegion])

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    // End any edge auto-scroll and do one final re-window so the last exposed
    // rows are current before the selection settles.
    cellDragRef.current = false
    stopAutoScroll()
    scheduleWindowRepaint?.(0)
    const t = evToTwips(e)
    const mv = shapeMoveRef.current
    const rz = shapeResizeRef.current
    shapeMoveRef.current = null
    shapeResizeRef.current = null
    const drag = mv?.moved ? mv : rz?.moved ? rz : null
    if (t) {
      const mod = e.shiftKey ? 0x1000 : 0
      // Release the button WHERE IT WENT DOWN after an overlay-driven drag, so
      // the engine reads a click in place: selection kept, geometry untouched,
      // and the model-API commit below is the only thing that moves the shape.
      // Releasing at the drop point instead asks the engine to reconstruct the
      // whole drag from one synthetic move — it doesn't, and the shape snaps
      // back to where it started (the regression this replaces).
      const rel = drag ? { x: drag.sx, y: drag.sy } : t
      const count = drag ? 1 : e.detail >= 2 ? 2 : 1
      void window.workspace.lok.mouse({ type: 1, x: rel.x, y: rel.y, count, buttons: 1, modifier: mod }) // BUTTONUP
    }
    if (rz?.moved && t) {
      // Commit the optimistic overlay size + origin through the model API.
      const nb = resizeRectBy(rz.orig, rz.handle, t.x - rz.sx, t.y - rz.sy)
      graphicSelTwRef.current = nb
      setDirty(true)
      showGhost(nb, true) // hold the destination until the real pixels land
      void commitShapeGeometry(rz.orig, nb, true)
      return
    }
    if (mv?.moved && t) {
      // Commit the optimistic overlay position through the model API (snapped
      // to the smart guides when they matched).
      setGuides?.([])
      const dx = t.x - mv.sx, dy = t.y - mv.sy
      const nb = mv.snapped ?? { x: mv.orig.x + dx, y: mv.orig.y + dy, w: mv.orig.w, h: mv.orig.h }
      graphicSelTwRef.current = nb
      setDirty(true)
      showGhost(nb, true)
      void commitShapeGeometry(mv.orig, nb, false)
      return
    }
    // A click that never became a drag: drop the captured pixels unused.
    ghostBmpRef.current = null
    setDragGhost(null)
    scheduleRepaint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evToTwips, commitShapeGeometry, showGhost])

  /**
   * Right-click: hand it to the engine as a real right button press. The engine
   * moves the cursor / selects what is under the pointer exactly as LibreOffice
   * would, then answers with its context menu for that target
   * (LOK_CALLBACK_CONTEXT_MENU), which LokRenderer renders. Returns false when
   * the point is not on the document.
   */
  const onContextMenuEvent = useCallback((e: React.MouseEvent): boolean => {
    const t = evToTwips(e)
    if (!t) return false
    docWrapRef.current?.focus()
    if (lastPointerTwRef) lastPointerTwRef.current = { x: t.x, y: t.y }
    const RIGHT = 4 // vcl MOUSE_RIGHT
    void window.workspace.lok.mouse({ type: 0, x: t.x, y: t.y, count: 1, buttons: RIGHT, modifier: 0 })
    void window.workspace.lok.mouse({ type: 1, x: t.x, y: t.y, count: 1, buttons: RIGHT, modifier: 0 })
    return true
  }, [evToTwips])

  return { onKeyDown, onMouseDown, onMouseMove, onMouseUp, onContextMenuEvent }
}
