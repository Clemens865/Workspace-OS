# Office canvas — measured interaction latency

Branch `spike/vector-rendering`. Real pptx (`deck.pptx`, 15-tile canvas 2560x1440 @ dpr 2) driven through the packaged Electron build via Playwright. 20 samples/scenario. All times ms. Re-measured after shipping the 3 non-rewrite wins (`node e2e/latency-probe.mjs`).

## BEFORE → AFTER (P50 / P95 / max)

| Scenario | P50 before→after | P95 before→after | max before→after | win |
|---|---|---|---|---|
| 1. click → selection overlay | 41 → 30 | 108 → 97 | 108 → 97 | (untouched; engine round-trip + variance) |
| 2. click → canvas settle | 0 → 0 | 0 → 0 | 0 → 0 | (already 0) |
| 3. keystroke → pixel | 22 → 22 | **314 → 166** | **314 → 166** | **#1 + #3 (−148ms P95)** |
| 4. shape-move drag → settle | 130 → 120 | **215 → 142** | **215 → 142** | **#2 (−73ms P95)** |

**Net:** keystroke→pixel P95 dropped **148ms** (−47%); drag→settle P95 dropped **73ms** (−34%). Both from the debounce cut + region repaints — zero engine change. The instant cursor-region feedback (P50 keystroke 22ms) is unchanged, and the drag/select overlay is still instant.

## What shipped

1. **[S] Keystroke settle debounce 220 → 90ms** (`useLokPaint.ts` `scheduleRepaint`). The cursor-tile region repaint already gives instant feedback; the settle only needs to catch reflow, so it fires far sooner. Still resets on each keystroke → fast typing coalesces to one settle.
2. **[S/M] Drag mouseup → region repaint, not full paint** (`LokRenderer.tsx` `onMouseUp` → new `settleShapeRegion`). On a move/resize commit we region-repaint the UNION of the shape's OLD bounds (`mv.orig`/`rz.orig`) and its committed NEW bounds (`graphicSelTwRef`) via `scheduleRegionRepaint`, after a 30ms settle (was `scheduleFullPaint(80)`). A few tiles (~15ms) replaces the 57ms full 15-tile paint. Correctness fallback: if the union spans > half the canvas (a huge drag), it falls back to a full paint.
3. **[M] Keystroke settle → bounded region repaint** (`useLokPaint.ts` `scheduleRepaint`). The debounced settle is now a `paintRegion` over a band around the caret (full doc width for line-wrap × ~caret−400 → caret+2600 twips of reflow headroom) instead of a whole-document `paint()`. This build doesn't emit INVALIDATE_TILES on text edits, so the settle is still what lands wrapped glyphs — but it only needs the caret's neighbourhood, not 15 tiles. Falls back to a full paint if the caret position is unknown.

## AFTER — P50 / P95 / max

| Scenario | P50 | P95 | max | n |
|---|---|---|---|---|
| 1. click → selection overlay | 30 | 97 | 97 | 20 |
| 2. click → canvas settle | 0 | 0 | 0 | 20 |
| 3. keystroke → pixel | 22 | 166 | 166 | 19 (1 drop) |
| 4. shape-move drag → settle | 120 | 142 | 142 | 20 |

## WHERE the time goes (synthetic, same engine/session)

- **Full repaint tile IPC** (batched, chunks of 6): **57 ms** for 15 tiles — the `window.workspace.lok.tiles` round-trip (renderer→main→host→engine paintTile→BGRA back).
- **Single cursor tile IPC**: **2.8 ms** — the `paintCursorRegion` immediate-feedback path on each keystroke.
- **BGRA→RGBA blit**: **0.83 ms/tile** → **13 ms** for a full repaint.
- **Region settle** now replaces the full paint on both keystroke (band around the caret) and drag (old+new union) — typically a few tiles (~15–25ms) instead of 57ms.

## Honest read

- **Win #1 + #3 (keystroke):** the biggest mover — 314 → 166ms P95. The 148ms drop is the 220 → 90ms debounce cut (~130ms of it) plus the smaller region-vs-full settle. Pure latency, zero engine cost.
- **Win #2 (drag):** 215 → 142ms P95, a real 73ms. The remaining ~120ms P50 floor is the engine processing the mouseup + the 30ms settle + the region tile round-trip — the engine's single-threaded move is the hard part, not our paint.
- **Floor that remains:** the engine's per-tile `paintTile` (~4ms/tile) is the hard round-trip cost — only a felt-layer/GPU rewrite removes it. But we now almost never pay a *full* 15-tile paint on interaction, so in practice the 57ms full-canvas cost is off the hot path.
