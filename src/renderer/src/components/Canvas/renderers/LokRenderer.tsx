import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useFilePrint } from '../../../hooks/useFilePrint'
import { Ribbon } from './Ribbon'
import { LokDialogs } from './LokDialogs'
import { FindReplaceBar } from './FindReplaceBar'
import type { NumberFormatSpec } from './FormatCellsDialog'
import type { BorderSpec } from './BordersDialog'
import { CalcHeaders, COL_HEADER_H, ROW_HEADER_W } from './CalcHeaders'
import { FormulaBar } from './FormulaBar'
import { SlideRail } from './SlideRail'
import { parseDeckSvg, type DeckSvg } from '../../../lib/svgSlides'
import { vectorizeImageUrl } from '../../../lib/vectorize'
import { bytesToBlob } from '../../../lib/bytesToBlob'
import { SheetTabs } from './SheetTabs'
import { ComponentsPanel, type SelectedInstance } from './ComponentsPanel'
import { MetricsPanel } from './MetricsPanel'
import { PresentMode } from './PresentMode'
import { NotesPane } from './NotesPane'
import { useLokNotes } from './useLokNotes'
import { useLokPaint } from './useLokPaint'
import { useLokActions } from './useLokActions'
import { useLokCallbacks } from './useLokCallbacks'
import { useMetricTransclusion } from './useMetricTransclusion'
import { useRangeTransclusion } from './useRangeTransclusion'
import { RangesSection } from './RangesSection'
import { useCollections } from './useCollections'
import { CollectionsSection } from './CollectionsSection'
import { DPI, TWIPS_PER_INCH } from '../../../lib/lokCanvasUtils'
import { cellRectFromGeometry, toA1 } from '../../../lib/calcCellRect'
import type { Component } from '../../../types/workspace-api'
import type { SheetGeometry } from '../../../types/workspace-api'
import { useLokInput } from './useLokInput'
import { ContextMenu } from './ContextMenu'
import { menuFor, type MenuItem } from './calcMenu'
import { menuFromEngine } from './officeMenu'
import { sheetTabMenu, slideThumbMenu } from './partMenu'
import { MiniToolbar, type MiniContext } from './MiniToolbar'
import { FillHandle } from './FillHandle'
import { JsDialog, type JsDialogEvent } from './JsDialog'
import { ReviewPanel } from './ReviewPanel'
import { AnimationPane } from './AnimationPane'
import { TableGrips } from './TableGrips'
import { SortExpandDialog } from './SortExpandDialog'
import { needsExpandPrompt, parseSortInfo, pickedColumn, plainRange, sortArgs, type SortInfo } from './sortModel'
import { cellCentre } from './tableGripsModel'
import { Ruler } from './Ruler'
import { parseRulerInfo, type RulerInfo } from './rulerModel'
import { OutlineView, PrintPreview, SlideSorter } from './OfficeViews'
import { parseSlideText, slideTextSetArgs, type SlideText } from './slideText'
import type { Guide } from './smartGuides'
import { outlineSizes } from './CalcHeaders'
import { TRANSITIONS, advanceSeconds, orderArgs, parseEffects, parseTransitions, transitionSetArgs, triggerArgs, type AnimEffect, type SlideTransition } from './animationModel'
import { parseComments, parseRedlines, reviewCommands, type Redline, type ReviewComment } from './reviewModel'
import { applyJsDialogMessage, isPopup, parseJsDialogMessage, type JsDialogState } from './jsdialogModel'
import { StatusBar } from './StatusBar'

/** View-mode commands that change the document's laid-out size. */
const MODE_COMMANDS = new Set(['.uno:PrintLayout', '.uno:BrowseView', '.uno:NormalViewMode', '.uno:PagebreakMode', '.uno:NormalMultiPaneGUI', '.uno:NotesMode', '.uno:SlideMasterPage'])
import { NameBox } from './NameBox'
import { RotateHandle } from './RotateHandle'
import { anchoredScroll, useWheelZoom } from './wheelZoom'
import { cellAtTwips } from '../../../lib/calcCellRect'
import { cellAtPoint, parseTableSelected, type TableGeometry } from './tableGeometry'
import { menuStateSnapshot, sameSnapshot, type MenuStateSnapshot } from './officeState'
import { perfBump } from './perfCount'
import type { DragGhost } from './dragGhost'
import styles from './LokRenderer.module.css'

interface LokRendererProps {
  filePath: string
  /** Called when the engine can't load this file (e.g. it hangs on it), so the
   *  parent can fall back to a read-only view. */
  onNativeFail?: () => void
}

/** Ceiling on the first paint after opening a document. Generous — a big deck at
 *  high zoom legitimately takes seconds — but bounded, because the engine's tile
 *  fetches have no timeout of their own and a stalled one otherwise parks the UI
 *  on "Rendering…" forever with nothing logged. */
const FIRST_PAINT_TIMEOUT_MS = 30000

interface Caret {
  x: number
  y: number
  h: number
}

/**
 * Live, editable document via the LibreOfficeKit sidecar (Phase 3a M3). Renders
 * the engine's tiles into a canvas, forwards keyboard/mouse as engine input,
 * runs UNO commands from a toolbar, repaints on the engine's invalidate
 * callbacks, and saves back to the original file.
 */
