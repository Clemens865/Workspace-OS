# Calc Viewport Tiling — Plan

*2026-08-29. Fixes the long-standing Calc render slowness: large sheets slow to
open, sheet-switch re-renders everything. Root cause and reference-architecture
analysis precede this; here is the chosen implementation and why it is safe
where the 2026-07 attempt (reverted in `542bc0c`) was not.*

## Root cause (confirmed)

`paint()` (useLokPaint.ts) tiles the **entire used range** into a
**document-sized canvas**, on open and on every sheet switch, with no viewport
windowing, no per-sheet cache, and no scroll-driven fetch. A 26-col × 500-row
sheet is ~300 tiles (512² px, 1 MiB each) ≈ 300 MB and hundreds of sequential
blocking engine calls — per open, per zoom, per sheet switch. LOK reports the
used-range size (not the 1M-row grid), so cost scales with data size, not
screen size. This is the one thing both "originals" avoid: desktop LibreOffice
paints only the viewport (VCL); Collabora Online windows the tiles + caches
them per part. We took the LOK path but skipped the windowing half.

## Why the last attempt was reverted, and how this differs

`542bc0c` reverted `tileCache.ts` + `viewportTiles.ts` (−964 lines) because
they broke initial `.pptx` render ("stuck on Rendering…"). That work was
Impress-zoom-motivated and changed the **shared canvas model** for all doc
types. This plan is the opposite in two ways:

1. **Calc-only.** Writer pages and Impress slides are small and bounded — they
   keep the current full-doc paint untouched. The change is gated behind
   `isCalc`. The `.pptx` path cannot regress because it is not touched.
2. **Window the canvas, not the layout.** `docWrap` stays document-sized (the
   scroll spacer that gives correct scrollbars) and **every overlay stays in
   document coordinates, unchanged** — cell cursor, selection rects, headers,
   live-link markers, pen overlay. Only the `<canvas>` becomes viewport-sized
   and is translated to the scroll offset. This decouples *layout size* (doc,
   drives overlays) from *canvas backing size* (viewport, drives paint), so the
   coordinate rewiring that killed the last attempt is confined to the paint
   functions alone.

## Architecture

```
.calcGrid (scroll container, overflow:auto)
  ├─ CalcHeaders (sticky, doc-coordinate — unchanged)
  └─ docWrap  (position:relative, size = DOC px — the scroll spacer)
       ├─ <canvas.page>   position:absolute; size = VIEWPORT+margin (device px);
       │                  transform: translate(winOriginCssX, winOriginCssY)
       │                  → stays in view as docWrap scrolls; painted with only
       │                    the tiles under the current scroll window
       └─ overlays (cellCursor, selRects, liveCells, pen) — doc-coordinate
                    absolute, UNCHANGED; scroll naturally with docWrap
```

On scroll of `.calcGrid`: debounced repaint of the window when the scroll moves
beyond the painted margin. On open / `goToPart` / zoom: paint the window at the
current scroll (top-left for a fresh open) — ~12–20 tiles regardless of sheet
size.

## The pure core (testable in isolation, like `chooseSettleMode`)

`computeCalcWindow({ scrollLeftPx, scrollTopPx, clientWpx, clientHpx, docWpx,
docHpx, devPerCssPx, TILE, marginTiles })` → `{ devX, devY, devW, devH,
cssX, cssY, specs[] }`:

- Tile-align the scroll origin down and the far edge up to `TILE` multiples in
  **device px**; clamp to the doc extent; add `marginTiles` of prefetch on each
  side. `devX/devY` = window origin (device px, tile-aligned); `cssX/cssY` =
  the same in CSS px for the canvas `transform`. `specs` = tile requests
  (device-px size + twip source rect), the same shape `fetchTiles` takes today.

Region paints (`paintRegion`, `paintCursorRegion`) subtract the window origin
when Calc, so a doc-twip rect maps to window-relative canvas px. Non-Calc paths
keep origin (0,0) — i.e. today's behavior — via a `windowOriginRef` that is
`{0,0}` for Writer/Impress.

## Steps

1. **Pure `computeCalcWindow` + unit tests** (window math, tile-alignment,
   clamping at doc edges, margin, an out-of-range scroll). No engine.
2. **useLokPaint**: `paint()` branches on `isCalcRef` — Calc computes the
   window, sizes the canvas to it, sets `windowOriginRef`, fetches only window
   specs, and translates the canvas; Writer/Impress unchanged. `setPxSize`
   stays **doc size** for Calc (overlays/headers depend on it). Region paints
   subtract `windowOriginRef`.
3. **LokRenderer**: pass `isCalc` + the `.calcGrid` scroll element to
   useLokPaint; add a debounced scroll listener that repaints the window;
   canvas gets `position:absolute` + transform for Calc via a modifier class.
4. **Real-engine e2e** (`e2e/office/AG-calc-viewport.mjs`): author a wide/tall
   fixture (e.g. 40 cols × 2000 rows), open it, assert first paint is bounded
   (tile count / time), scroll and assert new tiles arrive, switch between two
   sheets and assert both render and the switch is bounded. The negative case:
   confirm a cell far down the sheet is NOT painted until scrolled to.
5. **Ship** only on green real-engine e2e (house rule — this class of change
   looks done before it is).

## Deferred (not needed for the two reported symptoms)

- **Per-(sheet,zoom) tile cache.** Viewport windowing alone makes a switch
  paint only ~20 tiles, which is already fast — it fixes "reloads everything."
  A cache makes switch-back *instant* rather than *fast*; a clean follow-up
  once windowing is proven, and it wants the window as its cache unit anyway.
- **Progressive/blurry-then-sharp zoom.** Independent; out of scope.

## Risks

- **Coordinate drift** between the windowed canvas and doc-coordinate overlays
  — the whole reason the pure window function is unit-tested and the e2e
  asserts cursor/selection alignment after a scroll.
- **Scroll-repaint thrash** on fast scroll — debounce + a one-tile margin so
  small scrolls reuse the painted window; only cross-margin scrolls repaint.
- **Header sync** — `CalcHeaders` already reads doc coords + geometry; it is
  untouched, so it stays aligned by construction. Verified in the e2e.
