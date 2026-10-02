// Shared harness for office-function e2e tests (Phase A / A1).
// Every function test: launch → new/open a doc → drive a UI control → assert the
// result (canvas pixels and/or saved file) → capture before/after screenshots.
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '../..')
// Prefer the external dev build; fall back to the bundled engine inside the
// packaged app (the engine users actually run) when the dev SSD isn't mounted.
const DEV_ENGINE = '/Volumes/LOBuild/core/instdir/LibreOffice.app/Contents'
const BUNDLED_ENGINE = path.join(ROOT, 'release/mac-arm64/Workspace OS.app/Contents/Resources/libreoffice/LibreOffice.app/Contents')
// WOS_SUITE_ENGINE=bundled forces the packaged app's engine — what users run.
// The dev engine lives on the LOBuild sparse image (mount LOBuild.sparseimage → /Volumes/LOBuild).
const ENGINE = process.env.WOS_SUITE_ENGINE === 'bundled'
  ? BUNDLED_ENGINE
  : fs.existsSync(DEV_ENGINE + '/Resources/fundamentalrc') ? DEV_ENGINE : BUNDLED_ENGINE
export const SHOTS = path.join(__dirname, 'shots')
export const TESTROOT = '/tmp/wos-test'

export function enginePresent() {
  return fs.existsSync(path.join(ROOT, 'scripts/lok/wos-lok-host')) && fs.existsSync(ENGINE + '/Resources/fundamentalrc')
}

// Process patterns that must be dead before a fresh launch — the single-instance
// lock makes a new instance quit immediately (and firstWindow() then hangs) if
// any of these are still alive.
const PROC_PATTERNS = [
  'Software-Projects/Workspace-OS/node_modules/electron',
  'Workspace OS.app',
  'scripts/lok/wos-lok-host',
]

/** Kills any running app/engine processes and polls until they're actually gone
 * (a fixed sleep races a slow shutdown and is the main source of launch flake). */
export async function killAll() {
  for (const p of PROC_PATTERNS) { try { execSync(`pkill -9 -f "${p}"`, { stdio: 'ignore' }) } catch { /* none running */ } }
  for (let i = 0; i < 50; i++) {
    let alive = false
    for (const p of PROC_PATTERNS) {
      try { execSync(`pgrep -f "${p}"`, { stdio: 'ignore' }); alive = true; break } catch { /* none for this pattern */ }
    }
    if (!alive) { await new Promise((r) => setTimeout(r, 400)); return } // brief settle after the last death
    await new Promise((r) => setTimeout(r, 200))
  }
}

/** Launches the dev build with the engine wired in. Returns { app, win }.
 * Retries once if the window never appears (single-instance quit / slow boot). */
