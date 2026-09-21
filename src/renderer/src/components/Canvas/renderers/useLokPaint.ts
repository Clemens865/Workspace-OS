import { useRef, useCallback } from 'react'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import { DPI, TWIPS_PER_INCH, TILE, bgraToRgba } from '../../../lib/lokCanvasUtils'
import { TileCache } from '../../../lib/tileCache'

/**
 * Decide whether a settle repaint should be a bounded REGION paint or a whole-doc
 * FULL paint, given the accumulated dirty rect (twips) and the doc size (twips).
 *
 * Pure + exported so the region-vs-full choice is unit-testable in isolation from
 * the engine/canvas. The rule: region-paint unless the dirty area covers so much
 * of the doc that fetching just those tiles saves nothing over a clean full paint
 * (the ~half-doc threshold matches the old settleShapeRegion fallback), OR the
 * dirty rect is unknown (null → we can't bound it, so repaint everything).
 */
export function chooseSettleMode(
  dirty: { x: number; y: number; w: number; h: number } | null,
  doc: { w: number; h: number } | null,
): 'full' | 'region' {
  if (!dirty || !doc || doc.w <= 0 || doc.h <= 0) return 'full'
  const area = Math.max(0, dirty.w) * Math.max(0, dirty.h)
  return area > 0.5 * doc.w * doc.h ? 'full' : 'region'
}

/** Device-px window over a Calc sheet: origin, size, and the tile grid to fetch. */
export interface CalcWindow {
  /** Window origin in device px (tile-aligned), and its CSS-px equivalent. */
  devX: number
  devY: number
  cssX: number
  cssY: number
  /** Window backing size in device px (tile-aligned, clamped to the doc). */
  devW: number
  devH: number
  /** Tile origins WITHIN the window canvas (device px) + their twip source rects. */
  tiles: { ox: number; oy: number; cw: number; ch: number; tx: number; ty: number; tw: number; th: number }[]
}

/**
 * The visible slice of a Calc sheet to actually render — the fix for tiling the
 * whole used range. Given the scroll position and viewport size (CSS px), the
 * document extent (device px) and the device-per-twip scale, returns a
 * tile-aligned window (origin + size) plus exactly the tiles under it, with a
 * one-tile prefetch margin so small scrolls reuse the painted window.
 *
 * Pure and exported so the coordinate math — the thing that broke the reverted
 * 2026-07 attempt — is unit-tested in isolation from the engine and the DOM.
 * All arithmetic is in DEVICE px (CSS × dpr); `cssX/cssY` are the origin back
 * in CSS px for the canvas transform. Tile origins (`ox/oy`) are relative to
 * the WINDOW canvas, not the document.
 */
export function computeCalcWindow(args: {
  scrollLeftCss: number
  scrollTopCss: number
  clientWCss: number
  clientHCss: number
  docWDev: number
  docHDev: number
  dpr: number
  devPerTwip: number
  marginTiles?: number
}): CalcWindow {
  const { scrollLeftCss, scrollTopCss, clientWCss, clientHCss, docWDev, docHDev, dpr, devPerTwip } = args
  const margin = (args.marginTiles ?? 1) * TILE
  // Visible rect in device px, grown by the margin, tile-aligned outward.
  const visX = Math.max(0, scrollLeftCss * dpr)
  const visY = Math.max(0, scrollTopCss * dpr)
  const visW = Math.max(1, clientWCss * dpr)
  const visH = Math.max(1, clientHCss * dpr)
  let devX = Math.max(0, Math.floor((visX - margin) / TILE) * TILE)
  let devY = Math.max(0, Math.floor((visY - margin) / TILE) * TILE)
  const x1 = Math.min(docWDev, Math.ceil((visX + visW + margin) / TILE) * TILE)
  const y1 = Math.min(docHDev, Math.ceil((visY + visH + margin) / TILE) * TILE)
  // A doc smaller than the viewport: the window is the whole doc.
  if (devX >= x1) devX = 0
  if (devY >= y1) devY = 0
  const devW = Math.max(0, x1 - devX)
  const devH = Math.max(0, y1 - devY)
  const tiles: CalcWindow['tiles'] = []
  for (let oy = 0; oy < devH; oy += TILE) {
    for (let ox = 0; ox < devW; ox += TILE) {
      const cw = Math.min(TILE, devW - ox)
      const ch = Math.min(TILE, devH - oy)
      // Source rect in twips maps from the tile's ABSOLUTE device position.
      tiles.push({
        ox, oy, cw, ch,
        tx: Math.round((devX + ox) / devPerTwip),
        ty: Math.round((devY + oy) / devPerTwip),
        tw: Math.round(cw / devPerTwip),
        th: Math.round(ch / devPerTwip),
      })
    }
  }
  return { devX, devY, cssX: devX / dpr, cssY: devY / dpr, devW, devH, tiles }
}

