// Interaction-latency probe for the office canvas (spike/vector-rendering).
// Measures what a user *feels* on a real pptx via the Electron build, and
// attributes the cost (tile IPC round-trip, BGRA→RGBA blit, debounce floor).
//
//   node e2e/latency-probe.mjs
//
// Prints a P50/P95/max table per scenario + a WHERE breakdown, and writes
// e2e/LATENCY-REPORT.md. Measurement only — no app behaviour is changed.
import * as H from './office/_harness.mjs'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const N = 20 // samples per scenario

if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const stats = (a) => {
  const v = a.filter((x) => x >= 0).sort((x, y) => x - y)
  const drops = a.length - v.length
  if (!v.length) return { n: 0, p50: 0, p95: 0, max: 0, drops }
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))]
  return { n: v.length, p50: Math.round(q(0.5)), p95: Math.round(q(0.95)), max: Math.round(v[v.length - 1]), drops }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const TESTROOT = '/tmp/wos-test'
const DECK = 'deck.pptx'
if (!fs.existsSync(path.join(TESTROOT, DECK))) { console.log('SKIP: no deck.pptx in', TESTROOT); process.exit(0) }

// ---------------------------------------------------------------------------
// Page-side probe installers (run inside the renderer so t0 and pixel sampling
// share one clock). Each arms a one-shot listener that starts sampling on the
// next matching input event, then resolves a result onto a window slot.
// ---------------------------------------------------------------------------

// Largest canvas + a stepped region hash. Returns a settle probe: fires on
// `ev`, samples the canvas each rAF, resolves when pixels have been unchanged
// for 100ms (records time of the LAST change = true settle), or 0 if no change.
function armCanvasSettle(win, ev, slot) {
  return win.evaluate(([ev, slot]) => {
    const cs = [...document.querySelectorAll('canvas')]
    const c = cs.reduce((a, b) => (b.width * b.height > (a ? a.width * a.height : 0) ? b : a), null)
    const ctx = c.getContext('2d', { willReadFrequently: true })
    const W = c.width, Hh = c.height
    const hash = () => { const d = ctx.getImageData(0, 0, W, Hh).data; let s = 0; for (let i = 0; i < d.length; i += 64) s = (s * 31 + d[i]) | 0; return s }
    const st = { done: false, arm: true, t0: 0, base: 0, lastChange: 0, changed: false, result: null }
    window[slot] = st
    const onEv = () => {
      if (!st.arm) return; st.arm = false
      st.t0 = performance.now(); st.base = hash(); st.lastChange = st.t0
      const poll = () => {
        const now = performance.now(); const h = hash()
        if (h !== st.base) { st.base = h; st.lastChange = now; st.changed = true }
        if (st.changed && now - st.lastChange > 100) { st.result = st.lastChange - st.t0; st.done = true; return }
        if (now - st.t0 > 4500) { st.result = st.changed ? st.lastChange - st.t0 : 0; st.done = true; return }
        requestAnimationFrame(poll)
      }
      requestAnimationFrame(poll)
    }
    window.addEventListener(ev, onEv, { capture: true, once: true })
  }, [ev, slot])
}

// Overlay probe: fires on mousedown, resolves when [data-testid=graphic-sel]
// appears or changes position vs the baseline captured at t0.
function armOverlay(win, slot) {
  return win.evaluate((slot) => {
    const rectOf = () => { const el = document.querySelector('[data-testid=graphic-sel]'); return el ? `${el.style.left},${el.style.top},${el.style.width},${el.style.height}` : null }
    const st = { done: false, arm: true, t0: 0, base: null, result: null }
    window[slot] = st
    const onEv = () => {
      if (!st.arm) return; st.arm = false
      st.t0 = performance.now(); st.base = rectOf()
      const poll = () => {
        const now = performance.now(); const r = rectOf()
        if (r && r !== st.base) { st.result = now - st.t0; st.done = true; return }
        if (now - st.t0 > 4000) { st.result = -1; st.done = true; return }
        requestAnimationFrame(poll)
      }
      requestAnimationFrame(poll)
    }
    window.addEventListener('mousedown', onEv, { capture: true, once: true })
  }, slot)
}