export async function launch() {
  await killAll()
  // Clear stale LibreOffice locks left by hard-killed hosts. The profile lock
  // makes the engine boot read-only; a per-document `.~lock.<file>#` makes a
  // reopened file read-only — either way edits silently don't apply while
  // rendering still works (the classic "renders but won't type" second-run flake).
  try { fs.rmSync('/tmp/wos-lok-host-profile', { recursive: true, force: true }) } catch { /* none */ }
  // Ensure the workspace test root exists (first run on a fresh machine has no /tmp/wos-test).
  fs.mkdirSync(TESTROOT, { recursive: true })
  try { for (const f of fs.readdirSync(TESTROOT)) if (f.startsWith('.~lock')) fs.rmSync(path.join(TESTROOT, f), { force: true }) } catch { /* none */ }
  const env = {
    ...process.env,
    WORKSPACE_TEST_ROOT: TESTROOT,
    WOS_LOK_INSTALL: ENGINE + '/Frameworks/',
    WOS_LOK_FUND: ENGINE + '/Resources/fundamentalrc',
    WOS_LOK_HOST: path.join(ROOT, 'scripts/lok/wos-lok-host'),
    // A dev launch's app path is out/main, so the wos-action shim source is not
    // found relative to it (packaged: process.resourcesPath). Point the shim
    // installer at the repo's copy so agent runs can reach the bridge in e2e.
    WOS_ACTION_DIR: process.env.WOS_ACTION_DIR ?? path.join(ROOT, 'resources/wos-action'),
    // The landscape is the only shell (docs/landscape/PLAN.md, phase 7); the
    // office tests drive the flat stage's surfaces, so the app opens on it.
    // Set here, not at module level: other suites import killAll from this file.
    WOS_START_ON: process.env.WOS_START_ON ?? 'stage',
  }
  let lastErr
  for (let attempt = 1; attempt <= 2; attempt++) {
    let app
    try {
      app = await electron.launch({ args: [path.join(ROOT, 'out/main/index.js')], cwd: ROOT, env })
      const win = await app.firstWindow({ timeout: 20000 })
      win.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`))
      await win.waitForSelector('#root', { timeout: 20000 })
      await win.waitForTimeout(600)
      // The startup splash intercepts pointer events until dismissed; Enter lets
      // us in (a click would also do, but Enter cannot land on anything else).
      for (let i = 0; i < 20 && await win.locator('[class*=splash]').first().isVisible().catch(() => false); i++) {
        await win.keyboard.press('Enter')
        await win.waitForTimeout(300)
      }
      return { app, win }
    } catch (e) {
      lastErr = e
      console.log(`  [launch] attempt ${attempt} failed (${e.message?.split('\n')[0]}); retrying…`)
      try { await app?.close() } catch { /* */ }
      await killAll()
    }
  }
  throw new Error(`launch failed after 2 attempts: ${lastErr?.message ?? lastErr}`)
}

/** Doc-type-specific ribbon tab — a reliable signal that the *right* document
 * has finished opening (not a stale tab's leftover canvas). */
const KIND_TAB = { Word: 'Layout', Excel: 'Data', PowerPoint: 'Design' }

/** Waits until a document canvas is painted and settled. When `expectTab` is
 * given, also waits for that ribbon tab — proving the expected doc type loaded.
 * Throws on timeout so failures are loud instead of silently passing a stale view. */
export async function waitRender(win, expectTab) {
  // Cold engine boot on this machine is ~27s; the New-doc flow adds file-write
  // + first-paint on top. 60 × 350ms (~21s) undershoots that, so poll longer.
  for (let i = 0; i < 120; i++) {
    // The DOCUMENT surface canvas lives inside docWrap for every doc type
    // (Writer/Impress/Calc). A bare `querySelector('canvas')` grabs the FIRST
    // canvas in the DOM — for Calc that's the col-header strip (h≈44 < 100), so
    // the old predicate could NEVER go true for a spreadsheet even though the
    // grid was fully painted. Scope to the docWrap canvas (fall back to any
    // large canvas) so Calc is detected the same as Writer/Impress.
    const painted = await win.evaluate(() => {
      const c = document.querySelector('[class*=docWrap] canvas')
        || [...document.querySelectorAll('canvas')].find((x) => x.width > 100 && x.height > 100)
      return !!c && c.width > 100 && c.height > 100
    }).catch(() => false)
    const rendering = await win.getByText('Rendering…').isVisible().catch(() => false)
    const tabOk = !expectTab || await win.getByRole('button', { name: expectTab, exact: true }).isVisible().catch(() => false)
    if (painted && !rendering && tabOk) { await win.waitForTimeout(150); return }
    await win.waitForTimeout(350)
  }
  throw new Error(`waitRender timed out${expectTab ? ` (no "${expectTab}" tab — wrong/no doc rendered)` : ''}`)
}

const KIND_EXT = { Word: 'docx', Excel: 'xlsx', PowerPoint: 'pptx' }

/** Creates a fresh document via the New-document menu; returns its file path. */
export async function newDoc(win, kind) {
  // remove any prior generated file of this base so the name is deterministic
  const base = { Word: 'New Document', Excel: 'New Spreadsheet', PowerPoint: 'New Presentation' }[kind]
  for (const f of fs.readdirSync(TESTROOT)) if (f.startsWith(base)) fs.rmSync(path.join(TESTROOT, f))
  // New shell: the file panel (with "New document") lives behind the Files rail.
  const newBtn = win.getByRole('button', { name: 'New document', exact: true })
  if (!(await newBtn.isVisible().catch(() => false))) {
    const files = win.getByRole('button', { name: 'Files', exact: true }).first()
    if (await files.isVisible().catch(() => false)) { await files.click(); await win.waitForTimeout(400) }
  }
  await newBtn.click()
  // The menu label differs per kind ("Word document" / "Excel spreadsheet" / "PowerPoint…").
  const primary = win.getByText(`${kind} document`)
  if (await primary.isVisible().catch(() => false)) await primary.click()
  else await win.getByText(kind === 'Excel' ? 'Excel spreadsheet' : 'PowerPoint').click()
  // Wait for the doc-type-specific tab so we never return on a stale canvas.
  await waitRender(win, KIND_TAB[kind])
  return path.join(TESTROOT, `${base}.${KIND_EXT[kind]}`)
}

/** Opens an existing file from the tree. Pass `kind` to assert the doc type loaded. */
export async function openDoc(win, fileName, kind) {
  await win.getByText(fileName).first().click()
  await waitRender(win, kind ? KIND_TAB[kind] : undefined)
}

/** Polls an async predicate until it returns truthy or the timeout elapses.
 * Use this instead of a fixed `waitForTimeout` before asserting the result of
 * an async engine operation — fixed sleeps race the engine under machine load,
 * which is the main source of operation-timing flake. Returns the truthy value
 * (or false on timeout) so callers can assert on it directly. */
export async function poll(fn, { timeout = 8000, interval = 350 } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    try { const v = await fn(); if (v) return v } catch { /* keep polling */ }
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, interval))
  }
}

/** Performs `op`, then saves and re-checks `check(contents)` until it passes
 * (or times out) — robust to the engine applying a structural change slightly
 * after the click. `read` returns the file contents to test (e.g. docXml). */
export async function saveUntil(win, op, read, check, opts) {
  await op()
  return poll(async () => { await save(win); return check(read()) }, opts)
}

/** Clicks into the document canvas at a px offset to place the cursor/cell.
 * force:true bypasses the actionability wait (the live canvas repaints often). */
export async function clickDoc(win, x = 120, y = 80) {
  await win.locator('canvas').first().click({ position: { x, y }, force: true })
  await win.waitForTimeout(250)
}

export async function type(win, text, delay = 35) {
  await win.keyboard.type(text, { delay })
  await win.waitForTimeout(300)
}

/** Returns keyboard focus to the document and verifies it actually landed —
 * a bare .focus() that silently no-ops (doc not yet focusable) is a common
 * cause of dropped keystrokes, especially right after a fresh render. */
export async function focusDoc(win) {
  for (let i = 0; i < 15; i++) {
    const ok = await win.evaluate(() => {
      const d = document.querySelector('[class*=docWrap]')
      if (!d) return false
      d.focus()
      return document.activeElement === d
    }).catch(() => false)
    if (ok) { await win.waitForTimeout(60); return }
    await win.waitForTimeout(100)
  }
  await win.waitForTimeout(60) // proceed anyway; the assertion will surface a real failure
}

/** Selects the whole document via ⌘A (the editor's Select-All). */
export async function selectAll(win) {
  await focusDoc(win)
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  await win.waitForTimeout(200)
}

export async function save(win) {
  // Click the ribbon Save button — works regardless of where focus is.
  const btn = win.getByTitle('Save (⌘S)')
  if (await btn.isEnabled().catch(() => false)) await btn.click()
  else await win.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
  // Wait for the button to read "Saved" — confirms the write completed.
  for (let i = 0; i < 25; i++) {
    if (await win.getByText('Saved').first().isVisible().catch(() => false)) break
    await win.waitForTimeout(150)
  }
  await win.waitForTimeout(400)
}

/** A 32-bucket signature of the top of the canvas — to detect visible change. */
export function canvasSig(win) {
  return win.evaluate(() => {
    const c = document.querySelector('canvas')
    if (!c) return ''
    const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(c.height, 400)).data
    let s = 0
    for (let i = 0; i < d.length; i += 8) s = (s + d[i]) % 1000003
    return `${c.width}x${c.height}:${s}`
  })
}

export async function shot(win, name) {
  await win.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}

/** Reads the main text part out of a saved office file (docx/xlsx/pptx zip). */
export function docXml(file, kind = 'Word') {
  const inner = { Word: 'word/document.xml', Excel: 'xl/worksheets/sheet1.xml', PowerPoint: 'ppt/slides/slide1.xml' }[kind]
  try { return execSync(`unzip -p '${file}' ${inner}`, { encoding: 'utf8' }) } catch { return '' }
}

export function makeReporter(label) {
  let pass = 0, fail = 0
  return {
    ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg) } else { fail++; console.log('  ✗ ' + msg) } },
    done() { console.log(`\n${label}: ${pass} passed, ${fail} failed`); return fail === 0 },
  }
}