export function LokRenderer({ filePath, onNativeFail }: LokRendererProps): JSX.Element {
  perfBump('LokRenderer.render') // dev-only; measures re-renders in the responsiveness e2e
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const docWrapRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<{ w: number; h: number } | null>(null) // twips
  const caretTwRef = useRef<{ x: number; y: number } | null>(null) // cursor in twips
  // True while a text caret is active inside a shape (text-edit mode). A drag in
  // this mode is TEXT SELECTION, not a shape move — so the optimistic move/resize
  // overlay must NOT arm (arming it slid the overlay while the engine selected
  // text, leaving two desynced frames). Mirrors caretVisible for the stable
  // mouse handlers to read fresh.
  const textEditRef = useRef(false)
  // Whether this doc is a spreadsheet — read by stable key handlers via ref.
  const isCalcRef = useRef(false)

  const [zoom, setZoom] = useState(1)
  const [pxSize, setPxSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [caret, setCaret] = useState<Caret | null>(null)
  const [caretVisible, setCaretVisible] = useState(false)
  const [selRects, setSelRects] = useState<{ x: number; y: number; w: number; h: number }[]>([])
  // Drag ghost: the selected shape's pixels, lifted off the canvas so a drag
  // shows the shape itself instead of an empty outline, and so the drop looks
  // instant while the engine's ~300ms repaint lands underneath (see dragGhost.ts).
  const [dragGhost, setDragGhost] = useState<DragGhost | null>(null)
  // Calc active-cell box (LOK_CALLBACK_CELL_CURSOR) — the selection outline you
  // see when you click a cell. Tracked in twips so it survives zoom repaints.
  const cellCurTwRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const [cellCursor, setCellCursor] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  // Drawing-object selection box (LOK_CALLBACK_GRAPHIC_SELECTION) — the handles
  // you see when a shape is selected. Tracked in twips so it survives zoom.
  const graphicSelTwRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const [graphicSel, setGraphicSel] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  // Pen tool: when active, canvas clicks add polygon vertices (twips); close by
  // clicking near the first point or pressing Enter, cancel with Escape.
  const [penMode, setPenMode] = useState(false)
  const [penPts, setPenPts] = useState<{ tx: number; ty: number }[]>([])
  // Framer-style components (reusable assets) + the currently-selected instance.
  const [components, setComponents] = useState<Component[]>([])
  const [showComponents, setShowComponents] = useState(false)
  const [selectedInstance, setSelectedInstance] = useState<SelectedInstance | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ id: number; title: string; w: number; h: number } | null>(null)
  const [props, setProps] = useState<{ name: string; bytes: number; modified: number } | null>(null)
  const [showProps, setShowProps] = useState(false)
  const [showInsertTable, setShowInsertTable] = useState(false)
  const [showFormatCells, setShowFormatCells] = useState(false)
  // Right-click menu on the sheet. Calc-only for now: Writer/Impress have their
  // own selection models and deserve their own item sets rather than a shared
  // menu that half-applies.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  // A right-click sent to the engine, waiting for its CONTEXT_MENU answer. The
  // screen point is remembered here so the menu opens where the click was, not
  // where the pointer has drifted to by the time the callback lands.
  const ctxPendingRef = useRef<{ x: number; y: number; at: number } | null>(null)
  const lastMenuStateRef = useRef<MenuStateSnapshot | null>(null)
  // Hidden sheets / slides (index-aligned with parts.names), from the model.
  const [partsVisible, setPartsVisible] = useState<boolean[]>([])
  // Inline rename requests from the tab / thumbnail context menus.
  const [renameSheet, setRenameSheet] = useState<number | null>(null)
  const [renameSlide, setRenameSlide] = useState<number | null>(null)
  // The table under the selection (TABLE_SELECTED edges) and the last press
  // point: together they name the cell a slide-table operation should act on.
  const tableSelRef = useRef<TableGeometry | null>(null)
  const lastPointerTwRef = useRef<{ x: number; y: number } | null>(null)
  // The engine's sidebar context (`swriter Table`, `simpress DrawText`, …) for contextual UI.
  const officeContextRef = useRef('')
  const [officeContext, setOfficeContext] = useState('')
  const [tableSelected, setTableSelected] = useState(false)
  // Impress find/replace goes through .uno:ExecuteSearch; the count arrives as a callback.
  const searchResolveRef = useRef<((n: number) => void) | null>(null)
  // Bumped on every TABLE_SELECTED so the grips follow the engine's geometry.
  const [tableKey, setTableKey] = useState(0)
  const [guides, setGuides] = useState<Guide[]>([])
  // ⌘-wheel zoom: the pointer anchor to honour once the new size is laid out.
  const zoomAnchorRef = useRef<{ oldZoom: number; newZoom: number; px: number; py: number; scrollLeft: number; scrollTop: number } | null>(null)
  // The floating selection toolbar: shown after a selection settles, hidden on
  // the next press or keystroke so it never sits in the way of typing.
  const [miniOn, setMiniOn] = useState(false)
  const pointerDownRef = useRef(false)
  // Engine dialogs as JSON widget trees, by window id. When one of these
  // exists for a window, the bitmap tunnel (DialogOverlay) for that window is
  // not shown — the JSON rendering is ours and complete.
  const [jsDialogs, setJsDialogs] = useState<Record<number, JsDialogState>>({})
  const jsDialogIdsRef = useRef<Set<number>>(new Set())
  // The last WINDOW `created` dialog: a message box's JSON tree has no id of
  // its own, so it borrows this window id (its Enter/Escape go there).
  const lastWindowRef = useRef<{ id: number; at: number } | null>(null)
  // Popups come in groups (a dropdown and its sub-dropdowns); closing one makes
  // the engine re-emit the others, so they are closed together and re-emits
  // are muted for a moment.
  const popupMuteUntilRef = useRef(0)
  // Where the last press landed (client px): popups such as the AutoFilter
  // dropdown open at that point.
  const lastClientRef = useRef<{ x: number; y: number } | null>(null)
  // Status line data (Writer counts come from the model on a short debounce).
  const [docStatus, setDocStatus] = useState<{ page: number; pages: number; words: number; chars: number } | null>(null)
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Review: the engine's comment and tracked-change lists, re-read on its
  // COMMENT / REDLINE callbacks; the panel and the margin anchors show them.
  const [showReview, setShowReview] = useState(false)
  const [comments, setComments] = useState<ReviewComment[]>([])
  const [redlines, setRedlines] = useState<Redline[]>([])
  const [focusComment, setFocusComment] = useState<string | null>(null)
  const reviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Calc: the marked cell range (CELL_SELECTION_AREA), in docWrap px.
  const [cellSelArea, setCellSelArea] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  // Format painter (Pinsel) is a MODE: it arms on click and the NEXT click on a
  // cell applies the copied style. Tracked so the UI can show it armed and
  // disarm afterwards — without that it looks like the button did nothing.
  const [painterArmed, setPainterArmed] = useState(false)
  const [showSpecialChar, setShowSpecialChar] = useState(false)
  const [showHyperlink, setShowHyperlink] = useState(false)
  const [showBorders, setShowBorders] = useState(false)
  const [showCondFormat, setShowCondFormat] = useState(false)
  const [showDataValidation, setShowDataValidation] = useState(false)
  const [showMargins, setShowMargins] = useState(false)
  const [showFind, setShowFind] = useState(false)
  // Multi-part docs: Calc sheets / Impress slides.
  const [parts, setParts] = useState<{ names: string[]; cur: number; type: number }>({ names: [], cur: 0, type: 0 })
  // Live command states from the engine (e.g. {'.uno:Bold':'true'}) for the ribbon.
  const [active, setActive] = useState<Record<string, string>>({})
  // Calc column/row geometry (for the A/B/C · 1/2/3 header strips).
  const [geometry, setGeometry] = useState<SheetGeometry | null>(null)
  const isCalc = parts.type === 1
  // Writer (LOK doctype 0) is the second transclusion surface: metrics live in a
  // real .docx via a tagged content control, mirroring the Calc-cell path.
  const isWriter = parts.type === 0
  // Calc formula bar: active cell address + its content/formula from the engine.
  const [cellAddr, setCellAddr] = useState('')
  const [cellContent, setCellContent] = useState('')
  const isImpress = parts.type === 2
  // Slide thumbnails / present mode.
  const [presenting, setPresenting] = useState(false)
  // Speaker-notes pane (Impress only) — toggled from the View tab.
  const [showNotes, setShowNotes] = useState(false)
  const [thumbsKey, setThumbsKey] = useState(0)
  // Vector deck (Impress) — the whole presentation as one SVG, re-fetched after
  // edits, split into crisp per-slide thumbnails. null → bitmap-tile fallback.
  const [deck, setDeck] = useState<DeckSvg | null>(null)

  // Paint pipeline: tile fetch/blit, full/region/cursor repaints, render-token
  // supersession, offscreen buffer and the debounced repaint timers.
  // The scroll containers: .calcGrid for Calc, .pages for Writer. scrollHostRef
  // mirrors whichever is active — the paint window and edge auto-scroll read it.
  const calcGridRef = useRef<HTMLDivElement | null>(null)
  const pagesElRef = useRef<HTMLDivElement | null>(null)
  const scrollHostRef = useRef<HTMLElement | null>(null)
  // Calc AND Writer window their paint to the viewport; Impress paints the
  // (bounded) slide in full — its layout is deliberately untouched.
  const windowedRef = useRef(false)
  // The current sheet/slide — keys the tile cache. Kept imperative (not state)
  // because goToPart paints BEFORE React re-renders the new parts.cur.
  const partRef = useRef(0)
  const { paint, paintRegion, scheduleRepaint, scheduleFullPaint, scheduleRegionRepaint, scheduleWindowRepaint, evictTiles, evictTilePart, clearTileCache, cancelSettleRepaint, pxPerTwipRef, zoomRef, dirtyRectRef, dirtyRafRef } =
    useLokPaint({ canvasRef, docRef, caretTwRef, setPxSize, setThumbsKey, windowedRef, scrollElRef: scrollHostRef, partRef })

  // Pull fresh column/row geometry from the engine (after open, edits, resize).
  // Debounced (~100ms): header drag and sheet switches fire this rapidly, and
  // each read is a synchronous IPC round-trip — coalesce a burst into one read.
  const geomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshGeometry = useCallback(async () => {
    if (geomTimerRef.current) clearTimeout(geomTimerRef.current)
    geomTimerRef.current = setTimeout(() => {
      geomTimerRef.current = null
      void (async () => {
        try {
          const g = (await window.workspace.lok.sheetGeometry()) as SheetGeometry | null
          setGeometry(g)
        } catch { /* non-Calc or unavailable */ }
      })()
    }, 100)
  }, [])

  // Engine document/shape/component actions (slide & sheet ops, Impress shape
  // macros, component library, part navigation, Calc header resize).
  const {
    doSlideOp, reorderSlide, sheetOp, tableOp, slideTableOp, slideTableCellFmt, layoutOp, slideLayout,
    shapeInsert, shapeColor, slideBg, shapeText, shapeEffect, arrange, shapePattern, shapeStroke, chartInsert, condFormat, dataValidation,
    reloadComponents, insertComponent, updateInstance, saveComponent, deleteComponent, captureSelection,
    goToPart, resizeHeader, sheetOpAt, slideOp, refreshPartInfo,
  } = useLokActions({
    paint, scheduleRepaint, docRef, partRef, graphicSelTwRef,
    setDirty, setParts, setThumbsKey, setPartsVisible, pxPerTwipRef, setCaret, setGraphicSel,
    components, setComponents, selectedInstance, setSelectedInstance,
    isCalc, isImpress, refreshGeometry, partsCur: parts.cur,
  })

  // Speaker notes (Impress): current slide's notes + load/save wiring.
  const { notes, commitNotes } = useLokNotes({ isImpress, visible: showNotes, slide: parts.cur, setDirty })

  // Open + initial render when the file changes.
  useEffect(() => {
    let cancelled = false
    setError(null)
    setLoading(true)
    setDirty(false)
    setCaret(null)
    setCaretVisible(false)
    textEditRef.current = false
    setSelRects([])
    cellCurTwRef.current = null
    setCellCursor(null)
    graphicSelTwRef.current = null
    setGraphicSel(null)
    setGeometry(null)
    tableSelRef.current = null
    setTableSelected(false)
    setGuides([])
    ;(async () => {
      const rawOpen = (): ReturnType<typeof window.workspace.lok.open> => window.workspace.lok.open(filePath)
      try {
        let info: Awaited<ReturnType<typeof rawOpen>> | null = null
        let firstErr: unknown = null
        try { info = await rawOpen() } catch (e) { firstErr = e }
        // Retry once ONLY for a transient (the watchdog respawned the engine).
        // A timeout means the engine HANGS on this file — retrying just hangs
        // again (doubling the wait), so fail fast instead.
        const timedOut = (e: unknown): boolean => /timed out/i.test(String((e as Error)?.message ?? e ?? ''))
        if ((!info || !info.ok) && !cancelled && !timedOut(firstErr)) {
          await new Promise((r) => setTimeout(r, 400))
          try { info = await rawOpen() } catch (e) { firstErr = e }
        }
        if (cancelled) return
        if (!info || !info.ok || !info.w || !info.h) {
          throw new Error(timedOut(firstErr) || timedOut(info?.err)
            ? 'The engine timed out opening this file — it may contain content it can’t render.'
            : ((firstErr as Error)?.message ?? info?.err ?? 'open failed'))
        }
        docRef.current = { w: info.w, h: info.h }
        setParts({ names: info.names ?? [], cur: info.cur ?? 0, type: info.type ?? 0 })
        partRef.current = info.cur ?? 0
        // A different document: nothing cached applies.
        clearTileCache()
        // Windowed paint for the unbounded surfaces, set BEFORE the first paint.
        windowedRef.current = info.type === 1 || info.type === 0
        // Bound the first paint. `paint()` awaits engine tile fetches that have
        // no timeout of their own, so if the engine stops answering, this await
        // never settles — leaving the user on "Rendering…" indefinitely with no
        // error, nothing logged, and nothing to diagnose. That silent-hang mode
        // cost a long debugging session; failing loudly is strictly better than
        // hanging quietly. The bound is deliberately generous — a large deck at
        // high zoom can legitimately take seconds.
        await Promise.race([
          paint(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('FIRST_PAINT_TIMEOUT')), FIRST_PAINT_TIMEOUT_MS)),
        ])
        if (info.type === 1) void refreshGeometry()
        if (!cancelled) setLoading(false)
      } catch (e) {
        if (!cancelled) {
          const msg = (e as Error).message
          if (msg === 'FIRST_PAINT_TIMEOUT') {
            // The document opened but its tiles never arrived. Say so plainly —
            // this used to present as a permanent "Rendering…" with no clue.
            console.error(`[lok] first paint timed out after ${FIRST_PAINT_TIMEOUT_MS}ms for ${filePath}`)
            setError('The document opened but the engine stopped sending its rendering. Close and reopen the file.')
          }
          // If the engine couldn't load this file (timed out), hand off to the
          // read-only PDF fallback instead of showing an error.
          else if (onNativeFail && /timed out/i.test(msg)) onNativeFail()
          else setError(msg)
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])

  // Keep textEditRef mirroring caretVisible. A shape drag arms the optimistic
  // move/resize overlay only when NOT in text-edit mode (a caret inside a shape
  // means a drag is TEXT SELECTION, which the engine owns). The engine's cursor
  // callbacks also set textEditRef, but binding it to the caretVisible STATE here
  // guarantees the two can never disagree for a frame — so the overlay never arms
  // mid-type, killing the "blue frame slides while the shape doesn't" desync.
  useEffect(() => { textEditRef.current = caretVisible }, [caretVisible])

  // Re-render on zoom (after the doc is open). A zoom step changes the canvas
  // backing-store size, so it MUST be a full paint (region paints don't resize
  // the canvas) — but doing it INLINE made every click of a rapid zoom-in burst
  // hang the engine ~120ms in series. So coalesce through the shared settle
  // (~50ms): the last zoom in a burst wins and only ONE full paint runs. The
  // overlays (cell cursor / shape handles) are cheap DOM and rescale IMMEDIATELY
  // below, so the selection stays glued to the content while the tiles catch up.
  useEffect(() => {
    zoomRef.current = zoom
    // A wheel zoom keeps the document point under the pointer fixed: apply the
    // matching scroll once the canvas has taken its new size (two frames: React
    // commit, then layout).
    const anchor = zoomAnchorRef.current
    if (anchor && anchor.newZoom === zoom) {
      zoomAnchorRef.current = null
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const host = scrollHostRef.current
        if (!host) return
        const s = anchoredScroll(anchor.oldZoom, anchor.newZoom, anchor.scrollLeft, anchor.scrollTop, anchor.px, anchor.py)
        host.scrollLeft = s.left
        host.scrollTop = s.top
      }))
    }
    // Tiles are rendered per zoom; the old zoom's cache is dead weight now.
    clearTileCache()
    if (docRef.current && !loading) scheduleFullPaint(50)
    // Keep the cell-cursor outline aligned with the rescaled tiles.
    const c = cellCurTwRef.current
    const p = (DPI * zoom) / TWIPS_PER_INCH
    if (c) setCellCursor({ x: c.x * p, y: c.y * p, w: c.w * p, h: c.h * p })
    const g = graphicSelTwRef.current
    if (g) setGraphicSel({ x: g.x * p, y: g.y * p, w: g.w * p, h: g.h * p })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  // The doc surface lives in a different element for Calc (sticky-header grid)
  // vs Writer/Impress (centered). When the type resolves — or loading clears —
  // the canvas node is swapped, so repaint onto the freshly mounted canvas.
  useEffect(() => {
    if (docRef.current && !loading && !error) void paint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts.type, loading])

  /** Re-read comments and tracked changes from the engine. */
  const refreshReview = useCallback(async () => {
    try {
      const c = await window.workspace.lok.commandValues('.uno:ViewAnnotations')
      setComments(parseComments(c))
    } catch { /* not for this document type */ }
    if (parts.type === 0) {
      try {
        const r = await window.workspace.lok.commandValues('.uno:AcceptTrackedChanges')
        setRedlines(parseRedlines(r))
      } catch { /* engine busy */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts.type])
  useEffect(() => { if (!loading) void refreshReview() }, [loading, parts.type, refreshReview])
  const appCode: 'w' | 'c' | 'p' = parts.type === 1 ? 'c' : parts.type === 2 ? 'p' : 'w'
  /**
   * A review command: dispatch, then re-read the lists (the callback may or
   * may not follow). Inserting or replying to a comment leaves the engine's
   * caret INSIDE the comment box — the next keystrokes would go into the
   * comment, not the document (and Record would track nothing) — so an Escape
   * follows those to hand focus back to the text.
   */
  const reviewUno = useCallback((cmd: string, leaveComment = false) => {
    runUno(cmd)
    if (leaveComment) {
      setTimeout(() => {
        void window.workspace.lok.key(0, 0, 1281)
        void window.workspace.lok.key(1, 0, 1281)
        docWrapRef.current?.focus()
      }, 200)
    }
    setTimeout(() => { void refreshReview() }, 450)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshReview])

  // The engine answered a right-click with the menu for what is under the
  // pointer. Curated (officeMenu.ts) and shown at the remembered click point.
  const onEngineMenu = useCallback((payload: string) => {
    const pend = ctxPendingRef.current
    if (!pend || Date.now() - pend.at > 1500) return
    ctxPendingRef.current = null
    const items = menuFromEngine(payload)
    if (items.length === 0) return
    setCtxMenu({ x: pend.x, y: pend.y, items })
    // The right-click itself may have moved the caret or selected a shape.
    scheduleRepaint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Engine callback stream: track the cursor + drive repaints (extracted).
  useLokCallbacks({
    caretTwRef, cellCurTwRef, graphicSelTwRef, textEditRef, pxPerTwipRef, dirtyRectRef, dirtyRafRef,
    setCaret, setCaretVisible, setCellCursor, setCellAddr, setCellContent, setGraphicSel, setSelRects, setActive,
    scheduleRepaint, scheduleRegionRepaint, evictTiles, evictTilePart, cancelSettleRepaint,
    onContextMenu: onEngineMenu,
    onTableSelected: (p) => { tableSelRef.current = parseTableSelected(p); setTableSelected(!!tableSelRef.current); setTableKey((k) => k + 1) },
    onSearch: (found, payload) => {
      const r = searchResolveRef.current
      searchResolveRef.current = null
      if (!r) return
      let n = found ? 1 : 0
      try { const j = JSON.parse(payload) as { searchResultSelection?: unknown[] }; if (Array.isArray(j.searchResultSelection)) n = j.searchResultSelection.length } catch { /* not JSON */ }
      r(n)
    },
    onContextChanged: (p) => { officeContextRef.current = p; setOfficeContext(p) },
    setCellSelArea,
    onReviewChanged: () => {
      if (reviewTimerRef.current) clearTimeout(reviewTimerRef.current)
      reviewTimerRef.current = setTimeout(() => { reviewTimerRef.current = null; void refreshReview() }, 150)
    },
    onJsDialog: (payload) => {
      const msg = parseJsDialogMessage(payload)
      if (msg.kind === 'ignore') return
      if (msg.kind === 'full') {
        if (isPopup(msg.state) && Date.now() < popupMuteUntilRef.current) return
        if (msg.state.id < 0) {
          // A message box: attach the window id the WINDOW callback just announced.
          const w = lastWindowRef.current
          if (!w || Date.now() - w.at > 3000) return
          msg.state.id = w.id
        }
        jsDialogIdsRef.current.add(msg.state.id)
        setJsDialogs((d) => ({ ...d, [msg.state.id]: msg.state }))
        // The bitmap tunnel may already have opened for this window — drop it.
        setDialog((cur) => (cur && cur.id === msg.state.id ? null : cur))
        return
      }
      if (msg.kind === 'close') {
        jsDialogIdsRef.current.delete(msg.id)
        setJsDialogs((d) => { if (!(msg.id in d)) return d; const n = { ...d }; delete n[msg.id]; return n })
        setDirty(true)
        scheduleRepaint()
        docWrapRef.current?.focus()
        return
      }
      setJsDialogs((d) => (d[msg.id] ? { ...d, [msg.id]: applyJsDialogMessage(d[msg.id], msg) } : d))
    },
    setDialog: (v) => {
      // A WINDOW `created` for a JSDialog window arrives too; keep the tunnel shut for it.
      if (typeof v === 'function') { setDialog(v); return }
      if (v) lastWindowRef.current = { id: v.id, at: Date.now() }
      if (v && jsDialogIdsRef.current.has(v.id)) return
      // The JSON tree can trail the WINDOW notice by a few ms — give it a beat.
      if (v) setTimeout(() => { if (!jsDialogIdsRef.current.has(v.id)) setDialog(v) }, 250)
      else setDialog(v)
    },
    // Writer lays out lazily: adopt the grown document size and repaint (the
    // windowed paint keeps this cheap — a viewport of tiles, not the growth).
    onDocSizeChanged: (w, h) => {
      const cur = docRef.current
      if (cur && cur.w === w && cur.h === h) return
      docRef.current = { w, h }
      scheduleFullPaint(120)
    },
  })

  // Vector thumbnails (Impress): fetch the deck as one SVG on open and after edits
  // (thumbsKey) / structural changes, and split it into crisp per-slide images.
  // Falls back to bitmap tiles when the export is unavailable (deck stays null).
  useEffect(() => {
    if (!isImpress) { setDeck(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const svg = await window.workspace.lok.slidesSvg()
        if (!cancelled) setDeck(svg ? parseDeckSvg(svg) : null)
      } catch { if (!cancelled) setDeck(null) }
    })()
    return () => { cancelled = true }
  }, [isImpress, thumbsKey, parts.names.length])

  const runUno = useCallback((command: string) => {
    // The native .uno:SearchDialog is a no-op stub in the headless-canvas setup —
    // route it to the in-app Find & Replace bar instead.
    if (command === '.uno:SearchDialog') { setShowFind(true); return }
    void window.workspace.lok.uno(command)
    setDirty(true)
    scheduleRepaint()
    // A view mode (Web layout, Page Break, Notes, Master) re-lays the document
    // out at a new size; the engine does not always announce it, so re-read it.
    if (VIEW_FLAG_COMMANDS.has(command)) window.setTimeout(() => void refreshViewFlags(), 150)
    if (MODE_COMMANDS.has(command)) {
      setTimeout(async () => {
        const r = await window.workspace.lok.parts()
        const sz = await window.workspace.lok.setPart(r.cur)
        if (sz.ok) docRef.current = { w: sz.w, h: sz.h }
        if (partRef) partRef.current = r.cur
        setParts((p) => ({ ...p, cur: r.cur, names: r.names }))
        clearTileCache?.()
        await paint()
        setThumbsKey((k) => k + 1)
      }, 350)
    }
    docWrapRef.current?.focus() // return focus so typing continues in the doc
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Commit the formula bar's content to the active Calc cell, then advance
  // down (Excel-style) and repaint.
  const commitCell = useCallback((text: string) => {
    const esc = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    void window.workspace.lok.uno(`.uno:EnterString {"StringName":{"type":"string","value":"${esc}"}}`)
    setDirty(true)
    setTimeout(() => { void window.workspace.lok.uno('.uno:GoDown'); scheduleRepaint() }, 30)
    docWrapRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Live transclusion (metrics → real cells) ----
  // Whether this doc participates in transclusion (Calc / Writer / Impress).
  const isDocSurface = parts.type === 1 || parts.type === 0 || parts.type === 2
  // The metric concern (source-of-truth values, this file's links, the shared
  // write path, on-open re-sync, live propagation, insert, sync-all) — extracted.
  const {
    metrics, showMetrics, setShowMetrics,
    fileLinks, linkCounts, focusMetric, setFocusMetric, staleMetricIds,
    bumpLinks, forMetric, removeLink, revealFile,
    createMetric, createMetricFromCell, updateMetric,
    refreshMetric, refreshAllMetrics, detachMetric, deleteMetric,
    previewSyncAll, syncAll, insertMetric,
    applyRefreshResults,
  } = useMetricTransclusion({
    filePath, parts, isCalc, isDocSurface, cellAddr, loading, error,
    docWrapRef, setDirty, scheduleFullPaint, setToast,
  })

  // The live-range concern (source-of-truth grids, this file's block links, the
  // shared stamp path, on-open re-sync, insert-at-cell, sync-all) — the
  // grid-sized sibling of the metric hook. Calc-first: blocks anchor in sheets.
  const {
    ranges: liveRanges, fileRangeLinks, rangeLinkCounts, staleRangeIds,
    createRangeFromRef, refreshRange, refreshAllRanges, deleteRange, insertRange,
    previewSyncAllRange, syncAllRange, applyRangeRefreshResults,
  } = useRangeTransclusion({
    filePath, parts, isCalc, cellAddr, loading, error, panelOpen: showMetrics,
    docWrapRef, setDirty, scheduleFullPaint, setToast,
  })

  // The collections concern (records→layout — typed record sets, field-mapped
  // tables, on-source-refresh resync). The leap above live ranges: a raw grid
  // becomes typed records rendered through a mapping into a repeated block.
  const {
    collections: liveCollections, refreshCollections, collectionLinkCounts, staleCollectionIds,
    createCollectionFromRef, refreshCollection, refreshAllCollections, deleteCollection,
    insertCollection, previewSyncAllCollection, syncAllCollection,
  } = useCollections({
    filePath, parts, isCalc, cellAddr, panelOpen: showMetrics,
    docWrapRef, setDirty, scheduleFullPaint, setToast,
  })

  // Apply a number format from the native Format-Cells dialog to the current
  // selection. Each category command resets the cell to a 2-decimal baseline,
  // so decimals are reached by stepping Inc/Dec from 2; the thousands separator
  // (which Number includes by default) is toggled off when unchecked. Commands
  // are awaited in order so the engine applies them to the same selection.
  const applyNumberFormat = useCallback(async (spec: NumberFormatSpec) => {
    setShowFormatCells(false)
    // Space the commands out: the engine coalesces identical UNO commands fired
    // back-to-back (e.g. two DecDecimals collapse to one), so each must be given
    // a tick to apply to the same selection before the next is sent.
    const uno = async (c: string): Promise<void> => {
      await window.workspace.lok.uno(c)
      await new Promise((r) => setTimeout(r, 70))
    }
    await uno(spec.cmd)
    if (spec.decimals != null) {
      const delta = spec.decimals - 2 // category baseline is 2 decimals
      const step = delta < 0 ? '.uno:NumberFormatDecDecimals' : '.uno:NumberFormatIncDecimals'
      for (let i = 0; i < Math.abs(delta); i++) await uno(step)
    }
    if (spec.removeThousands) await uno('.uno:NumberFormatThousands')
    setDirty(true)
    scheduleFullPaint(60)
    docWrapRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Insert a special character at the cursor (key event = same as typing it).
  // The picker stays open for repeated inserts, so focus is left on the dialog.
  const insertSpecialChar = useCallback((ch: string) => {
    const cp = ch.codePointAt(0) ?? 0
    if (!cp) return
    void window.workspace.lok.key(0, cp, 0)
    void window.workspace.lok.key(1, cp, 0)
    setDirty(true)
    scheduleRepaint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Insert an image: the main process shows a native picker and embeds it via
  // .uno:InsertGraphic; repaint once it lands.
  const insertImage = useCallback(async () => {
    // Slides need the model-API path (places + selects a GraphicObjectShape);
    // Writer/Calc keep the dispatch-based embed.
    const ok = parts.type === 2 ? await window.workspace.lok.imageShape() : await window.workspace.lok.insertImage()
    if (ok) { setDirty(true); scheduleFullPaint(80); setThumbsKey((k) => k + 1) }
    docWrapRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts.type])

  // Raster → vector: pick an image, trace it to an editable SVG (imagetracerjs),
  // save it as a workspace asset and — on a slide — place it as a scalable vector
  // graphic. Reuses the existing image picker + WosInsertImage macro (LibreOffice
  // imports SVG as a graphic object), so no new engine complexity. Breaking the
  // SVG into individually-editable native shapes is a follow-up.
  const vectorizeImage = useCallback(async () => {
    const src = await window.workspace.lok.pickImage()
    if (!src) return
    setToast('Tracing image → vector…')
    try {
      const bytes = await window.workspace.fs.readFileBytes(src)
      const ext = src.split('.').pop()?.toLowerCase() ?? 'png'
      const mime =
        ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'webp' ? 'image/webp'
        : ext === 'gif' ? 'image/gif'
        : ext === 'bmp' ? 'image/bmp'
        : 'image/png'
      const url = URL.createObjectURL(bytesToBlob(bytes, mime))
      let svg: string
      try {
        svg = await vectorizeImageUrl(url)
      } finally {
        URL.revokeObjectURL(url)
      }
      // Persist the traced SVG at the workspace root as an editable asset.
      const root = await window.workspace.fs.getWorkspaceRoot()
      const base = (src.split('/').pop() ?? 'image').replace(/\.[^.]+$/, '')
      const name = `${base}-vector-${Date.now()}.svg`
      let savedPath: string | null = null
      if (root) {
        savedPath = `${root}/${name}`
        await window.workspace.fs.writeFile(savedPath, svg)
      }
      // On a slide, drop the SVG in as a scalable vector graphic.
      if (parts.type === 2 && savedPath) {
        await window.workspace.lok.macro('WosInsertImage', savedPath)
        setDirty(true)
        scheduleFullPaint(80)
        setThumbsKey((k) => k + 1)
      }
      setToast(savedPath ? `Vectorized → ${name}` : 'Vectorized (open a workspace to save it)')
      setTimeout(() => setToast(null), 2800)
    } catch (e) {
      setToast(`Vectorize failed: ${(e as Error).message}`)
      setTimeout(() => setToast(null), 2800)
    }
    docWrapRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts.type])

  // Apply cell borders to the selection via the model-API (Basic macro) bridge.
  const applyBorder = useCallback(async (spec: BorderSpec) => {
    const ok = await window.workspace.lok.setBorder(spec.preset, spec.color, spec.width)
    if (ok) { setDirty(true); scheduleFullPaint(60) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Find & Replace (Writer/Calc) via the model search API. On replace the doc is
  // dirtied and repainted; the returned count feeds the bar's status line.
  const runFindReplace = useCallback(async (req: {
    mode: 'findnext' | 'findprev' | 'replaceall'
    find: string; replace: string
    caseSensitive: boolean; wholeWord: boolean; regex: boolean
  }): Promise<number> => {
    if (parts.type === 2) {
      // Impress: the engine's own search (the model has no XReplaceable there).
      const args = {
        'SearchItem.SearchString': { type: 'string', value: req.find },
        'SearchItem.ReplaceString': { type: 'string', value: req.replace },
        'SearchItem.Command': { type: 'long', value: req.mode === 'replaceall' ? 3 : 0 },
        'SearchItem.Backward': { type: 'boolean', value: req.mode === 'findprev' },
        'SearchItem.CaseSensitive': { type: 'boolean', value: req.caseSensitive },
        'SearchItem.WordOnly': { type: 'boolean', value: req.wholeWord },
        'SearchItem.AlgorithmType': { type: 'long', value: req.regex ? 1 : 0 },
      }
      const n = await new Promise<number>((resolve) => {
        searchResolveRef.current = resolve
        window.setTimeout(() => { if (searchResolveRef.current === resolve) { searchResolveRef.current = null; resolve(0) } }, 4000)
        runUno(`.uno:ExecuteSearch ${JSON.stringify(args)}`)
      })
      if (req.mode === 'replaceall') { setDirty(true); scheduleFullPaint(60); setThumbsKey((k) => k + 1) } else scheduleRepaint()
      return n
    }
    const r = await window.workspace.lok.findReplace(req)
    if (req.mode === 'replaceall' && r.count > 0) {
      setDirty(true)
      scheduleFullPaint(60)
      setThumbsKey((k) => k + 1)
    } else {
      scheduleRepaint() // reveal the moved selection (find next/prev)
    }
    return r.ok ? r.count : -1
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts.type])

  // Insert a hyperlink at the cursor/selection via the parameterized command.
  const insertHyperlink = useCallback((text: string, url: string) => {
    setShowHyperlink(false)
    const args = JSON.stringify({
      'Hyperlink.Text': { type: 'string', value: text || url },
      'Hyperlink.URL': { type: 'string', value: url },
      'Hyperlink.Name': { type: 'string', value: '' },
      'Hyperlink.Target': { type: 'string', value: '' },
    })
    runUno(`.uno:SetHyperlink ${args}`)
    scheduleFullPaint(60)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply a Writer paragraph style (Heading 1/2, body) via .uno:StyleApply.
  const applyStyle = useCallback((styleName: string) => {
    const args = JSON.stringify({
      Style: { type: 'string', value: styleName },
      FamilyName: { type: 'string', value: 'ParagraphStyles' },
    })
    runUno(`.uno:StyleApply ${args}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doSave = useCallback(async () => {
    setSaving(true)
    const ok = await window.workspace.lok.save()
    setSaving(false)
    if (!ok) return
    setDirty(false)
    // "Feels live": once this file is on disk, its cells are authoritative. Re-read
    // any metric SOURCED from this file and propagate the fresh value downstream —
    // so editing the model's revenue cell + ⌘S updates every consuming doc. Cheap
    // (only metrics sourced from THIS file); a failed read just keeps the cache.
    try {
      await applyRefreshResults(await window.workspace.metrics.refreshForFile(filePath))
    } catch { /* fail-safe */ }
    // Same for RANGES sourced from this file — a saved source block propagates
    // its fresh grid into every consuming block (the open file live, closed
    // files on their next open). A failed read just keeps the cached grid.
    try {
      await applyRangeRefreshResults(await window.workspace.ranges.refreshForFile(filePath))
    } catch { /* fail-safe */ }
    // Same for COLLECTIONS sourced from this file — a saved source block re-reads
    // its records so consuming layouts can be synced. A failed read keeps the cache.
    try {
      await window.workspace.collections.refreshForFile(filePath)
      await refreshCollections()
    } catch { /* fail-safe */ }
  }, [filePath, applyRefreshResults, applyRangeRefreshResults, refreshCollections])

  // Print through the engine, scoped to this document (never the app shell).
  useFilePrint(filePath, async () => {
    if (loading || error) throw new Error(error || 'The document is still loading')
    setToast('Preparing print…')
    try {
      const ok = await window.workspace.lok.print(filePath)
      setToast(ok ? 'Opened for printing' : 'Print failed')
    } catch (error) {
      setToast('Print failed')
      throw error
    } finally {
      setTimeout(() => setToast(null), 2400)
    }
  })

  // ⌘F / Ctrl+F opens the in-app Find & Replace bar (Writer/Calc). Captured at the
  // window level so it works from the doc canvas or the ribbon; only intercepts on
  // searchable doc types so Impress keeps default behavior.
  useEffect(() => {
    const searchable = parts.type === 0 || parts.type === 1
    if (!searchable) return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        setShowFind(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [parts.type])

  // Drive the contextual native menus (Edit/Format/Insert/View/Go) for this doc:
  // push the doc type + part (slide/sheet) names once open, clear on unmount.
  // parts.names keeps its identity across cur-only changes, so slide switches
  // don't rebuild the native menu.
  useEffect(() => {
    if (!loading) void window.workspace.menu.setOfficeContext({ type: parts.type, parts: parts.names })
    if (!loading && (parts.type === 1 || parts.type === 2)) void refreshPartInfo()
  }, [loading, parts.type, parts.names])
  useEffect(() => () => { void window.workspace.menu.setOfficeContext({ type: null }) }, [])
  // Check marks and greyed items for the native menu bar, from the engine's own
  // state. Only the compact snapshot the menus use, and only when it changed —
  // the macOS menu is rebuilt on the other side.
  useEffect(() => {
    if (loading) return
    const snap = menuStateSnapshot(active)
    if (sameSnapshot(lastMenuStateRef.current, snap)) return
    lastMenuStateRef.current = snap
    void window.workspace.menu.setOfficeState(snap)
  }, [active, loading])

  // WOS-001: a freshly opened document was deaf to the keyboard.
  //
  // The whole keyboard path hangs off docWrap (tabIndex=0 + onKeyDown), and that
  // element was only ever focused from onMouseDown or on dialog close. A document
  // opened programmatically — New ▸ Word document, or any open that doesn't end
  // in a click on the page — therefore started unfocused, so keystrokes never
  // became lok.key calls and ⌘V never became .uno:Paste.
  //
  // Nothing drew a caret either: the overlay is gated on engine cursor callbacks
  // that only fire once the document has a cursor, and on a blank page with no
  // click neither ever fired. Asking Writer to go to the start of the document
  // both places that cursor and triggers the callback, so the caret appears.
  useEffect(() => {
    if (loading) return
    const el = docWrapRef.current
    if (!el) return
    // After paint, so focus lands on the mounted element rather than a stale one.
    const t = setTimeout(() => {
      if (!docWrapRef.current) return
      docWrapRef.current.focus()
      // Writer only: Calc always has a cell cursor, and seeding one in Impress
      // would select a shape the user did not ask for.
      if (parts.type === 0) runUno('.uno:GoToStartOfDoc')
    }, 60)
    return () => clearTimeout(t)
  }, [loading, parts.type, runUno])

  const doProperties = useCallback(async () => {
    setProps(await window.workspace.lok.fileInfo())
    setShowProps(true)
  }, [])

  const doExport = useCallback(async (format: string) => {
    const r = await window.workspace.lok.exportAs(format)
    if (r.ok && r.path) {
      setToast(`Exported ${r.path.split('/').pop()}`)
      setTimeout(() => setToast(null), 2600)
    } else {
      setToast('Export failed')
      setTimeout(() => setToast(null), 2600)
    }
  }, [])

  // Pen tool: refs mirror state so the (stable) mouse/key handlers read fresh values.
  const penModeRef = useRef(penMode)
  penModeRef.current = penMode
  const penPtsRef = useRef<{ tx: number; ty: number }[]>([])

  // Finish the polygon (≥3 points) → custom shape via the model API; then reset.
  const finishPen = useCallback(async () => {
    const pts = penPtsRef.current
    if (pts.length >= 3) {
      const arg = pts.map((p) => `${Math.round(p.tx * 1.76389)},${Math.round(p.ty * 1.76389)}`).join(';')
      await window.workspace.lok.macro('WosInsertPoly', arg)
      setDirty(true)
      await paint()
      setThumbsKey((k) => k + 1)
    }
    penPtsRef.current = []
    setPenPts([])
    setPenMode(false)
  }, [paint])
  const finishPenRef = useRef(finishPen)
  finishPenRef.current = finishPen

  // Pointer + keyboard input (mouse down/move/up, keydown, pen tool, optimistic
  // shape move/resize overlay) — extracted; handlers wire into the docWrap below.
  // Mirrors isCalc for the stable key handlers (deps []) to read fresh.
  isCalcRef.current = isCalc
  windowedRef.current = isCalc || isWriter
  partRef.current = parts.cur
  const { onKeyDown, onMouseDown, onMouseMove, onMouseUp, onContextMenuEvent } = useLokInput({
    canvasRef, docWrapRef, docRef, textEditRef, isCalcRef, graphicSelTwRef, pxPerTwipRef, lastPointerTwRef,
    penModeRef, penPtsRef, finishPenRef,
    setGraphicSel,
    setGuides, setPenPts, setPenMode, setDirty, setDragGhost,
    scheduleRepaint, scheduleFullPaint, scheduleRegionRepaint, paintRegion,
    scrollElRef: calcGridRef, scheduleWindowRepaint,
    doSave, runUno,
  })

  useEffect(() => {
    reloadComponents()
  }, [parts.type, showComponents, reloadComponents])

  // When a shape is selected, read its tag back; if it's a component instance,
  // surface its exposed variables in the panel.
  useEffect(() => {
    // selInfo runs an engine macro per selection — only worth it when there are
    // components to match (or the panel is open). Skip otherwise to cut latency.
    if (!graphicSel || (components.length === 0 && !showComponents)) { setSelectedInstance(null); return }
    let cancelled = false
    const t = setTimeout(async () => {
      const info = await window.workspace.lok.selInfo().catch(() => null)
      if (cancelled) return
      const m = info ? /^WosA_([A-Za-z0-9]+)$/.exec(info.name) : null
      const comp = m ? components.find((c) => c.id === m[1]) : undefined
      if (info && comp) setSelectedInstance({ comp, fill: info.fill, text: info.text, w: info.w, h: info.h })
      else setSelectedInstance(null)
    }, 130)
    return () => { cancelled = true; clearTimeout(t) }
  }, [graphicSel, parts.type, components, showComponents])

  // Dispatch a single office.* action id into the engine. Shared by the native
  // menu listener and the Ribbon's Design palette so both reuse one routing map.
  // ── Impress transitions + animations (B9): read back from the model after
  // every change so the ribbon and pane show what the file will carry.
  const [transitions, setTransitions] = useState<SlideTransition[]>([])
  const [effects, setEffects] = useState<AnimEffect[]>([])
  const [showAnim, setShowAnim] = useState(false)
  const [ribbonTab, setRibbonTab] = useState<{ tab: string; n: number } | null>(null)
  const requestTab = useCallback((tab: string) => setRibbonTab((r) => ({ tab, n: (r?.n ?? 0) + 1 })), [])
  const refreshTransitions = useCallback(async () => {
    try { const r = await window.workspace.lok.transition('info'); setTransitions(parseTransitions(r.raw)) } catch { /* not a presentation */ }
  }, [])
  const refreshEffects = useCallback(async () => {
    try { const r = await window.workspace.lok.animate('info'); setEffects(parseEffects(r.raw)) } catch { /* not a presentation */ }
  }, [])
  useEffect(() => {
    if (parts.type !== 2) return
    void refreshTransitions()
    void refreshEffects()
  }, [parts.type, parts.cur, parts.names.length, refreshTransitions, refreshEffects])
  const doTransition = useCallback(async (cmd: string) => {
    const cur = transitions[parts.cur] ?? { index: parts.cur, type: 0, subtype: 0, duration: 1, change: 0, advance: 0 }
    let next = { ...cur }
    let all = false
    if (cmd.startsWith('set:')) {
      const p = TRANSITIONS.find((t) => t.id === cmd.slice(4))
      if (!p) return
      next = { ...next, type: p.type, subtype: p.subtype, duration: next.duration || 1 }
    } else if (cmd.startsWith('duration:')) next.duration = Number(cmd.slice(9)) || 1
    else if (cmd.startsWith('advance:')) {
      const [, mode, secs] = cmd.split(':')
      next.change = mode === 'auto' ? 1 : 0
      next.advance = Number(secs) || 0
    } else if (cmd === 'all') all = true
    const r = await window.workspace.lok.transition(transitionSetArgs(parts.cur, next, all))
    setTransitions(parseTransitions(r.raw))
    setDirty(true)
  }, [transitions, parts.cur])
  const animOp = useCallback(async (op: string) => {
    const r = await window.workspace.lok.animate(op)
    setEffects(parseEffects(r.raw))
    setDirty(true)
  }, [])
  const doAnimate = useCallback(async (cmd: string) => {
    if (cmd === 'pane') { setShowAnim((v) => !v); return }
    if (!cmd.startsWith('add:')) return
    if (!graphicSel) { setToast('Select a shape first, then pick an animation'); return }
    const [, preset, nt] = cmd.split(':')
    await animOp(`add|${preset}|${nt || 1}`)
    setShowAnim(true)
  }, [graphicSel, animOp])

  // ── B6c/B8: ruler, table grips, outline groups, client-side views.
  const [officeView, setOfficeView] = useState<'sorter' | 'outline' | 'preview' | null>(null)
  const [slideTexts, setSlideTexts] = useState<SlideText[]>([])
  const [rulerOn, setRulerOn] = useState(true)
  const [ruler, setRuler] = useState<RulerInfo | null>(null)
  // A different document: drop every per-document overlay/view.
  useEffect(() => { setOfficeView(null); setRuler(null); setSlideTexts([]); setShowReview(false); setShowAnim(false); setSortAsk(null) }, [filePath])
  const refreshRuler = useCallback(async () => {
    try { const r = await window.workspace.lok.officeMacro('WosRulerInfo', ''); setRuler(parseRulerInfo(r.raw)) } catch { /* not writer */ }
  }, [])
  useEffect(() => {
    if (parts.type !== 0 || !rulerOn || loading) return
    const t = setTimeout(() => void refreshRuler(), 250)
    return () => clearTimeout(t)
  }, [parts.type, rulerOn, loading, caret?.x, caret?.y, zoom, refreshRuler])
  const rulerOp = useCallback(async (macro: 'WosParaFmt' | 'WosPageMargins', args: string) => {
    await window.workspace.lok.officeMacro(macro, args)
    setDirty(true)
    if (macro === 'WosPageMargins') {
      const sz = await window.workspace.lok.setPart(partRef.current)
      if (sz.ok) docRef.current = { w: sz.w, h: sz.h }
      scheduleFullPaint(60)
    } else scheduleRepaint()
    await refreshRuler()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshRuler])
  const refreshSlideTexts = useCallback(async () => {
    try { const r = await window.workspace.lok.officeMacro('WosSlideText', 'get'); setSlideTexts(parseSlideText(r.raw)) } catch { /* not impress */ }
  }, [])
  const setSlideText = useCallback(async (i: number, title: string, body: string[]) => {
    const r = await window.workspace.lok.officeMacro('WosSlideText', slideTextSetArgs(i, title, body))
    setSlideTexts(parseSlideText(r.raw))
    setDirty(true)
    setThumbsKey((k) => k + 1)
    scheduleFullPaint(60)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Data ▸ Group and Outline on the current selection: rows unless the
  // selection is wider than it is tall.
  const outlineFromSelection = useCallback((op: string): string | null => {
    if (op === 'auto' || op === 'clear') return op
    const p = pxPerTwipRef.current
    const box = cellSelArea ?? cellCursor
    if (!geometry || !box) return null
    const tl = cellAtTwips(geometry, box.x / p + 1, box.y / p + 1)
    const br = cellAtTwips(geometry, (box.x + box.w) / p - 1, (box.y + box.h) / p - 1)
    if (!tl || !br) return null
    const cols = br.col - tl.col + 1, rows = br.row - tl.row + 1
    return cols > rows ? `${op}|col|${tl.col}|${br.col}` : `${op}|row|${tl.row}|${br.row}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellSelArea, cellCursor, geometry])
  const outlineOp = useCallback(async (args: string) => {
    await window.workspace.lok.officeMacro('WosOutline', args)
    setDirty(true)
    await refreshGeometry()
    scheduleFullPaint(40)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshGeometry])
  const tableCellClick = useCallback((row: number, col: number, shift: boolean) => {
    const g = tableSelRef.current
    const c = g && cellCentre(g, row, col)
    if (!c) return
    const modifier = shift ? 0x1000 : 0
    void window.workspace.lok.mouse({ type: 0, x: c.x, y: c.y, count: 1, buttons: 1, modifier })
    void window.workspace.lok.mouse({ type: 1, x: c.x, y: c.y, count: 1, buttons: 1, modifier })
  }, [])
  const tableSelectCells = useCallback((r0: number, c0: number, r1: number, c1: number) => {
    tableCellClick(r0, c0, false)
    window.setTimeout(() => { tableCellClick(r1, c1, true); scheduleFullPaint(80) }, 80)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableCellClick])
  const tableInsert = useCallback((kind: 'row' | 'col', index: number, where: 'before' | 'after') => {
    const cell = kind === 'row' ? { row: index, col: 0 } : { row: 0, col: index }
    tableCellClick(cell.row, cell.col, false)
    const op = `${kind}${where}`
    window.setTimeout(() => {
      if (parts.type === 0) void tableOp(op)
      else void slideTableOp(op, undefined, cell)
    }, 80)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableCellClick, parts.type, tableOp, slideTableOp])
  const tableResize = useCallback((kind: 'row' | 'col', index: number, mm100: number) => {
    const cell = kind === 'row' ? { row: index, col: 0 } : { row: 0, col: index }
    if (parts.type === 0) {
      void window.workspace.lok.officeMacro('WosTableGeom', `${kind === 'row' ? 'rowheight' : 'colwidth'}|${index}|${mm100}`).then(() => { setDirty(true); scheduleFullPaint(60) })
    } else void slideTableOp(kind === 'row' ? 'rowheight' : 'colwidth', mm100, cell)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts.type, slideTableOp])

  // Calc view toggles without engine state (formulas, value highlighting, autocalc): read back from the view.
  const [viewFlags, setViewFlags] = useState<Record<string, string>>({})
  const refreshViewFlags = useCallback(async () => {
    try {
      const r = await window.workspace.lok.officeMacro('WosViewInfo', '')
      const m: Record<string, string> = {}
      const names: Record<string, string> = { formulas: '.uno:ToggleFormula', valuehl: '.uno:ViewValueHighlighting', grid: '.uno:ToggleSheetGrid', headers: '.uno:ViewRowColumnHeaders', autocalc: '.uno:AutomaticCalculation' }
      for (const l of r.raw.split('\n')) { const [k, v] = l.trim().split('|'); if (names[k]) m[names[k]] = v === '1' ? 'true' : 'false' }
      setViewFlags(m)
    } catch { /* not calc */ }
  }, [])
  useEffect(() => { if (parts.type === 1 && !loading) void refreshViewFlags() }, [parts.type, loading, refreshViewFlags])
  const VIEW_FLAG_COMMANDS = useMemo(() => new Set(['.uno:ToggleFormula', '.uno:ViewValueHighlighting', '.uno:AutomaticCalculation', '.uno:ViewColumnRowHighlighting']), [])

  // Calc sort with Excel's "expand the selection" question (WosSort).
  const [sortAsk, setSortAsk] = useState<{ direction: 'asc' | 'desc'; info: SortInfo } | null>(null)
  const runSort = useCallback(async (selection: string, direction: 'asc' | 'desc', expand: boolean) => {
    setSortAsk(null)
    await window.workspace.lok.officeMacro('WosSort', sortArgs(selection, direction, expand))
    setDirty(true)
    await refreshGeometry()
    scheduleFullPaint(60)
    docWrapRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshGeometry])
  const startSort = useCallback(async (direction: 'asc' | 'desc') => {
    const p = pxPerTwipRef.current
    const box = cellSelArea ?? cellCursor
    if (!geometry || !box) { setToast('Select the column (or cells) to sort first'); return }
    // The selection rectangle is pixel-aligned a hair outside the cells: sample
    // well inside (60 twips ≈ 4 px) so the edge never resolves to a neighbour.
    const inset = Math.min(60, box.w / p / 3, box.h / p / 3)
    const tl = cellAtTwips(geometry, box.x / p + inset, box.y / p + inset)
    const br = cellAtTwips(geometry, (box.x + box.w) / p - inset, (box.y + box.h) / p - inset)
    if (!tl || !br) return
    const sel = `${toA1(tl.col, tl.row)}:${toA1(br.col, br.row)}`
    const r = await window.workspace.lok.officeMacro('WosSort', `info|${sel}`)
    const info = parseSortInfo(r.raw)
    if (!info) { setToast('Nothing to sort here'); return }
    if (needsExpandPrompt(info)) setSortAsk({ direction, info })
    else await runSort(info.selection, direction, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellSelArea, cellCursor, geometry, runSort])

  const runOfficeAction = useCallback(
    (id: string) => {
      if (!id.startsWith('office.')) return
      if (id.startsWith('office.uno:')) runUno(id.slice('office.uno:'.length))
      else if (id.startsWith('office.slide:')) doSlideOp(id.slice('office.slide:'.length))
      // Impress ▸ Design ▸ Slide Layout — assign an auto-layout to this slide.
      else if (id.startsWith('office.slidelayout:')) void slideLayout(Number(id.slice('office.slidelayout:'.length)))
      else if (id.startsWith('office.table:')) void tableOp(id.slice('office.table:'.length))
      // Impress ▸ Table (context) — STRUCTURAL edit of the selected slide table.
      // id is "office.slidetable:<op>" or "office.slidetable:<op>:<size1/100mm>".
      else if (id.startsWith('office.slidetable:')) {
        const rest = id.slice('office.slidetable:'.length)
        const ci = rest.indexOf(':')
        // The cell under the last press (table edges × click point) scopes the op.
        const pt = lastPointerTwRef.current
        const cell = tableSelRef.current && pt ? cellAtPoint(tableSelRef.current, pt.x, pt.y) : null
        if (ci < 0) void slideTableOp(rest, undefined, cell)
        else void slideTableOp(rest.slice(0, ci), Number(rest.slice(ci + 1)), cell)
      }
      // Impress ▸ Table (context) — CELL FORMATTING of the selected slide table.
      // id is "office.slidetablefmt:<prop>:<value>" (value may be a negative color).
      else if (id.startsWith('office.slidetablefmt:')) {
        const rest = id.slice('office.slidetablefmt:'.length)
        const ci = rest.indexOf(':')
        if (ci < 0) void slideTableCellFmt(rest, '')
        else void slideTableCellFmt(rest.slice(0, ci), rest.slice(ci + 1))
      }
      else if (id === 'office.pen') { setPenMode((v) => !v); penPtsRef.current = []; setPenPts([]) }
      else if (id.startsWith('office.shape:')) void shapeInsert(id.slice('office.shape:'.length))
      else if (id.startsWith('office.shapefill:')) void shapeColor('fill', Number(id.slice('office.shapefill:'.length)))
      else if (id.startsWith('office.shapeline:')) void shapeColor('line', Number(id.slice('office.shapeline:'.length)))
      else if (id.startsWith('office.slidebg:')) {
        const rest = id.slice('office.slidebg:'.length)
        const ci = rest.indexOf(':')
        void slideBg(rest.slice(0, ci) as 'one' | 'all', Number(rest.slice(ci + 1)))
      }
      else if (id.startsWith('office.shapetext:')) {
        const rest = id.slice('office.shapetext:'.length)
        const ci = rest.indexOf(':')
        void shapeText(rest.slice(0, ci), rest.slice(ci + 1))
      }
      else if (id.startsWith('office.shapeeffect:')) {
        const segs = id.slice('office.shapeeffect:'.length).split(':')
        void shapeEffect(segs[0] === 'gradient' ? `gradient|${segs[1]}|${segs[2]}` : segs[0])
      }
      // Word Layout (Writer): margins / orientation / header-footer / page number.
      else if (id.startsWith('office.margins:')) {
        const rest = id.slice('office.margins:'.length)
        const ci = rest.indexOf(':')
        void layoutOp('WosPageMargins', `${rest.slice(0, ci)}|${rest.slice(ci + 1)}`)
      }
      else if (id.startsWith('office.orient:')) void layoutOp('WosPageOrient', id.slice('office.orient:'.length))
      else if (id.startsWith('office.headerfooter:')) {
        // which:mode:text — text is the remainder (may itself contain ':').
        const rest = id.slice('office.headerfooter:'.length)
        const a = rest.indexOf(':'); const b = rest.indexOf(':', a + 1)
        const which = rest.slice(0, a)
        const mode = b >= 0 ? rest.slice(a + 1, b) : rest.slice(a + 1)
        const text = b >= 0 ? rest.slice(b + 1) : ''
        void layoutOp('WosHeaderFooter', `${which}|${mode}|${text}`)
      }
      else if (id.startsWith('office.pagenum:')) void layoutOp('WosPageNumber', id.slice('office.pagenum:'.length))
      else if (id === 'office.dialog:margins') setShowMargins(true)
      else if (id.startsWith('office.arrange:')) void arrange(id.slice('office.arrange:'.length))
      else if (id.startsWith('office.chart:')) void chartInsert(id.slice('office.chart:'.length))
      else if (id.startsWith('office.pattern:')) void shapePattern(id.slice('office.pattern:'.length).replace(/:/g, '|'))
      else if (id.startsWith('office.stroke:')) void shapeStroke(id.slice('office.stroke:'.length).replace(/:/g, '|'))
      else if (id === 'office.imageshape') void insertImage()
      else if (id.startsWith('office.style:')) applyStyle(id.slice('office.style:'.length))
      else if (id === 'office.image') void insertImage()
      else if (id === 'office.vectorize') void vectorizeImage()
      else if (id === 'office.dialog:table') setShowInsertTable(true)
      else if (id === 'office.dialog:formatcells') setShowFormatCells(true)
      else if (id === 'office.dialog:symbol') setShowSpecialChar(true)
      else if (id === 'office.dialog:hyperlink') setShowHyperlink(true)
      else if (id === 'office.dialog:borders') setShowBorders(true)
      else if (id === 'office.dialog:condformat') setShowCondFormat(true)
      // Calc conditional formatting applied from the dialog (op|v1|v2|colorLong).
      else if (id.startsWith('office.condformat:')) void condFormat(id.slice('office.condformat:'.length))
      else if (id === 'office.dialog:datavalidation') setShowDataValidation(true)
      // Calc data validation applied from the dialog (kind|arg1|arg2).
      else if (id.startsWith('office.datavalidation:')) void dataValidation(id.slice('office.datavalidation:'.length))
      else if (id === 'office.transitions') requestTab('Transitions')
      else if (id === 'office.ruler') setRulerOn((v) => !v)
      else if (id === 'office.sort:asc' || id === 'office.sort:desc') void startSort(id.endsWith('asc') ? 'asc' : 'desc')
      else if (id === 'office.toc:insert') void window.workspace.lok.officeMacro('WosInsertToc', '').then(() => { setDirty(true); scheduleFullPaint(60) })
      else if (id === 'office.toc:update') void window.workspace.lok.officeMacro('WosUpdateIndexes', '').then(() => { setDirty(true); scheduleFullPaint(60) })
      else if (id.startsWith('office.watermark:')) {
        // A header text shape via the model API (the engine's .uno:Watermark only opens its dialog).
        const text = id.slice('office.watermark:'.length).replace(/[|\r\n]/g, ' ').slice(0, 60)
        void window.workspace.lok.officeMacro('WosWatermark', text).then(async () => {
          setDirty(true)
          const sz = await window.workspace.lok.setPart(partRef.current)
          if (sz.ok) docRef.current = { w: sz.w, h: sz.h }
          scheduleFullPaint(80)
        })
      }
      else if (id.startsWith('office.outline:')) { const a = outlineFromSelection(id.slice('office.outline:'.length)); if (a) void outlineOp(a); else setToast('Select the rows or columns to group first') }
      else if (id.startsWith('office.view:')) {
        const v = id.slice('office.view:'.length)
        if (v === 'normal') setOfficeView(null)
        else { setOfficeView(v as 'sorter' | 'outline' | 'preview'); if (v === 'outline') void refreshSlideTexts() }
      }
      else if (id === 'office.animations') { requestTab('Animations'); setShowAnim(true) }
      else if (id === 'office.review') setShowReview((v) => !v)
      else if (id === 'office.review:add') { setShowReview(true); setTimeout(() => (document.querySelector('[data-testid="review-draft"]') as HTMLTextAreaElement | null)?.focus(), 50) }
      else if (id === 'office.save') void doSave()
      else if (id.startsWith('office.export:')) void doExport(id.slice('office.export:'.length))
      else if (id === 'office.properties') void doProperties()
      else if (id.startsWith('office.present:')) {
        if (id.endsWith(':first')) void goToPart(0).then(() => setPresenting(true))
        else setPresenting(true)
      }
      else if (id === 'office.zoom:in') setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)))
      else if (id === 'office.zoom:out') setZoom((z) => Math.max(0.5, +(z - 0.2).toFixed(2)))
      else if (id === 'office.zoom:reset') setZoom(1)
      // Go ▸ Go to Slide/Sheet — jump straight to a part by index.
      else if (id.startsWith('office.gopart:')) void goToPart(Number(id.slice('office.gopart:'.length)))
      // View ▸ Components Panel (Impress) — toggle the assets panel.
      else if (id === 'office.components') setShowComponents((v) => !v)
    },
    [runUno, doSlideOp, slideLayout, tableOp, slideTableOp, slideTableCellFmt, layoutOp, shapeInsert, shapeColor, slideBg, shapeText, shapeEffect, arrange, shapePattern, shapeStroke, chartInsert, condFormat, dataValidation, applyStyle, insertImage, vectorizeImage, goToPart, outlineFromSelection, outlineOp, requestTab, refreshSlideTexts, startSort],
  )

  // Route native office-menu clicks (Edit/Format/Insert/View) into the engine.
  useEffect(() => window.workspace.menu.onRunAction(runOfficeAction), [runOfficeAction])

  // WOS-006: clipboard accelerators are resolved by focus in App's edit router
  // (⌘C in the browser address bar must not reach this canvas). When it decides
  // the canvas IS the right target, it re-emits the office action here.
  useEffect(() => {
    const onEvt = (e: Event): void => {
      const id = (e as CustomEvent<{ id?: unknown }>).detail?.id
      if (typeof id === 'string') runOfficeAction(id)
    }
    window.addEventListener('wos:run-action', onEvt)
    return () => window.removeEventListener('wos:run-action', onEvt)
  }, [runOfficeAction])

  // Stable adapters for memoized children (Ribbon, CalcHeaders, SlideRail,
  // SheetTabs, ComponentsPanel). Inline arrows in JSX defeat React.memo — a new
  // function identity every render — so every callback prop below is either a
  // useCallback'd handler passed directly or one of these wrappers.
  const zoomBy = useCallback((d: number) => setZoom((z) => Math.min(3, Math.max(0.5, +(z + d).toFixed(2)))), [])
  const setZoomClamped = useCallback((z: number) => setZoom(Math.min(3, Math.max(0.5, z))), [])
  useWheelZoom(scrollHostRef, zoomRef, setZoomClamped, zoomAnchorRef)
  const selRectsRef = useRef(selRects)
  selRectsRef.current = selRects
  const cellSelAreaRef = useRef(cellSelArea)
  cellSelAreaRef.current = cellSelArea
  // The engine's selection rects can land AFTER the pointer is up (the
  // BUTTONUP round trip); show the toolbar when they do, not only on mouseup.
  useEffect(() => {
    if (!pointerDownRef.current && (selRects.length > 0 || cellSelArea)) setMiniOn(true)
  }, [selRects, cellSelArea])
  /** Writer counts for the status line, debounced after edits (a model read, not a render). */
  const scheduleDocStatus = useCallback(() => {
    if (parts.type !== 0) return
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    statusTimerRef.current = setTimeout(() => {
      statusTimerRef.current = null
      window.workspace.lok.docStatus?.().then((d) => { if (d) setDocStatus(d) }).catch(() => {})
    }, 700)
  }, [parts.type])
  useEffect(() => { if (!loading) scheduleDocStatus() }, [loading, parts.type, scheduleDocStatus])
  /** Show the selection toolbar once the pointer is up and something is selected. */
  const showMiniSoon = useCallback(() => {
    setTimeout(() => {
      if (pointerDownRef.current) return
      if (selRectsRef.current.length > 0 || graphicSelTwRef.current || cellSelAreaRef.current) setMiniOn(true)
    }, 80)
  }, [])
  const openInsertTable = useCallback(() => setShowInsertTable(true), [])
  const openFormatCells = useCallback(() => setShowFormatCells(true), [])
  const openSpecialChar = useCallback(() => setShowSpecialChar(true), [])
  const openHyperlink = useCallback(() => setShowHyperlink(true), [])
  const openBorders = useCallback(() => setShowBorders(true), [])
  const autofitHeader = useCallback((kind: 'col' | 'row', index: number) => void resizeHeader(kind, index, 0), [resizeHeader])
  const closeComponents = useCallback(() => setShowComponents(false), [])
  const toggleNotes = useCallback(() => setShowNotes((v) => !v), [])

  // Selected band in document px, for the header highlight (selection union, or
  // the single cell under the caret). Single-pass min/max, and a stable object
  // identity when the rect is unchanged — so CalcHeaders (memoized) doesn't
  // re-render on every caret/selection callback that lands the same band.
  const selPxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const selPx = useMemo(() => {
    let next: { x: number; y: number; w: number; h: number } | null
    if (selRects.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const r of selRects) {
        if (r.x < x0) x0 = r.x
        if (r.y < y0) y0 = r.y
        if (r.x + r.w > x1) x1 = r.x + r.w
        if (r.y + r.h > y1) y1 = r.y + r.h
      }
      next = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    } else if (caret) {
      next = { x: caret.x, y: caret.y, w: 1, h: caret.h }
    } else {
      next = null
    }
    const p = selPxRef.current
    if (p && next && p.x === next.x && p.y === next.y && p.w === next.w && p.h === next.h) return p
    if (!p && !next) return p
    selPxRef.current = next
    return next
  }, [selRects, caret])

  // Live-link markers (Calc): the pixel rect of each xlsx-cell link on the
  // CURRENT sheet, derived from the same run-length geometry the headers use, so
  // a subtle marker lands exactly on the live cell. Read-only + pass-through.
  const liveCellRects = useMemo(() => {
    if (!isCalc || !geometry) return [] as { id: string; x: number; y: number; w: number; h: number }[]
    const p = (DPI * zoom) / TWIPS_PER_INCH
    const sheet = parts.names[parts.cur] || ''
    const out: { id: string; x: number; y: number; w: number; h: number }[] = []
    for (const l of fileLinks) {
      if (l.target.kind !== 'xlsx-cell') continue
      if (l.target.sheet && sheet && l.target.sheet !== sheet) continue
      const r = cellRectFromGeometry(geometry, l.target.cell, p)
      if (r) out.push({ id: l.id, ...r })
    }
    return out
  }, [isCalc, geometry, fileLinks, zoom, parts.names, parts.cur])

  // The document surface (canvas + selection + caret) — shared by the Calc grid
  // layout (with sticky headers) and the centered Writer/Impress layout.
  const docWrap = (
    <div
      ref={docWrapRef}
      className={`${styles.docWrap} ${isWriter ? styles.docWrapFramed : ''}`}
      style={{ ...(isCalc ? { width: pxSize.w, height: pxSize.h, gridColumn: 3, gridRow: 3 } : { width: pxSize.w, height: pxSize.h }), cursor: penMode ? 'crosshair' : undefined }}
      tabIndex={0}
      onKeyDown={(e) => { if (miniOn) setMiniOn(false); onKeyDown(e); scheduleDocStatus() }}
      onMouseDown={(e) => { pointerDownRef.current = true; lastClientRef.current = { x: e.clientX, y: e.clientY }; if (miniOn) setMiniOn(false); onMouseDown(e) }}
      onMouseMove={onMouseMove}
      onMouseUp={(e) => { pointerDownRef.current = false; onMouseUp(e); showMiniSoon(); scheduleDocStatus() }}
      onMouseLeave={(e) => { pointerDownRef.current = false; onMouseUp(e) }}
      onMouseDownCapture={() => {
        // The armed painter consumes exactly one click (the engine applies the
        // style on it), so disarm here rather than leaving the badge stuck on.
        if (painterArmed) { setPainterArmed(false); setDirty(true); scheduleFullPaint(60) }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        if (penMode) return
        // The click goes to the engine as a real right button: it selects what
        // is under the pointer (a cell, a word, a shape, a table cell) and
        // answers with the menu for that target — see onEngineMenu.
        const at = Date.now()
        ctxPendingRef.current = { x: e.clientX, y: e.clientY, at }
        if (!onContextMenuEvent(e)) { ctxPendingRef.current = null; return }
        // A spreadsheet always has a cell under the pointer; if the engine's
        // answer is lost (backpressure drops callbacks by design), fall back to
        // the app's own cell menu rather than showing nothing.
        if (isCalc) {
          const x = e.clientX, y = e.clientY
          setTimeout(() => {
            const p = ctxPendingRef.current
            if (p && p.at === at) { ctxPendingRef.current = null; setCtxMenu({ x, y, items: menuFor('cell') }) }
          }, 700)
        }
      }}
    >
      <canvas ref={canvasRef} className={`${styles.page} ${isCalc || isWriter ? styles.pageWindowed : ''}`} />
      {/* Pen tool: in-progress polygon (points are twips → px via pxPerTwip). */}
      {penMode && penPts.length > 0 && (() => {
        const p = pxPerTwipRef.current
        const pxPts = penPts.map((pt) => ({ x: pt.tx * p, y: pt.ty * p }))
        const d = pxPts.map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x},${q.y}`).join(' ')
        return (
          <svg className={styles.penOverlay} style={{ width: pxSize.w, height: pxSize.h }}>
            <path d={d + (pxPts.length >= 3 ? ' Z' : '')} fill={pxPts.length >= 3 ? 'rgba(91,155,213,0.25)' : 'none'} stroke="#1a73e8" strokeWidth={1.5} strokeDasharray="4 3" />
            {pxPts.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={i === 0 ? 5 : 3.5} fill={i === 0 ? '#1a73e8' : '#fff'} stroke="#1a73e8" strokeWidth={1.5} />)}
          </svg>
        )
      })()}
      {/* Comment anchors in the right margin: one bubble per open thread at its anchor's height. */}
      {comments.filter((c) => !c.parentId && c.anchor && (c.part === null || !isCalc || c.part === parts.cur)).map((c) => {
        const p = pxPerTwipRef.current
        const y = c.anchor!.y * p
        return (
          <button
            key={c.id}
            data-testid="comment-anchor"
            className={`${styles.commentAnchor} ${focusComment === c.id ? styles.commentAnchorOn : ''} ${c.resolved ? styles.commentAnchorDone : ''}`}
            style={{ top: y, left: isCalc ? c.anchor!.x * p + c.anchor!.w * p - 6 : undefined, right: isCalc ? undefined : 6 }}
            title={`${c.author}: ${c.text.slice(0, 80)}`}
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
            onClick={(e) => { e.stopPropagation(); setFocusComment(c.id); setShowReview(true) }}
          >
            ✎
          </button>
        )
      })}
      {/* Floating selection toolbar (text / cells / shape) above a settled selection. */}
      {miniOn && !penMode && (selRects.length > 0 || graphicSel || (isCalc && cellSelArea)) && (() => {
        const bbox = isCalc && cellSelArea
          ? cellSelArea
          : selRects.length > 0
            ? selRects.reduce((a, r) => ({ x: Math.min(a.x, r.x), y: Math.min(a.y, r.y), w: Math.max(a.x + a.w, r.x + r.w) - Math.min(a.x, r.x), h: Math.max(a.y + a.h, r.y + r.h) - Math.min(a.y, r.y) }))
            : graphicSel!
        const context: MiniContext = isCalc && cellSelArea ? 'cells' : selRects.length === 0 ? 'shape' : isCalc && !caretVisible ? 'cells' : 'text'
        return <MiniToolbar anchor={bbox} context={context} active={active} onUno={runUno} onDesign={runOfficeAction} />
      })()}
      {/* Calc fill handle at the selection corner; drag continues the series. */}
      {isCalc && geometry && (cellSelArea || cellCursor) && (() => {
        const p = pxPerTwipRef.current
        const box = cellSelArea ?? cellCursor!
        const tl = cellAtTwips(geometry, box.x / p + 1, box.y / p + 1)
        const br = cellAtTwips(geometry, (box.x + box.w) / p - 1, (box.y + box.h) / p - 1)
        if (!tl || !br) return null
        const source = { col: tl.col, row: tl.row, cols: Math.max(1, br.col - tl.col + 1), rows: Math.max(1, br.row - tl.row + 1) }
        return (
          <FillHandle
            box={box}
            source={source}
            geometry={geometry}
            pxPerTwipRef={pxPerTwipRef}
            docWrapRef={docWrapRef}
            onDragStart={() => setMiniOn(false)}
            onCommit={(plan) => {
              ;(window as unknown as { __wosLastFill?: unknown }).__wosLastFill = plan
              void window.workspace.lok.macro('WosFill', `${plan.range}|${plan.dir}|${plan.count}`).then(() => {
                setDirty(true)
                scheduleFullPaint(60)
                void refreshGeometry()
              })
            }}
          />
        )
      })()}
      {selRects.map((s, i) => (
        <div key={i} className={styles.selRect} style={{ left: s.x, top: s.y, width: s.w, height: s.h }} />
      ))}
      {isCalc && cellCursor && selRects.length === 0 && (
        <div className={styles.cellCursor} style={{ left: cellCursor.x, top: cellCursor.y, width: cellCursor.w, height: cellCursor.h }} />
      )}
      {/* Live-link markers: a calm accent underline + corner dot on each cell
          that transcludes a metric. Read-only, pass-through, updates on zoom. */}
      {liveCellRects.map((r) => (
        <div
          key={r.id}
          data-testid="live-link-marker"
          className={styles.liveLink}
          style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
        >
          <span className={styles.liveLinkDot} />
        </div>
      ))}
      {/* Drag ghost: the shape's pixels, copied off the canvas when the drag armed.
          Follows the pointer as a real preview, then holds the drop position until
          the engine repaint lands — so the move looks instant even though the
          repaint costs ~300ms on a content-heavy deck. The captured canvas is
          adopted as a DOM child (no re-encoding to a data URL per frame). */}
      {/* Smart guides while a shape is dragged (document twips → px). */}
      {guides.map((g, i) => {
        const p = pxPerTwipRef.current
        return g.axis === 'v'
          ? <div key={i} className={styles.guideV} style={{ left: g.pos * p, top: g.from * p, height: (g.to - g.from) * p }} />
          : <div key={i} className={styles.guideH} style={{ top: g.pos * p, left: g.from * p, width: (g.to - g.from) * p }} />
      })}
      {/* Table grips (Writer + Impress): select rows/columns, insert, resize. */}
      {tableSelected && tableSelRef.current && !isCalc && (
        <TableGrips key={tableKey} geometry={tableSelRef.current} pxPerTwip={pxPerTwipRef.current} onSelect={tableSelectCells} onInsert={tableInsert} onResize={tableResize} />
      )}
      {dragGhost && (
        <div
          data-testid="drag-ghost"
          className={`${styles.dragGhost} ${dragGhost.committed ? styles.dragGhostCommitted : ''}`}
          style={{ left: dragGhost.x, top: dragGhost.y, width: dragGhost.w, height: dragGhost.h }}
          ref={(el) => {
            if (el && el.firstChild !== dragGhost.canvas) el.replaceChildren(dragGhost.canvas)
          }}
        />
      )}
      {/* Shape selection box + resize handles. pointer-events:none so the drag
          passes through to the canvas, where the engine performs move/resize. */}
      {graphicSel && (
        <div data-testid="graphic-sel" className={styles.graphicSel} style={{ left: graphicSel.x, top: graphicSel.y, width: graphicSel.w, height: graphicSel.h }}>
          {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => (
            <span key={h} className={`${styles.handle} ${styles[`handle_${h}`]}`} />
          ))}
        </div>
      )}
      {graphicSel && selRects.length === 0 && !penMode && (
        <RotateHandle
          box={graphicSel}
          docWrapRef={docWrapRef}
          onCommit={(angle100) => {
            void window.workspace.lok.macro('WosShapeRotate', String(angle100)).then(() => {
              setDirty(true)
              scheduleFullPaint(60)
              setThumbsKey((k) => k + 1)
            })
          }}
        />
      )}
      {caretVisible && caret && selRects.length === 0 && (
        <div className={styles.caret} style={{ left: caret.x, top: caret.y, height: caret.h }} />
      )}
    </div>
  )


  /**
   * Place the cell cursor inside a header's band, then select the whole
   * column/row. The click has to land in the sheet first — a bare
   * .uno:SelectColumn acts on wherever the cursor already was, which is how you
   * end up deleting the wrong column.
   */
  const selectBand = useCallback((kind: 'col' | 'row', _index: number, centreTwip: number) => {
    const p = pxPerTwipRef.current
    const canvas = canvasRef.current
    if (!canvas || !p) return
    // Click a point inside the band: along the band's centre on its own axis,
    // and just inside the sheet on the other.
    const tx = kind === 'col' ? centreTwip : 60 / p
    const ty = kind === 'row' ? centreTwip : 60 / p
    void window.workspace.lok.mouse({ type: 0, x: Math.round(tx), y: Math.round(ty), count: 1, buttons: 1, modifier: 0 })
    void window.workspace.lok.mouse({ type: 1, x: Math.round(tx), y: Math.round(ty), count: 1, buttons: 1, modifier: 0 })
    runUno(kind === 'col' ? '.uno:SelectColumn' : '.uno:SelectRow')
    scheduleFullPaint(40)
    docWrapRef.current?.focus()
  }, [runUno, scheduleFullPaint])

  /** Run a menu choice: a uno dispatch, or a dialog the renderer owns. */
  const runMenuItem = useCallback((item: MenuItem) => {
    switch (item.action) {
      case 'formatCells': setShowFormatCells(true); return
      case 'borders': setShowBorders(true); return
      case 'hyperlink': setShowHyperlink(true); return
      case 'table': setShowInsertTable(true); return
      case 'condformat': setShowCondFormat(true); return
      case 'datavalidation': setShowDataValidation(true); return
      case 'find': setShowFind(true); return
      case 'symbol': setShowSpecialChar(true); return
      case 'image': void insertImage(); return
      case 'sheetop': {
        const [op, idx, ...rest] = (item.arg ?? '').split('|')
        const index = Number(idx)
        if (op === 'rename') { setRenameSheet(index); return }
        void sheetOpAt(op, index, rest.length ? rest.join('|') : undefined)
        return
      }
      case 'slideop': {
        const [op, idx, ...rest] = (item.arg ?? '').split('|')
        const index = Number(idx)
        if (op === 'rename') { setRenameSlide(index); return }
        if (op === 'transition') { void goToPart(index).then(() => requestTab('Transitions')); return }
        void slideOp(op, index, rest.length ? rest.join('|') : undefined)
        return
      }
      case 'present': {
        void goToPart(Number(item.arg) || 0).then(() => setPresenting(true))
        return
      }
      default: break
    }
    if (!item.uno) return
    if (item.mode) {
      // Arm the mode and stop: the engine now waits for the next click, and so
      // do we. No repaint — nothing has changed yet.
      runUno(item.uno)
      setPainterArmed(true)
      setToast('Copy formatting: click a cell to apply it')
      return
    }
    runUno(item.uno)
    // Structural edits reflow the whole grid, so settle with a full repaint
    // rather than the caret-band one an ordinary keystroke uses.
    setDirty(true)
    scheduleFullPaint(60)
  }, [runUno, scheduleFullPaint, insertImage, sheetOpAt, slideOp, goToPart])

  return (
    <div className={styles.root}>
      <Ribbon
        docType={parts.type}
        active={parts.type === 1 ? { ...active, ...viewFlags } : active}
        context={graphicSel && selRects.length === 0 ? (/Graphic/.test(officeContext) ? 'picture' : 'shape') : tableSelected && parts.type !== 1 ? 'table' : null}
        dirty={dirty}
        saving={saving}
        zoom={zoom}
        fileName={filePath.split('/').pop()}
        onUno={runUno}
        onStyle={applyStyle}
        onSave={doSave}
        onZoom={zoomBy}
        onSetZoom={setZoomClamped}
        onExport={doExport}
        onProperties={doProperties}
        onDesign={runOfficeAction}
        onSlideOp={doSlideOp}
        onInsertTable={openInsertTable}
        onFormatCells={openFormatCells}
        painterArmed={painterArmed}
        onPaintbrush={() => {
          runUno('.uno:FormatPaintbrush')
          setPainterArmed(true)
          setToast('Copy formatting: click a cell to apply it')
        }}
        onInsertSymbol={openSpecialChar}
        onHyperlink={openHyperlink}
        onInsertImage={insertImage}
        onBorders={openBorders}
        notesOn={showNotes}
        onToggleNotes={toggleNotes}
        transition={transitions[parts.cur] ?? null}
        onTransition={(c) => void doTransition(c)}
        effects={effects}
        onAnimate={(c) => void doAnimate(c)}
        animPaneOpen={showAnim}
        requestTab={ribbonTab}
        rulerOn={isWriter && rulerOn}
      />
      {/* Engine dialogs (JSDialog trees) rendered with our widgets. */}
      {Object.values(jsDialogs).map((d) => (
        <JsDialog
          key={d.id}
          state={d}
          anchor={lastClientRef.current}
          onEvent={(ev: JsDialogEvent) => {
            if (ev.control === '__POPUPS__') {
              popupMuteUntilRef.current = Date.now() + 800
              setJsDialogs((m) => {
                const n = { ...m }
                for (const p of Object.values(m)) if (isPopup(p)) { jsDialogIdsRef.current.delete(p.id); delete n[p.id]; void window.workspace.lok.windowClose(p.id) }
                return n
              })
              docWrapRef.current?.focus()
              return
            }
            if (ev.control === '__WINDOW__') { void window.workspace.lok.windowClose(d.id); return }
            if (ev.control === '__KEY__') {
              // Message boxes answer only to a key on their window: Enter = default (Yes/OK), Escape = No/Cancel.
              const code = ev.cmd === 'enter' ? { charCode: 13, keyCode: 1280 } : { charCode: 0, keyCode: 1281 }
              void window.workspace.lok.windowKey({ id: d.id, type: 0, ...code }).then(() => window.workspace.lok.windowKey({ id: d.id, type: 1, ...code }))
              setTimeout(() => { setDirty(true); scheduleRepaint() }, 200)
              return
            }
            void window.workspace.lok.dialogEvent({ id: d.id, control: ev.control, cmd: ev.cmd, type: ev.type, data: ev.data })
          }}
          onClose={() => {
            jsDialogIdsRef.current.delete(d.id)
            setJsDialogs((m) => { const n = { ...m }; delete n[d.id]; return n })
            docWrapRef.current?.focus()
          }}
        />
      ))}
      {/* Right-click menu — rendered once for the whole surface (fixed
          positioning, so it is not clipped by the grid's scroll container). */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onPick={runMenuItem}
          onClose={() => setCtxMenu(null)}
        />
      )}

      <LokDialogs
        dialog={dialog}
        onDialogClose={() => { setDialog(null); setDirty(true); scheduleRepaint() }}
        showInsertTable={showInsertTable}
        onInsertTableCancel={() => { setShowInsertTable(false); docWrapRef.current?.focus() }}
        onInsertTableConfirm={(cols, rows) => {
          setShowInsertTable(false)
          const args = JSON.stringify({ Columns: { type: 'long', value: cols }, Rows: { type: 'long', value: rows } })
          runUno(`.uno:InsertTable ${args}`)
          scheduleFullPaint(60)
        }}
        showFormatCells={showFormatCells}
        onFormatCellsCancel={() => { setShowFormatCells(false); docWrapRef.current?.focus() }}
        onFormatCellsConfirm={(spec) => void applyNumberFormat(spec)}
        showSpecialChar={showSpecialChar}
        onSpecialCharInsert={insertSpecialChar}
        onSpecialCharClose={() => { setShowSpecialChar(false); docWrapRef.current?.focus() }}
        showHyperlink={showHyperlink}
        onHyperlinkCancel={() => { setShowHyperlink(false); docWrapRef.current?.focus() }}
        onHyperlinkConfirm={insertHyperlink}
        showBorders={showBorders}
        onBordersCancel={() => { setShowBorders(false); docWrapRef.current?.focus() }}
        onBordersApply={(spec) => void applyBorder(spec)}
        showCondFormat={showCondFormat}
        onCondFormatCancel={() => { setShowCondFormat(false); docWrapRef.current?.focus() }}
        onCondFormatApply={(spec) => {
          setShowCondFormat(false)
          void condFormat(`${spec.op}|${spec.value1}|${spec.value2}|${spec.colorLong}`)
          docWrapRef.current?.focus()
        }}
        onCondFormatClear={() => {
          setShowCondFormat(false)
          void condFormat('clear|||')
          docWrapRef.current?.focus()
        }}
        showDataValidation={showDataValidation}
        onDataValidationCancel={() => { setShowDataValidation(false); docWrapRef.current?.focus() }}
        onDataValidationApply={(spec) => {
          setShowDataValidation(false)
          void dataValidation(`${spec.kind}|${spec.arg1}|${spec.arg2}`)
          docWrapRef.current?.focus()
        }}
        onDataValidationClear={() => {
          setShowDataValidation(false)
          void dataValidation('clear||')
          docWrapRef.current?.focus()
        }}
        showMargins={showMargins}
        onMarginsCancel={() => { setShowMargins(false); docWrapRef.current?.focus() }}
        onMarginsApply={(spec) => {
          setShowMargins(false)
          void layoutOp('WosPageMargins', `top|${spec.top}`)
            .then(() => layoutOp('WosPageMargins', `bottom|${spec.bottom}`))
            .then(() => layoutOp('WosPageMargins', `left|${spec.left}`))
            .then(() => layoutOp('WosPageMargins', `right|${spec.right}`))
        }}
        showProps={showProps}
        onPropsClose={() => setShowProps(false)}
        props={props}
        fileName={filePath.split('/').pop()}
        docType={parts.type}
        partCount={parts.names.length}
        docSizeTw={docRef.current}
      />
      {isCalc && (
        <div className={styles.formulaRow}>
          <NameBox
            address={cellAddr}
            onSubmit={(text) => {
              // Addresses, ranges and names all resolve through GoToCell — its
              // cursor callbacks reach us (a macro's would be muted). A new
              // name is defined for the selection first, then jumped to.
              const t = text.replace(/[|\n]/g, ' ').trim()
              const isAddress = /^(\$?[A-Za-z]{1,3}\$?\d{1,7})(:\$?[A-Za-z]{1,3}\$?\d{1,7})?$/.test(t) || t.includes('.') || t.includes('!')
              const go = (): void => { runUno(`.uno:GoToCell {"ToPoint":{"type":"string","value":${JSON.stringify(t)}}}`); scheduleFullPaint(60); void refreshGeometry() }
              if (isAddress) { go(); return }
              void window.workspace.lok.macro('WosNameBox', t).then(() => { setDirty(true); go() })
            }}
          />
          <FormulaBar cellRef={cellAddr} value={cellContent} onCommit={commitCell} />
        </div>
      )}
      <div className={styles.viewport}>
        {showFind && (
          <FindReplaceBar
            supported
            onRun={runFindReplace}
            onClose={() => { setShowFind(false); docWrapRef.current?.focus() }}
          />
        )}
        {toast && <div className={styles.toast}>{toast}</div>}
        {error && <div className={styles.overlay}>Cannot render: {error}</div>}
        {loading && !error && <div className={styles.overlay} style={{ color: 'var(--fg-muted)' }}>Rendering…</div>}
        {isCalc ? (
          <div
            ref={(el) => {
              if (el) { calcGridRef.current = el; scrollHostRef.current = el }
              else { if (scrollHostRef.current === calcGridRef.current) scrollHostRef.current = null; calcGridRef.current = null }
            }}
            className={styles.calcGrid}
            onScroll={() => scheduleWindowRepaint()}
            style={{
              visibility: loading || error ? 'hidden' : 'visible',
              gridTemplateColumns: `${outlineSizes(geometry).rowW}px ${ROW_HEADER_W}px ${Math.round(pxSize.w)}px`,
              gridTemplateRows: `${outlineSizes(geometry).colH}px ${COL_HEADER_H}px ${Math.round(pxSize.h)}px`,
            }}
          >
            <CalcHeaders
              geometry={geometry}
              pxPerTwip={(DPI * zoom) / TWIPS_PER_INCH}
              docW={docRef.current?.w ?? 0}
              docH={docRef.current?.h ?? 0}
              selPx={selPx}
              onResize={resizeHeader}
              onAutofit={autofitHeader}
              onSelectBand={selectBand}
              onBandContextMenu={(kind, index, centreTwip, x, y) => {
                selectBand(kind, index, centreTwip)
                setCtxMenu({ x, y, items: menuFor(kind === 'col' ? 'column' : 'row') })
              }}
              onOutline={(args) => void outlineOp(args)}
            />
            {docWrap}
          </div>
        ) : isImpress ? (
          <div className={styles.impressLayout} style={{ visibility: loading || error ? 'hidden' : 'visible' }}>
            <SlideRail
              count={parts.names.length}
              current={parts.cur}
              slideW={docRef.current?.w ?? 0}
              slideH={docRef.current?.h ?? 0}
              refreshKey={thumbsKey}
              deck={deck}
              onGoTo={goToPart}
              onReorder={reorderSlide}
              visible={partsVisible}
              names={parts.names}
              onContextMenu={(i, x, y) => setCtxMenu({ x, y, items: slideThumbMenu({ count: parts.names.length, index: i, visible: partsVisible }) })}
              renameIndex={renameSlide}
              onRenameHandled={() => setRenameSlide(null)}
              onRename={(i, name) => void slideOp('rename', i, name)}
            />
            <div className={styles.pagesImpress}>
              <button className={styles.presentBtn} onClick={() => setPresenting(true)} title="Present (full screen)">▶ Present</button>
              {officeView === 'sorter' && (
                <SlideSorter count={parts.names.length} current={parts.cur} slideW={docRef.current?.w ?? 0} slideH={docRef.current?.h ?? 0} visible={partsVisible} names={parts.names} refreshKey={thumbsKey}
                  onGoTo={(i) => void goToPart(i)} onReorder={(f, t) => void reorderSlide(f, t).then(() => refreshPartInfo())}
                  onContextMenu={(i, x, y) => setCtxMenu({ x, y, items: slideThumbMenu({ count: parts.names.length, index: i, visible: partsVisible }) })}
                  onClose={() => setOfficeView(null)} />
              )}
              {officeView === 'outline' && (
                <OutlineView slides={slideTexts} current={parts.cur} onChange={(i, t, b) => void setSlideText(i, t, b)} onGoTo={(i) => void goToPart(i)} onClose={() => setOfficeView(null)} />
              )}
              {docWrap}
              {showNotes && (
                <NotesPane
                  slide={parts.cur}
                  value={notes}
                  onCommit={commitNotes}
                  onClose={() => setShowNotes(false)}
                />
              )}
            </div>
          </div>
        ) : (
          <div
            ref={(el) => {
              if (el) { pagesElRef.current = el; scrollHostRef.current = el }
              else { if (scrollHostRef.current === pagesElRef.current) scrollHostRef.current = null; pagesElRef.current = null }
            }}
            className={styles.pages}
            onScroll={() => scheduleWindowRepaint()}
            style={{ visibility: loading || error ? 'hidden' : 'visible' }}
          >
            {isWriter && rulerOn && ruler && (
              <Ruler info={ruler} pxPerTwip={pxPerTwipRef.current} pageLeftPx={(docWrapRef.current?.offsetLeft ?? 0) + 284 * pxPerTwipRef.current} widthPx={Math.max(pxSize.w, (docWrapRef.current?.offsetLeft ?? 0) * 2 + pxSize.w)} onOp={(m, a) => void rulerOp(m, a)} />
            )}
            {isWriter && officeView === 'preview' && (
              <PrintPreview pages={Math.max(1, parts.names.length)} docW={docRef.current?.w ?? 0} docH={docRef.current?.h ?? 0} refreshKey={thumbsKey} onExportPdf={() => void doExport('pdf')} onClose={() => setOfficeView(null)} />
            )}
            {docWrap}
          </div>
        )}
        {!loading && !error && (
          <button className={styles.componentsBtn} onClick={() => setShowComponents((v) => !v)} title="Components (reusable assets)">◳ Components</button>
        )}
        {!loading && !error && (isCalc || isWriter || isImpress) && (
          <button className={styles.metricsBtn} onClick={() => setShowMetrics((v) => !v)} title="Metrics (live values that fail safe to a correct file)" data-testid="metrics-toggle">∑ Metrics</button>
        )}
        {/* In-doc live-links indicator: how many values in THIS file are live,
            clickable to open the Metrics panel focused on this file's links. */}
        {!loading && !error && isDocSurface && fileLinks.length + fileRangeLinks.length > 0 && (
          <button
            className={styles.liveChip}
            data-testid="live-links-chip"
            title="Live values in this file — click to see where each is linked"
            onClick={() => {
              setFocusMetric(fileLinks[0]?.metricId ?? null)
              setShowMetrics(true)
            }}
          >
            <span className={styles.liveChipDot}>●</span> {fileLinks.length + fileRangeLinks.length} live value
            {fileLinks.length + fileRangeLinks.length > 1 ? 's' : ''} in this file
          </button>
        )}
        {penMode && (
          <div className={styles.penHint}>✎ Pen: click to add points · click the first point or press Enter to finish · Esc to cancel</div>
        )}
        {sortAsk && (
          <SortExpandDialog
            direction={sortAsk.direction}
            column={pickedColumn(sortAsk.info)}
            region={`${plainRange(sortAsk.info.region).a}:${plainRange(sortAsk.info.region).b}`}
            selection={sortAsk.info.selection}
            onExpand={() => void runSort(sortAsk.info.selection, sortAsk.direction, true)}
            onCurrent={() => void runSort(sortAsk.info.selection, sortAsk.direction, false)}
            onCancel={() => setSortAsk(null)}
          />
        )}
        {showAnim && parts.type === 2 && (
          <AnimationPane
            effects={effects}
            onOp={(op) => void animOp(op)}
            onMove={(f, t) => void animOp(orderArgs(effects, f, t))}
            onTrigger={(i, nt) => void animOp(triggerArgs(effects, i, nt))}
            onClose={() => setShowAnim(false)}
          />
        )}
        {showReview && (
          <ReviewPanel
            app={appCode}
            comments={comments}
            redlines={redlines}
            focusId={focusComment}
            recording={active['.uno:TrackChanges'] === 'true'}
            onInsertComment={(text) => reviewUno(reviewCommands.insertComment(text), true)}
            onReply={(id, text) => reviewUno(reviewCommands.reply(id, text), true)}
            onResolve={(id) => reviewUno(reviewCommands.resolve(id))}
            onDeleteComment={(id) => reviewUno(reviewCommands.deleteComment(id, appCode))}
            onAccept={(i) => reviewUno(reviewCommands.acceptChange(i))}
            onReject={(i) => reviewUno(reviewCommands.rejectChange(i))}
            onAcceptAll={() => reviewUno('.uno:AcceptAllTrackedChanges')}
            onRejectAll={() => reviewUno('.uno:RejectAllTrackedChanges')}
            onToggleRecord={() => runUno('.uno:TrackChanges')}
            onFocusComment={(c) => setFocusComment(c.id)}
            onClose={() => setShowReview(false)}
          />
        )}
        {(showComponents || selectedInstance) && (
          <ComponentsPanel
            components={components}
            selected={selectedInstance}
            onInsert={insertComponent}
            onSave={saveComponent}
            onDelete={deleteComponent}
            onUpdateInstance={updateInstance}
            onCapture={captureSelection}
            onRefresh={reloadComponents}
            onClose={closeComponents}
          />
        )}
        {showMetrics && (isCalc || isWriter || isImpress) && (
          <MetricsPanel
            metrics={metrics}
            surface={isImpress ? 'impress' : isWriter ? 'writer' : 'calc'}
            activeCell={cellAddr}
            onCreate={createMetric}
            onCreateFromCell={createMetricFromCell}
            sourceCellLabel={isCalc && cellAddr ? `${parts.names[parts.cur] || 'Sheet1'}!${cellAddr}` : undefined}
            onUpdate={updateMetric}
            onRefresh={refreshMetric}
            onRefreshAll={refreshAllMetrics}
            onDetach={detachMetric}
            staleMetricIds={staleMetricIds}
            onDelete={deleteMetric}
            onInsert={insertMetric}
            onPreviewSyncAll={previewSyncAll}
            onSyncAll={syncAll}
            onForMetric={forMetric}
            linkCounts={linkCounts}
            onRemoveLink={removeLink}
            onRevealFile={revealFile}
            onLinksChanged={bumpLinks}
            focusMetricId={focusMetric}
            rangesSection={
              <RangesSection
                ranges={liveRanges}
                surface={isImpress ? 'impress' : isWriter ? 'writer' : 'calc'}
                activeCell={cellAddr}
                onCreateFromRef={createRangeFromRef}
                onInsert={insertRange}
                onRefresh={refreshRange}
                onRefreshAll={refreshAllRanges}
                staleRangeIds={staleRangeIds}
                onDelete={deleteRange}
                onPreviewSyncAll={previewSyncAllRange}
                onSyncAll={syncAllRange}
                linkCounts={rangeLinkCounts}
              />
            }
            collectionsSection={
              <CollectionsSection
                collections={liveCollections}
                surface={isImpress ? 'impress' : isWriter ? 'writer' : 'calc'}
                activeCell={cellAddr}
                onCreateFromRef={createCollectionFromRef}
                onInsert={insertCollection}
                onRefresh={refreshCollection}
                onRefreshAll={refreshAllCollections}
                staleCollectionIds={staleCollectionIds}
                onDelete={deleteCollection}
                onPreviewSyncAll={previewSyncAllCollection}
                onSyncAll={syncAllCollection}
                linkCounts={collectionLinkCounts}
              />
            }
            onClose={() => { setShowMetrics(false); setFocusMetric(null) }}
          />
        )}
      </div>
      {presenting && (
        <PresentMode
          count={parts.names.length}
          start={parts.cur}
          slideW={docRef.current?.w ?? 0}
          slideH={docRef.current?.h ?? 0}
          advance={advanceSeconds(transitions)}
          onClose={() => setPresenting(false)}
        />
      )}
      {isCalc ? (
        <SheetTabs
          names={parts.names}
          current={parts.cur}
          onGoTo={goToPart}
          onSheetOp={(op, arg) => { void sheetOp(op, arg).then(() => refreshPartInfo()) }}
          visible={partsVisible}
          onMoveTo={(from, to) => void sheetOpAt('moveto', from, String(to))}
          onContextMenu={(i, x, y) => setCtxMenu({ x, y, items: sheetTabMenu({ names: parts.names, visible: partsVisible, index: i }) })}
          renameIndex={renameSheet}
          onRenameHandled={() => setRenameSheet(null)}
        />
      ) : (
        parts.names.length > 1 && !isImpress && (
          <div className={styles.partBar}>
            {parts.names.map((nm, i) => (
              <button
                key={i}
                className={i === parts.cur ? styles.partActive : styles.partTab}
                onClick={() => void goToPart(i)}
                title={nm}
              >
                {nm || `${parts.type === 2 ? 'Slide' : 'Sheet'} ${i + 1}`}
              </button>
            ))}
          </div>
        )
      )}
      {!loading && !error && (
        <StatusBar
          app={appCode}
          doc={docStatus}
          part={{ cur: parts.cur, count: parts.names.length, name: parts.names[parts.cur] ?? '' }}
          cellStatus={(active['.uno:StateTableCell'] ?? '').replace(/;\s*/g, ' · ')}
          pageState={active['.uno:StatePageNumber'] ?? ''}
          zoom={zoom}
          onZoom={setZoomClamped}
        />
      )}
    </div>
  )
}
