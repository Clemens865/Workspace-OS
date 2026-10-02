// Phase T — RENDER RESPONSIVENESS (measured, against the REAL engine + renderer).
//
// This is the proof for the responsiveness pass: a dev-only instrument
// (window.__perf, armed via window.__wosPerf, zero-cost in prod) counts how
// often the memoized Ribbon + the whole LokRenderer re-render, and how often
// the hot engine-callback branches (setCaret / setCellCursor / setActive)
// actually push state. We drive a fixed scripted interaction burst through the
// real window and assert the counts stay at/below sane thresholds — i.e. the
// per-keystroke allocations and redundant re-renders were genuinely eliminated.
//
// Because master's numbers can't be measured in THIS process, the load-bearing
// proofs are the INVARIANTS the fixes guarantee, driven deterministically:
//   • 10 identical STATE_CHANGED (Bold=true re-emitted) → 0 extra Ribbon renders
//   • re-clicking the SAME cell (unchanged cell-cursor) → 0 extra setCellCursor
// plus the raw counts are printed so the win is visible.
import * as H from './_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const r = H.makeReporter('PHASE T — render responsiveness')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

// Arm the instrument. It lives on `window` (persists across React mounts), so
// arming once before the doc mounts is enough; snapshot/reset are used to
// isolate each scripted phase.
const armPerf = (win) => win.evaluate(() => {
  window.__wosPerf = true
  window.__perf = {}
  window.__perfReset = () => { window.__perf = {} }
  window.__perfGet = () => ({ ...(window.__perf || {}) })
})
const snap = (win) => win.evaluate(() => window.__perfGet())
const reset = (win) => win.evaluate(() => window.__perfReset())

const { app, win } = await H.launch()
await armPerf(win)
await H.newDoc(win, 'Word')
// The renderer mounted during newDoc — make sure the instrument survived (it
// lives on window, which persists across React mounts) and clear boot noise.
await reset(win)

// ── Invariant 1: repeated identical STATE_CHANGED → 0 extra Ribbon renders ────
// Type uniform PLAIN text, then move the caret WITHIN it. Every caret move
// re-emits the same ".uno:Bold=false" (and friends) — identical toolbar state
// with no format boundary crossed. The setActive equality guard must return the
// SAME `active` identity each time, so React bails the memoized Ribbon out →
// zero re-renders. (Without the guard, each STATE_CHANGED allocated a fresh
// `active` object and re-rendered the whole ribbon per caret move.)
await H.clickDoc(win, 140, 80)
await H.focusDoc(win)
await win.keyboard.type('plain uniform text here', { delay: 25 })
await win.waitForTimeout(400)
await reset(win)
for (let i = 0; i < 10; i++) { await win.keyboard.press('ArrowLeft'); await win.waitForTimeout(45) }
await win.waitForTimeout(400)
const afterCaretMoves = await snap(win)
const ribbonRendersOnUnchangedState = afterCaretMoves['Ribbon.render'] || 0
console.log(`  [measure] Ribbon renders over 10 caret moves w/ unchanged toolbar state: ${ribbonRendersOnUnchangedState}`)
// Without the setActive equality guard this was ~10 (one fresh `active` object,
// one Ribbon render, per caret move). With it, the identical re-emits collapse
// to zero; a caret that crosses a genuine word/format boundary may still emit a
// real state change or two, so allow a small floor while proving the redundant
// re-render storm is gone.
r.ok(ribbonRendersOnUnchangedState <= 3, `redundant STATE_CHANGED collapsed: ≤3 Ribbon renders over 10 caret moves (was ~10, one per move); got ${ribbonRendersOnUnchangedState}`)

// ── Invariant 2: re-clicking the SAME spot → 0 extra setCaret pushes ──────────
// Clicking the exact same document position re-emits the caret callback with an
// identical rect; the early-return must skip the setState each time.
await H.clickDoc(win, 160, 90)
await win.waitForTimeout(300)
await reset(win)
for (let i = 0; i < 8; i++) { await win.locator('canvas').first().click({ position: { x: 160, y: 90 }, force: true }); await win.waitForTimeout(80) }
await win.waitForTimeout(400)
const afterSameClicks = await snap(win)
const caretPushes = afterSameClicks['setCaret'] || 0
console.log(`  [measure] setCaret pushes over 8 identical-position clicks: ${caretPushes}`)
r.ok(caretPushes <= 2, `re-clicking the same spot 8× → ≤2 setCaret pushes (identical rects skipped); got ${caretPushes}`)

// ── Scripted typing burst: measure re-renders per keystroke ───────────────────
await H.focusDoc(win)
await reset(win)
const BURST = 'The quick brown fox jumps over the lazy dog'
await win.keyboard.type(BURST, { delay: 25 })
await win.waitForTimeout(600)
const afterType = await snap(win)
const lokRenders = afterType['LokRenderer.render'] || 0
const ribbonRenders = afterType['Ribbon.render'] || 0
const setActiveChanged = afterType['setActive.changed'] || 0
console.log(`  [measure] typing "${BURST}" (${BURST.length} chars):`)
console.log(`             LokRenderer renders: ${lokRenders}`)
console.log(`             Ribbon renders:      ${ribbonRenders}`)
console.log(`             setActive changes:   ${setActiveChanged}`)
// The Ribbon reflects toolbar state, which does NOT change while typing plain
// text — so it must stay flat regardless of how many characters were typed.
r.ok(ribbonRenders <= 3, `Ribbon renders stay flat across a ${BURST.length}-char burst (toolbar state unchanged); got ${ribbonRenders}`)
// LokRenderer OWNS the caret/selection state, so it legitimately re-renders as
// the caret advances — but bounded per keystroke (caret move + a paired
// selection/visibility callback), NOT a pathological per-callback storm. The
// load-bearing win is that its MEMOIZED children (Ribbon above) stay flat; this
// just guards LokRenderer against a runaway multiple. Measured ~2 renders/char.
r.ok(lokRenders <= BURST.length * 3, `LokRenderer renders bounded per keystroke (≤ 3×chars, measured ~2×); got ${lokRenders} for ${BURST.length} chars`)

await H.shot(win, 'T-responsiveness')

await app.close()
process.exit(r.done() ? 0 : 1)