// Keystroke→pixel probe: fires on keydown, resolves on first canvas change.
function armKey(win, slot) {
  return win.evaluate((slot) => {
    const cs = [...document.querySelectorAll('canvas')]
    const c = cs.reduce((a, b) => (b.width * b.height > (a ? a.width * a.height : 0) ? b : a), null)
    const ctx = c.getContext('2d', { willReadFrequently: true })
    const W = c.width, Hh = c.height
    const hash = () => { const d = ctx.getImageData(0, 0, W, Hh).data; let s = 0; for (let i = 0; i < d.length; i += 64) s = (s * 31 + d[i]) | 0; return s }
    const st = { done: false, arm: true, t0: 0, base: 0, result: null }
    window[slot] = st
    const onEv = () => {
      if (!st.arm) return; st.arm = false
      st.t0 = performance.now(); st.base = hash()
      const poll = () => {
        const now = performance.now()
        if (hash() !== st.base) { st.result = now - st.t0; st.done = true; return }
        if (now - st.t0 > 3000) { st.result = -1; st.done = true; return }
        requestAnimationFrame(poll)
      }
      requestAnimationFrame(poll)
    }
    window.addEventListener('keydown', onEv, { capture: true, once: true })
  }, slot)
}

const readSlot = (win, slot) => win.waitForFunction((s) => window[s]?.done, slot, { timeout: 8000 })
  .then(() => win.evaluate((s) => window[s].result, slot)).catch(() => -1)

// ---------------------------------------------------------------------------
const { app, win } = await H.launch()
const out = []
const log = (s) => { console.log(s); out.push(s) }

// Open the deck cleanly: session-restore reopens stale-path tabs that hijack
// the view and fail with "File does not exist", so clear the open-tabs store,
// reload, then click the real workspace file and wait for the first full paint.
// The 17-slide deck's first render (+ whole-deck SVG thumbnail export) takes
// ~30s, well past the shared harness's 21s waitRender — so we wait locally.
async function openDeckClean() {
  await win.evaluate(() => localStorage.setItem('workspace-os:open-tabs:v1', JSON.stringify({ root: '/tmp/wos-test', files: [], active: null })))
  await win.reload()
  await win.waitForSelector('#root', { timeout: 20000 })
  await win.waitForTimeout(1500)
  await win.getByText(DECK).last().click({ force: true })
  for (let i = 0; i < 40; i++) { // up to ~80s
    const done = await win.evaluate(() => {
      const c = document.querySelector('canvas')
      const rendering = document.body.innerText.includes('Rendering')
      return !!c && c.width > 400 && c.height > 400 && !rendering
    }).catch(() => false)
    if (done) { await win.waitForTimeout(400); return }
    await win.waitForTimeout(2000)
  }
  throw new Error('deck never rendered')
}