interface UseLokPaintArgs {
  canvasRef: RefObject<HTMLCanvasElement>
  /** Document size in twips (set on open / part switch). */
  docRef: MutableRefObject<{ w: number; h: number } | null>
  /** Cursor position in twips (tracked from the engine's cursor callbacks). */
  caretTwRef: MutableRefObject<{ x: number; y: number } | null>
  setPxSize: Dispatch<SetStateAction<{ w: number; h: number }>>
  setThumbsKey: Dispatch<SetStateAction<number>>
  /**
   * True for Calc AND Writer. Both tile ONLY the visible scroll window (a huge
   * used range / a many-page document would otherwise tile a document-sized
   * canvas — the slowness this fixes, and past ~32k px the canvas allocation
   * itself fails). Impress keeps the full paint: one slide is small and bounded,
   * and its layout is the historically fragile path — untouched by design.
   */
  windowedRef?: MutableRefObject<boolean>
  /** The active scroll container (.calcGrid for Calc, .pages for Writer). */
  scrollElRef?: RefObject<HTMLElement | null>
  /** The current part (sheet/slide) — keys the tile cache. */
  partRef?: MutableRefObject<number>
}

interface UseLokPaint {
  /** Full repaint. `refreshAll=false` (the scroll path) treats fresh cached
   *  tiles as final and fetches only misses/stale; default refetches all
   *  (drawing cached tiles instantly as placeholders while it does). */
  paint: (refreshAll?: boolean) => Promise<void>
  /** Awaitable region paint. Unlike scheduleRegionRepaint (rAF-coalesced, fire
   *  and forget) this resolves once the tiles are on the canvas — the drag ghost
   *  needs that edge to know when the real pixels have replaced it. */
  paintRegion: (twX: number, twY: number, twW: number, twH: number) => Promise<void>
  scheduleRepaint: () => void
  scheduleFullPaint: (ms?: number) => void
  scheduleRegionRepaint: (x: number, y: number, w: number, h: number) => void
  /** Throttled re-window repaint on scroll (no-op for Impress). */
  scheduleWindowRepaint: (ms?: number) => void
  /** Evict cached tiles overlapping a dirty TWIP rect (engine invalidation). */
  evictTiles: (x: number, y: number, w: number, h: number, part?: number) => void
  /** Evict every cached tile of a part ("EMPTY" whole-doc invalidation). */
  evictTilePart: (part?: number) => void
  /** Drop the whole tile cache (doc open, zoom change). */
  clearTileCache: () => void
  /** Cancel the pending debounced settle repaint queued by scheduleRepaint. */
  cancelSettleRepaint: () => void
  pxPerTwipRef: MutableRefObject<number>
  zoomRef: MutableRefObject<number>
  dirtyRectRef: MutableRefObject<{ x: number; y: number; w: number; h: number } | null>
  dirtyRafRef: MutableRefObject<number | null>
}