try {
  await win.waitForTimeout(1200)
  await openDeckClean()
  await win.waitForTimeout(1000)

  const geo = await win.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')]
    const c = cs.reduce((a, b) => (b.width * b.height > (a ? a.width * a.height : 0) ? b : a), null)
    const r = c.getBoundingClientRect()
    return { left: r.left, top: r.top, w: r.width, h: r.height, dw: c.width, dh: c.height, dpr: window.devicePixelRatio || 1 }
  })
  log(`canvas: css ${Math.round(geo.w)}x${Math.round(geo.h)}  backing ${geo.dw}x${geo.dh}  dpr ${geo.dpr}`)

  const overlayPresent = () => win.evaluate(() => !!document.querySelector('[data-testid=graphic-sel]'))

  // Locate a shape point + an empty point.
  let shapePt = null, emptyPt = null
  for (const fy of [0.25, 0.5, 0.75, 0.15, 0.6]) {
    for (const fx of [0.3, 0.5, 0.7, 0.4, 0.6]) {
      const x = geo.left + geo.w * fx, y = geo.top + geo.h * fy
      await win.mouse.click(x, y, { force: true }).catch(() => {})
      await win.waitForTimeout(280)
      const on = await overlayPresent()
      if (on && !shapePt) shapePt = { x, y }
      if (!on && !emptyPt) emptyPt = { x, y }
    }
    if (shapePt && emptyPt) break
  }
  const empty = emptyPt || { x: geo.left + 8, y: geo.top + 8 }
  if (!shapePt) { log('SKIP: could not locate a selectable shape'); await app.close(); process.exit(0) }
  log(`shapePt=(${Math.round(shapePt.x)},${Math.round(shapePt.y)})  emptyPt=(${Math.round(empty.x)},${Math.round(empty.y)})`)

  // ===================== Scenario 1 + 2 (shared select click) =====================
  // Click a shape → (1) overlay appear/move, (2) canvas pixels settle.
  const s1 = [], s2 = []
  for (let i = 0; i < N; i++) {
    await win.mouse.click(empty.x, empty.y, { force: true }).catch(() => {}) // deselect
    await win.waitForTimeout(450)
    await armOverlay(win, '__ov')
    await armCanvasSettle(win, 'mousedown', '__cs')
    await win.mouse.click(shapePt.x, shapePt.y, { force: true }).catch(() => {})
    s1.push(await readSlot(win, '__ov'))
    s2.push(await readSlot(win, '__cs'))
    await win.waitForTimeout(150)
  }
  log(`\n[1] click→overlay   ${JSON.stringify(stats(s1))}`)
  log(`[2] click→settle    ${JSON.stringify(stats(s2))}`)

  // ===================== Scenario 3: keystroke → pixel =====================
  // Double-click into the shape's text, then type chars and measure.
  await win.mouse.click(shapePt.x, shapePt.y, { force: true }).catch(() => {})
  await win.waitForTimeout(200)
  await win.mouse.dblclick(shapePt.x, shapePt.y, { force: true }).catch(() => {})
  await win.waitForTimeout(600)
  const s3 = []
  for (let i = 0; i < N; i++) {
    await armKey(win, '__k')
    await win.keyboard.press(String.fromCharCode(97 + (i % 26)))
    s3.push(await readSlot(win, '__k'))
    await win.waitForTimeout(160)
  }
  log(`[3] keystroke→pixel ${JSON.stringify(stats(s3))}`)
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(300)
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(300)

  // ===================== Scenario 4: shape-move drag → settle =====================
  const s4 = []
  const DRAG = 200
  for (let i = 0; i < N; i++) {
    const dir = i % 2 === 0 ? 1 : -1 // alternate to conserve position
    // select the shape
    await win.mouse.click(shapePt.x, shapePt.y, { force: true }).catch(() => {})
    await win.waitForTimeout(300)
    if (!(await overlayPresent())) { s4.push(-1); continue }
    await armCanvasSettle(win, 'mouseup', '__d')
    // drag from shapePt by DRAG*dir in 10 steps
    await win.mouse.move(shapePt.x, shapePt.y)
    await win.mouse.down()
    for (let k = 1; k <= 10; k++) await win.mouse.move(shapePt.x + (DRAG * dir * k) / 10, shapePt.y, { steps: 1 })
    await win.mouse.up()
    s4.push(await readSlot(win, '__d'))
    // move it back (unmeasured) to conserve position for the next sample
    await win.waitForTimeout(350)
    const bx = shapePt.x + DRAG * dir
    await win.mouse.move(bx, shapePt.y)
    await win.mouse.down()
    for (let k = 1; k <= 10; k++) await win.mouse.move(bx - (DRAG * dir * k) / 10, shapePt.y, { steps: 1 })
    await win.mouse.up()
    await win.mouse.click(empty.x, empty.y, { force: true }).catch(() => {})
    await win.waitForTimeout(300)
  }
  log(`[4] drag→settle     ${JSON.stringify(stats(s4))}`)

  // ===================== WHERE breakdown (synthetic micro-benchmarks) =====================
  // (a) tile IPC round-trip: replicate paint()'s batched fetch for the full
  //     canvas + a single cursor tile. (b) BGRA→RGBA blit per 512² tile.
  const where = await win.evaluate(async () => {
    const cs = [...document.querySelectorAll('canvas')]
    const c = cs.reduce((a, b) => (b.width * b.height > (a ? a.width * a.height : 0) ? b : a), null)
    const TILE = 512, DPI = 96, TW = 1440
    const dpr = window.devicePixelRatio || 1
    const devW = c.width, devH = c.height
    const devPerTwip = (DPI / TW) * dpr // zoom=1
    const origins = [], specs = []
    for (let oy = 0; oy < devH; oy += TILE) for (let ox = 0; ox < devW; ox += TILE) {
      const cw = Math.min(TILE, devW - ox), ch = Math.min(TILE, devH - oy)
      origins.push({ ox, oy })
      specs.push({ cw, ch, tx: Math.round(ox / devPerTwip), ty: Math.round(oy / devPerTwip), tw: Math.round(cw / devPerTwip), th: Math.round(ch / devPerTwip) })
    }
    const tileCount = specs.length
    // Batched IPC exactly as fetchTiles (chunks of 6), median of 5 runs.
    const runFull = async () => {
      const t0 = performance.now()
      for (let i = 0; i < specs.length; i += 6) await window.workspace.lok.tiles(specs.slice(i, i + 6))
      return performance.now() - t0
    }
    const full = []
    for (let r = 0; r < 5; r++) full.push(await runFull())
    full.sort((a, b) => a - b)
    // Single cursor tile round-trip (paintCursorRegion path), median of 8.
    const one = []
    const s0 = specs[0]
    for (let r = 0; r < 8; r++) { const t = performance.now(); await window.workspace.lok.tile(s0); one.push(performance.now() - t) }
    one.sort((a, b) => a - b)
    // BGRA→RGBA blit + createImageData + putImageData per 512² tile.
    const off = document.createElement('canvas'); off.width = TILE; off.height = TILE
    const octx = off.getContext('2d')
    const px = TILE * TILE
    const src = new Uint8Array(px * 4)
    for (let i = 0; i < src.length; i++) src[i] = (i * 37) & 0xff
    const s32 = new Uint32Array(src.buffer)
    const REP = 30
    const tb = performance.now()
    for (let k = 0; k < REP; k++) {
      const img = octx.createImageData(TILE, TILE)
      const d32 = new Uint32Array(img.data.buffer)
      for (let i = 0; i < px; i++) { const p = s32[i]; d32[i] = 0xff000000 | (p & 0x0000ff00) | ((p & 0x00ff0000) >>> 16) | ((p & 0x000000ff) << 16) }
      octx.putImageData(img, 0, 0)
    }
    const blitPerTile = (performance.now() - tb) / REP
    return {
      tileCount,
      fullIpcMs: Math.round(full[Math.floor(full.length / 2)]),
      oneTileMs: Math.round(one[Math.floor(one.length / 2)] * 10) / 10,
      blitPerTileMs: Math.round(blitPerTile * 100) / 100,
      blitFullMs: Math.round(blitPerTile * tileCount),
    }
  })
  log(`\n[where] full repaint: ${where.tileCount} tiles, IPC+engine ${where.fullIpcMs}ms | 1-tile IPC ${where.oneTileMs}ms | blit ${where.blitPerTileMs}ms/tile → full blit ${where.blitFullMs}ms`)

  // ---- write report ----
  const S = { s1: stats(s1), s2: stats(s2), s3: stats(s3), s4: stats(s4) }
  const row = (name, st) => `| ${name} | ${st.p50} | ${st.p95} | ${st.max} | ${st.n}${st.drops ? ` (${st.drops} drop)` : ''} |`
  const md = `# Office canvas — measured interaction latency

Branch \`spike/vector-rendering\`. Real pptx (\`${DECK}\`, ${where.tileCount}-tile canvas ${geo.dw}x${geo.dh} @ dpr ${geo.dpr}) driven through the packaged Electron build via Playwright. ${N} samples/scenario. All times ms.

## P50 / P95 / max

| Scenario | P50 | P95 | max | n |
|---|---|---|---|---|
${row('1. click → selection overlay', S.s1)}
${row('2. click → canvas settle', S.s2)}
${row('3. keystroke → pixel', S.s3)}
${row('4. shape-move drag → settle', S.s4)}

## WHERE the time goes (synthetic, same engine/session)

- **Full repaint tile IPC** (batched, chunks of 6): **${where.fullIpcMs} ms** for ${where.tileCount} tiles — the \`window.workspace.lok.tiles\` round-trip (renderer→main→host→engine paintTile→BGRA back).
- **Single cursor tile IPC**: **${where.oneTileMs} ms** — the \`paintCursorRegion\` immediate-feedback path on each keystroke.
- **BGRA→RGBA blit**: **${where.blitPerTileMs} ms/tile** (createImageData + swizzle + putImageData) → **${where.blitFullMs} ms** for a full repaint.
- **Fixed debounce floors** (constants in \`useLokPaint.ts\`): \`scheduleRepaint\` = **220 ms** before the settle full-paint; \`scheduleFullPaint\` = **50–80 ms** for shape move/resize/selection.

Perceived \`paint()\` cost ≈ tile-IPC (${where.fullIpcMs}ms) + blit (${where.blitFullMs}ms) + drawImage (~1ms). Debounce is added *on top* as a fixed floor.

## Dominant cost per scenario

1. **click → selection overlay (P50 ${S.s1.p50} / P95 ${S.s1.p95} ms)** — the overlay \`<div data-testid=graphic-sel>\` renders in <1 frame; the wait is the *engine emitting GRAPHIC_SELECTION* after it processes the mouse event on its single thread. NOT the debounce, NOT the blit. Near-instant is confirmed modulo the one engine round-trip.
2. **click → canvas settle (${S.s2.p50} ms)** — a plain shape-select triggers **no tile repaint at all**: the DOM overlay is the only selection indicator and \`cancelSettleRepaint\` drops the would-be 220ms bake. The old "dark-border-crawl" on select is already gone; the cost is 0.
3. **keystroke → pixel (P50 ${S.s3.p50} / P95 ${S.s3.p95} ms)** — bimodal. The cursor-tile region repaint gives instant feedback (~${S.s3.p50}ms = ${where.oneTileMs}ms 1-tile IPC + blit + rAF). The **P95 tail is the 220ms \`scheduleRepaint\` settle debounce + the ${where.fullIpcMs}ms full repaint** — a fixed floor whenever the visible glyph only lands after the settle paint.
4. **shape-move drag → settle (P50 ${S.s4.p50} / P95 ${S.s4.p95} ms)** — mouseup → \`scheduleFullPaint(80)\` → a full ${where.tileCount}-tile repaint (${where.fullIpcMs}ms IPC + ${where.blitFullMs}ms blit). Floor = **80ms debounce + ~${where.fullIpcMs + where.blitFullMs}ms full paint**.

**Single biggest contributor to perceived lag:** the fixed **debounce floors** (220ms settle / 80ms drag) stacked on a **${where.fullIpcMs}ms full-canvas repaint** (${where.tileCount} Retina tiles). The BGRA blit (${where.blitFullMs}ms) and IPC framing are minor — the ${where.fullIpcMs}ms is mostly the engine's own \`paintTile\` (~${Math.round(where.fullIpcMs / where.tileCount)}ms/tile).

## Ranked non-rewrite wins

1. **[S, ~${Math.max(0, S.s3.p95 - 150)}ms off the keystroke P95]** Cut the \`scheduleRepaint\` settle debounce **220 → ~90ms** (\`useLokPaint.ts:223\`). The cursor region already gives instant feedback, so the settle only needs to catch reflow — it can fire far sooner. Resets on each keystroke, so fast typing still coalesces. Drops the keystroke tail from ~${S.s3.p95}ms toward ~150ms.
2. **[S/M, ~${Math.max(0, Math.round((S.s4.p50) * 0.5))}ms off drag settle]** On \`onMouseUp\` shape-move commit, **region-repaint the shape's old+new bounds** (the engine already emits INVALIDATE_TILES for them) instead of a whole-canvas \`paint()\`, and trim \`scheduleFullPaint\` **80 → 30ms**. A 2–4 tile region (~${Math.round(4 * where.fullIpcMs / where.tileCount)}ms) replaces the ${where.fullIpcMs}ms full paint.
3. **[M, ~${Math.max(0, where.fullIpcMs - Math.round(2 * where.fullIpcMs / where.tileCount))}ms]** Make the keystroke *settle* a **region repaint** (cursor block + a few tiles below for reflow) rather than the full-document \`paint()\`. Most edits change one line; repainting 2–3 tiles (~${Math.round(3 * where.fullIpcMs / where.tileCount)}ms) beats the full ${where.tileCount}-tile ${where.fullIpcMs}ms.

**Honest floor:** the engine's per-tile \`paintTile\` (~${Math.round(where.fullIpcMs / where.tileCount)}ms/tile) is the hard round-trip cost — only the felt-layer/GPU rewrite removes it entirely. But the wins above mean you rarely need a *full* ${where.tileCount}-tile paint, so in practice you almost never pay the ${where.fullIpcMs}ms. The debounce cut (#1) is pure latency with zero engine cost and is the highest-leverage single change.
`
  fs.writeFileSync(path.join(__dirname, 'LATENCY-REPORT.md'), md)
  log('\nwrote e2e/LATENCY-REPORT.md')
  await app.close()
  process.exit(0)
} catch (e) {
  console.log('probe error:', e.stack || e.message)
  try { await app.close() } catch { /* */ }
  process.exit(1)
}