/**
 * The LOK paint pipeline: renders the engine's tiles into the canvas (full,
 * cursor-region and dirty-region repaints), with render-token supersession,
 * an offscreen buffer for atomic full repaints, rAF-coalesced region repaints
 * and the debounced repaint/thumbnail timers.
 */
export function useLokPaint({ canvasRef, docRef, caretTwRef, setPxSize, setThumbsKey, windowedRef, scrollElRef, partRef }: UseLokPaintArgs): UseLokPaint {
  const offscreenRef = useRef<HTMLCanvasElement | null>(null)
  const pxPerTwipRef = useRef(DPI / TWIPS_PER_INCH)
  const zoomRef = useRef(1)
  const renderTokenRef = useRef(0)
  // The painted window's origin in DEVICE px. {0,0} for Impress (canvas == doc);
  // for Calc/Writer it's the tile-aligned scroll-window origin, subtracted by
  // the region paints so a doc-twip rect maps to window-local canvas px.
  const windowOriginRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  /**
   * The tile cache + the document GENERATION.
   *
   * Cached tiles make scrolling back over rendered ground instant (drawn from
   * here, zero engine work). Each edit bumps the generation; a scroll paint
   * treats a same-generation hit as FINAL, but a stale-generation hit is drawn
   * instantly and refetched in the background — draw-stale-reconcile-async, so
   * the cache can never leave permanently wrong pixels on screen.
   */
  const tileCacheRef = useRef(new TileCache<{ img: ImageBitmap; gen: number; close: () => void }>())
  const docGenRef = useRef(0)
  // ONE settle timer for both edit-reflow (scheduleRepaint) and structural/
  // selection (scheduleFullPaint) passes. Previously two independent timers
  // (90ms + 50ms) could both fire and each block the engine's single thread for
  // a whole repaint back-to-back; merging them means a burst of mixed schedule
  // calls collapses to exactly ONE settle that region- or full-paints based on
  // how much actually went dirty (see chooseSettleMode).
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The dirty region (twips) accumulated for the pending settle. scheduleRepaint
  // unions the caret's reflow band; scheduleFullPaint escalates to a full paint
  // (null band = whole doc) since its callers (selection/structural) span more
  // than the caret line. Reset when the settle fires.
  const settleBandRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const settleFullRef = useRef(false)
  // Region-repaint coalescing: the engine's INVALIDATE_TILES callbacks carry the
  // exact dirty rect (twips). We union a frame's worth of them and repaint only
  // those tiles on the next rAF — instead of re-rendering the whole document.
  const dirtyRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const dirtyRafRef = useRef<number | null>(null)
  const thumbTimer = useRef<ReturnType<typeof setTimeout>>()

  // A tile's BGRA converted to ImageData (reused for both the blit and the
  // ImageBitmap the cache keeps). Null on a malformed tile.
  const tileToImageData = useCallback((ctx: CanvasRenderingContext2D, tile: { cw: number; ch: number; bgra: Uint8Array }): ImageData | null => {
    const cw = Math.round(tile.cw)
    const ch = Math.round(tile.ch)
    if (!Number.isFinite(cw) || !Number.isFinite(ch) || cw <= 0 || ch <= 0 || tile.bgra.length < cw * ch * 4) return null
    const img = ctx.createImageData(cw, ch)
    bgraToRgba(tile.bgra, img.data, cw * ch)
    return img
  }, [])

  /** Stores a freshly fetched tile in the cache (bitmap creation is async). */
  const cacheTile = useCallback((img: ImageData, absTx: number, absTy: number, gen: number) => {
    const part = partRef?.current ?? 0
    const key = { part, zoom: zoomRef.current, dpr: window.devicePixelRatio || 1, tx: absTx, ty: absTy }
    void createImageBitmap(img).then((bmp) => {
      tileCacheRef.current.set(key, { img: bmp, gen, close: () => bmp.close() })
    }).catch(() => { /* bitmap creation failing only costs a future cache hit */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch a set of tiles in batched engine round-trips. Chunk size matters:
  // the engine is single-threaded and processes stdin commands in order, so a
  // keystroke typed mid-repaint waits for the CURRENT command to finish. One
  // monolithic batch made a full Retina repaint a single ~24-tile command —
  // input stalled for the whole repaint (felt as typing lag). Small chunks,
  // awaited sequentially, give input a slot every few tiles while keeping
  // most of the IPC saving (4 commands per repaint instead of 24).
  const fetchTiles = useCallback(async (specs: { cw: number; ch: number; tx: number; ty: number; tw: number; th: number }[]) => {
    const BATCH = 6
    const out: { cw: number; ch: number; bgra: Uint8Array }[] = []
    for (let i = 0; i < specs.length; i += BATCH) {
      out.push(...(await window.workspace.lok.tiles(specs.slice(i, i + BATCH))))
    }
    return out
  }, [])

  // Full repaint — render every needed tile to an OFFSCREEN canvas, then swap it
  // onto the visible canvas in one atomic drawImage. No tile-by-tile flicker.
  //
  // Calc paints only the VISIBLE scroll window (computeCalcWindow): the backing
  // store is viewport-sized and positioned (left/top) at the window origin
  // inside the doc-sized docWrap, so overlays — which stay in doc coordinates —
  // line up untouched. Writer/Impress paint the whole doc (canvas == doc), the
  // long-standing behavior, since a page/slide is small.
  const paint = useCallback(async (refreshAll = true) => {
    const doc = docRef.current
    const canvas = canvasRef.current
    if (!doc || !canvas) return
    const token = ++renderTokenRef.current
    const dpr = window.devicePixelRatio || 1
    const zoom = zoomRef.current
    // CSS px/twip drives layout, overlays and mouse mapping; the canvas backing
    // store is rendered at device px (CSS × dpr) so text stays crisp on HiDPI
    // (Retina) displays instead of being a 1× bitmap upscaled by the compositor.
    const pxPerTwip = (DPI * zoom) / TWIPS_PER_INCH
    const devPerTwip = pxPerTwip * dpr
    pxPerTwipRef.current = pxPerTwip
    // Document size in CSS/device px — always drives docWrap + overlays (pxSize),
    // even when the CANVAS is only a window onto it.
    const docCssW = Math.max(1, Math.round(doc.w * pxPerTwip))
    const docCssH = Math.max(1, Math.round(doc.h * pxPerTwip))
    const docDevW = Math.max(1, Math.round(docCssW * dpr))
    const docDevH = Math.max(1, Math.round(docCssH * dpr))
    if (!Number.isFinite(docDevW) || !Number.isFinite(docDevH)) return
    setPxSize({ w: docCssW, h: docCssH })

    const windowed = windowedRef?.current ?? false
    const scrollEl = scrollElRef?.current ?? null

    // The canvas backing window (device px) + its origin (device + CSS px).
    let winDevW = docDevW, winDevH = docDevH, winDevX = 0, winDevY = 0, winCssX = 0, winCssY = 0
    let origins: { ox: number; oy: number }[] = []
    let specs: { cw: number; ch: number; tx: number; ty: number; tw: number; th: number }[] = []

    if (windowed && scrollEl) {
      const w = computeCalcWindow({
        scrollLeftCss: scrollEl.scrollLeft,
        scrollTopCss: scrollEl.scrollTop,
        clientWCss: scrollEl.clientWidth,
        clientHCss: scrollEl.clientHeight,
        docWDev: docDevW,
        docHDev: docDevH,
        dpr,
        devPerTwip,
        marginTiles: 2, // two tiles of prefetch → small scrolls reuse the window
      })
      winDevW = Math.max(1, w.devW); winDevH = Math.max(1, w.devH)
      winDevX = w.devX; winDevY = w.devY; winCssX = w.cssX; winCssY = w.cssY
      origins = w.tiles.map((t) => ({ ox: t.ox, oy: t.oy }))
      specs = w.tiles.map((t) => ({ cw: t.cw, ch: t.ch, tx: t.tx, ty: t.ty, tw: t.tw, th: t.th }))
    } else {
      for (let oy = 0; oy < docDevH; oy += TILE) {
        for (let ox = 0; ox < docDevW; ox += TILE) {
          const cw = Math.min(TILE, docDevW - ox)
          const ch = Math.min(TILE, docDevH - oy)
          origins.push({ ox, oy })
          specs.push({ cw, ch, tx: Math.round(ox / devPerTwip), ty: Math.round(oy / devPerTwip), tw: Math.round(cw / devPerTwip), th: Math.round(ch / devPerTwip) })
        }
      }
    }

    windowOriginRef.current = { x: winDevX, y: winDevY }

    // Size the backing store (device px) + CSS display size + position FIRST, so
    // the doc stays interactive even if a later repaint supersedes this render.
    if (canvas.width !== winDevW) canvas.width = winDevW
    if (canvas.height !== winDevH) canvas.height = winDevH
    canvas.style.width = winDevW / dpr + 'px'
    canvas.style.height = winDevH / dpr + 'px'
    // Windowed: absolutely place the window canvas at its origin inside docWrap.
    // Impress: origin (0,0), covering the full doc-sized docWrap.
    canvas.style.left = winCssX + 'px'
    canvas.style.top = winCssY + 'px'

    const off = offscreenRef.current ?? (offscreenRef.current = document.createElement('canvas'))
    off.width = winDevW
    off.height = winDevH
    const octx = off.getContext('2d')
    if (!octx) return

    // ── The cache pass ──────────────────────────────────────────────────────
    // Draw every cached tile NOW (instant — no engine, no transport), then fetch
    // what's left: on the scroll path (refreshAll=false) only misses and
    // stale-generation hits; on content paints everything, with the cached
    // pixels standing in until the fresh ones land. This is what makes scrolling
    // back over rendered ground immediate and sheet switch-back near-free.
    const part = partRef?.current ?? 0
    const gen = docGenRef.current
    const cache = tileCacheRef.current
    const fetchIdx: number[] = []
    for (let i = 0; i < origins.length; i++) {
      const hit = cache.get({ part, zoom, dpr, tx: winDevX + origins[i].ox, ty: winDevY + origins[i].oy })
      if (hit) {
        octx.drawImage(hit.img, origins[i].ox, origins[i].oy)
        if (refreshAll || hit.gen !== gen) fetchIdx.push(i)
      } else {
        fetchIdx.push(i)
      }
    }
    // First swap: everything cached is on screen immediately.
    canvas.getContext('2d')?.drawImage(off, 0, 0)
    if (fetchIdx.length === 0) return

    // Fetch the remainder in batched round-trips ('B' frame): one renderer→main
    // IPC per chunk instead of one per tile.
    const tiles = await fetchTiles(fetchIdx.map((i) => specs[i]))
    if (token !== renderTokenRef.current) return // superseded
    for (let j = 0; j < tiles.length; j++) {
      const i = fetchIdx[j]
      const img = tileToImageData(octx, tiles[j])
      if (!img) continue
      octx.putImageData(img, origins[i].ox, origins[i].oy)
      cacheTile(img, winDevX + origins[i].ox, winDevY + origins[i].oy, gen)
    }
    if (token !== renderTokenRef.current) return
    const ctx = canvas.getContext('2d')
    ctx?.drawImage(off, 0, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileToImageData, cacheTile, fetchTiles])

  // Region repaint — redraw only the tile under (twX,twY) directly onto the
  // visible canvas, for instant feedback while typing (no full-doc redraw).
  const paintCursorRegion = useCallback(async (twX: number, twY: number) => {
    const canvas = canvasRef.current
    if (!canvas || !Number.isFinite(twX) || !Number.isFinite(twY)) return
    // Work in device px — the backing store is sized at CSS × dpr (see paint()).
    const devPerTwip = pxPerTwipRef.current * (window.devicePixelRatio || 1)
    const win = windowOriginRef.current
    // Tile-align the ABSOLUTE device position, then shift into WINDOW-local
    // canvas coords (win is {0,0} for Writer/Impress → unchanged there).
    const axo = Math.max(0, Math.floor((twX * devPerTwip) / TILE) * TILE)
    const ayo = Math.max(0, Math.floor((twY * devPerTwip) / TILE) * TILE)
    const ox = axo - win.x
    const oy = ayo - win.y
    // Outside the painted window (Calc scrolled away): nothing to do.
    if (ox < 0 || oy < 0 || ox >= canvas.width || oy >= canvas.height) return
    const cw = Math.min(TILE, canvas.width - ox)
    const ch = Math.min(TILE, canvas.height - oy)
    if (cw <= 0 || ch <= 0) return
    const tile = await window.workspace.lok.tile({
      cw, ch,
      tx: Math.round(axo / devPerTwip),
      ty: Math.round(ayo / devPerTwip),
      tw: Math.round(cw / devPerTwip),
      th: Math.round(ch / devPerTwip),
    })
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const img = tileToImageData(ctx, tile)
    if (!img) return
    ctx.putImageData(img, ox, oy)
    const octx = offscreenRef.current?.getContext('2d')
    if (octx) octx.putImageData(img, ox, oy) // keep buffer in sync
    cacheTile(img, axo, ayo, docGenRef.current) // fresh pixels → fresh cache
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileToImageData, cacheTile])

  // Repaint only the tiles overlapping a dirty rect (twips) — onto both the
  // visible canvas and the offscreen buffer. The engine tells us exactly what
  // changed, so a shape move / formatting change costs a few tiles, not a
  // whole-document re-render. Clamped to the canvas, so an "invalidate all"
  // (huge rect) degrades gracefully to a full visible repaint.
  const paintRegion = useCallback(async (twX: number, twY: number, twW: number, twH: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const devPerTwip = pxPerTwipRef.current * (window.devicePixelRatio || 1)
    const win = windowOriginRef.current
    // Absolute tile-aligned device rect, then clamp into WINDOW-local canvas
    // coords (win is {0,0} for Writer/Impress). A dirty rect scrolled off a
    // Calc window clamps to empty and paints nothing — correct.
    const ax0 = Math.max(win.x, Math.floor((twX * devPerTwip) / TILE) * TILE)
    const ay0 = Math.max(win.y, Math.floor((twY * devPerTwip) / TILE) * TILE)
    const ax1 = Math.min(win.x + canvas.width, Math.ceil(((twX + twW) * devPerTwip) / TILE) * TILE)
    const ay1 = Math.min(win.y + canvas.height, Math.ceil(((twY + twH) * devPerTwip) / TILE) * TILE)
    if (ax1 <= ax0 || ay1 <= ay0) return
    // Snapshot the current full-paint token; if a full repaint supersedes us
    // mid-flight, drop our now-stale tiles. We don't bump it (region paints
    // don't cancel each other — they carry current engine data).
    const token = renderTokenRef.current
    const origins: { ox: number; oy: number }[] = []
    const specs: { cw: number; ch: number; tx: number; ty: number; tw: number; th: number }[] = []
    for (let ay = ay0; ay < ay1; ay += TILE) {
      for (let ax = ax0; ax < ax1; ax += TILE) {
        const ox = ax - win.x // window-local canvas position
        const oy = ay - win.y
        const cw = Math.min(TILE, canvas.width - ox)
        const ch = Math.min(TILE, canvas.height - oy)
        if (cw <= 0 || ch <= 0) continue
        origins.push({ ox, oy })
        specs.push({ cw, ch, tx: Math.round(ax / devPerTwip), ty: Math.round(ay / devPerTwip), tw: Math.round(cw / devPerTwip), th: Math.round(ch / devPerTwip) })
      }
    }
    const tiles = await fetchTiles(specs)
    if (token !== renderTokenRef.current) return // a full paint superseded us
    const ctx = canvas.getContext('2d')
    const octx = offscreenRef.current?.getContext('2d')
    for (let i = 0; i < tiles.length; i++) {
      if (!ctx) continue
      const img = tileToImageData(ctx, tiles[i])
      if (!img) continue
      ctx.putImageData(img, origins[i].ox, origins[i].oy)
      if (octx) octx.putImageData(img, origins[i].ox, origins[i].oy) // keep the buffer in sync for the next full paint
      cacheTile(img, win.x + origins[i].ox, win.y + origins[i].oy, docGenRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileToImageData, cacheTile, fetchTiles])

  // Union a dirty rect into the pending region and flush once on the next frame,
  // so a burst of invalidates (a drag emits many) costs one coalesced repaint.
  const scheduleRegionRepaint = useCallback((x: number, y: number, w: number, h: number) => {
    const d = dirtyRectRef.current
    if (!d) dirtyRectRef.current = { x, y, w, h }
    else {
      const nx = Math.min(d.x, x), ny = Math.min(d.y, y)
      const x2 = Math.max(d.x + d.w, x + w), y2 = Math.max(d.y + d.h, y + h)
      dirtyRectRef.current = { x: nx, y: ny, w: x2 - nx, h: y2 - ny }
    }
    if (dirtyRafRef.current != null) return
    dirtyRafRef.current = requestAnimationFrame(() => {
      dirtyRafRef.current = null
      const r = dirtyRectRef.current
      dirtyRectRef.current = null
      if (r) void paintRegion(r.x, r.y, r.w, r.h)
    })
  }, [paintRegion])

  // Fire the pending settle: full-paint if escalated (or the accumulated dirty
  // band covers so much of the doc that region-fetching saves nothing — see
  // chooseSettleMode), else a bounded region paint of just the dirty band. One
  // exit point for both scheduleRepaint and scheduleFullPaint so they can never
  // race two engine-blocking repaints against each other.
  const runSettle = useCallback(() => {
    settleTimer.current = null
    const band = settleBandRef.current
    const full = settleFullRef.current
    settleBandRef.current = null
    settleFullRef.current = false
    const doc = docRef.current
    if (full || chooseSettleMode(band, doc) === 'full' || !band) { void paint(); return }
    void paintRegion(band.x, band.y, band.w, band.h)
  }, [paint, paintRegion])

  // Schedule (or coalesce into) the single settle timer at the given delay. A
  // shorter requested delay wins so an urgent pass isn't held back by a lazy one.
  const armSettle = useCallback((ms: number) => {
    if (settleTimer.current) clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(runSettle, ms)
  }, [runSettle])

  // On edit, repaint the cursor tile immediately for instant feedback, then a
  // short debounced SETTLE pass to catch reflow. This build doesn't emit
  // INVALIDATE_TILES on text edits, so the settle is what lands wrapped/reflowed
  // glyphs — but it only needs to cover the caret's line and a few lines below,
  // not the whole document. So it accumulates a bounded REGION band (full doc
  // width for line-wrap × a band around the caret) into the shared settle; only
  // an unknown caret escalates to a full paint. Resets on each keystroke, so
  // fast typing still coalesces to one settle.
  const scheduleRepaint = useCallback(() => {
    // The document changed: older cached tiles are now a stale generation —
    // still drawable instantly, but scroll paints will refresh them async.
    docGenRef.current++
    const c = caretTwRef.current
    if (c) void paintCursorRegion(c.x, c.y)
    const cc = caretTwRef.current
    const doc = docRef.current
    if (cc && doc) {
      const BAND_UP = 400 // twips above the caret
      const BAND_DOWN = 2600 // ~1.8in below → a few lines of reflow headroom
      const y0 = Math.max(0, cc.y - BAND_UP)
      const y1 = Math.min(doc.h, cc.y + BAND_DOWN)
      const b = { x: 0, y: y0, w: doc.w, h: y1 - y0 }
      // Union into any pending band so a full-paint escalation isn't downgraded.
      const p = settleBandRef.current
      if (!p) settleBandRef.current = b
      else {
        const nx = Math.min(p.x, b.x), ny = Math.min(p.y, b.y)
        const x2 = Math.max(p.x + p.w, b.x + b.w), y2 = Math.max(p.y + p.h, b.y + b.h)
        settleBandRef.current = { x: nx, y: ny, w: x2 - nx, h: y2 - ny }
      }
    } else {
      settleFullRef.current = true // caret unknown → can't bound the reflow
    }
    armSettle(90)
    // Refresh slide thumbnails after edits settle (no-op when not Impress).
    if (thumbTimer.current) clearTimeout(thumbTimer.current)
    thumbTimer.current = setTimeout(() => setThumbsKey((k) => k + 1), 900)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintCursorRegion, armSettle])

  // Debounced settle for selection highlights and structural changes that span
  // more than the cursor's tile — escalates the shared settle to a FULL paint.
  // (Kept as a distinct name so callers signal "this changed more than a line";
  // it no longer runs its own competing timer.)
  const scheduleFullPaint = useCallback((ms = 50) => {
    docGenRef.current++ // callers signal a change spanning more than a line
    settleFullRef.current = true
    armSettle(ms)
  }, [armSettle])

  // Cancel the pending settle. Used when a plain click only SELECTS a shape:
  // nothing in the document reflowed, so a settle repaint would only bake the
  // engine's (redundant, laggy) in-tile selection frame under our instant DOM
  // overlay. Cancelling it keeps the overlay as the single selection indicator.
  const cancelSettleRepaint = useCallback(() => {
    if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current = null }
    settleBandRef.current = null
    settleFullRef.current = false
  }, [])

  // Re-window on scroll (Calc only). paint() reads the live scroll position, so
  // a scroll past the prefetch margin just needs a repaint. THROTTLE with a
  // trailing edge, not a plain debounce: during a continuous drag-auto-scroll
  // the view scrolls every frame, and a debounce would never fire until it
  // stopped — leaving the newly-exposed rows blank the whole time. A throttle
  // paints periodically DURING the scroll and once more when it settles. The
  // 2-tile margin still covers small scrolls without any repaint. No-op for
  // Writer/Impress (whole doc always painted).
  const lastWindowPaintRef = useRef(0)
  const scrollRepaintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleWindowRepaint = useCallback((ms = 60) => {
    if (!(windowedRef?.current)) return
    const now = performance.now()
    const since = now - lastWindowPaintRef.current
    if (since >= ms) {
      lastWindowPaintRef.current = now
      void paint(false) // scroll: cached tiles are final; fetch only the gaps
    } else if (!scrollRepaintTimer.current) {
      scrollRepaintTimer.current = setTimeout(() => {
        scrollRepaintTimer.current = null
        lastWindowPaintRef.current = performance.now()
        void paint(false)
      }, ms - since)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint])

  // ── Cache maintenance (wired to the engine's invalidations by the renderer) ─
  const evictTiles = useCallback((x: number, y: number, w: number, h: number, part?: number) => {
    tileCacheRef.current.evictTwipsRect(part ?? partRef?.current ?? 0, x, y, w, h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const evictTilePart = useCallback((part?: number) => {
    tileCacheRef.current.evictPart(part ?? partRef?.current ?? 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const clearTileCache = useCallback(() => {
    tileCacheRef.current.clear()
    docGenRef.current++
  }, [])

  return { paint, paintRegion, scheduleRepaint, scheduleFullPaint, scheduleRegionRepaint, scheduleWindowRepaint, evictTiles, evictTilePart, clearTileCache, cancelSettleRepaint, pxPerTwipRef, zoomRef, dirtyRectRef, dirtyRafRef }
}
