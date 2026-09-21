/**
 * Records a demo video of Workspace OS by driving the REAL app.
 *
 *   node scripts/demo/record-demo.mjs            # everything
 *   node scripts/demo/record-demo.mjs shell files
 *
 * Output: build/demo/workspace-os-demo.mp4 (plus the raw per-segment webm).
 *
 * WHY SEGMENTS RATHER THAN ONE TAKE
 * The LibreOffice engine cold-boots in ~27s on this machine. In a single
 * continuous recording that is half a minute of a motionless window. Each
 * section is therefore its own launch and its own recording, and every segment
 * marks the moment its interesting part BEGINS — the setup before that mark is
 * trimmed off, and the trimmed pieces are concatenated. Waiting for an engine
 * is a fact of the app; it should not be a fact of the video.
 *
 * PRIVACY
 * The tour runs against a seeded workspace in /tmp, never the real one. The
 * point of this video is to be shared, and the real workspace holds actual
 * documents, mail and browsing history.
 */
import { _electron as electron } from 'playwright'
import { execFileSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  installStagecraft,
  dropCurtain,
  raiseCurtain,
  titleCard,
  caption,
  clearCaption,
  show,
  cursorTo,
  hideCursor,
  sleep,
} from './stagecraft.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const WS = '/tmp/wos-demo'
/**
 * A throwaway HOME for the recording.
 *
 * `~/.claude/agents` is GLOBAL, so seeding a demo workspace did not isolate the
 * agent roster — the first test recording put the real one on screen, which
 * says more about its owner than a product video should. Electron resolves both
 * that path and its own userData from $HOME, so redirecting it gives a clean
 * profile: no real mail accounts, no browser history, no personal agents.
 */
const DEMO_HOME = '/tmp/wos-demo-home'
/** The dev engine on the external SSD (same path lokEngine.ts falls back to). */
const DEV_ENGINE = '/Volumes/LOBuild/core/instdir/LibreOffice.app/Contents'
const ASSETS = '/tmp/wos-demo-assets'
const OUT = path.join(ROOT, 'build', 'demo')
const RAW = path.join(OUT, 'raw')

/**
 * Recorded larger than it will be shown. The feed cut is 4:5 vertical, which
 * cannot fit a desktop UI legibly at 1080 wide — each shot has to punch in on a
 * region instead, and a 1440x900 source has no pixels left after that crop.
 */
/**
 * Must match what the window can ACTUALLY give: this display's work area is
 * 1512x949, so a taller request is clamped and Playwright pads the difference
 * with grey. That padding is not cosmetic — it defeats `blackdetect`, which
 * needs ~98% of the frame black to see the curtain, so the trim silently fails
 * and the cut begins inside the curtain. It is Retina, so the capture is
 * sharper than these numbers suggest and survives a vertical crop.
 */
const SIZE = { width: 1512, height: 945 }

const only = process.argv.slice(2)
const wanted = (name) => only.length === 0 || only.includes(name)

/* ── the demo workspace ───────────────────────────────────────────────────── */

function seedWorkspace() {
  fs.rmSync(WS, { recursive: true, force: true })
  const mk = (p) => fs.mkdirSync(path.join(WS, p), { recursive: true })
  mk('Clients/Northwind/Contracts')
  mk('Clients/Meridian')
  mk('Projects/Harbour Terminal/Drawings')
  mk('Photos')
  mk('Reports')

  // Something with real bytes in every folder, so sizes and dates differ and
  // the sort columns have something to actually sort.
  const file = (rel, bytes, ageDays) => {
    const p = path.join(WS, rel)
    fs.writeFileSync(p, 'x'.repeat(bytes))
    const t = new Date(Date.now() - ageDays * 86_400_000)
    fs.utimesSync(p, t, t)
  }
  /**
   * Documents the tour OPENS must be real files.
   *
   * These were `'x'.repeat(48000)` — 48KB of the letter x with a .docx
   * extension. The engine cannot open that, and the office segment hung for
   * fifteen minutes waiting for a document that was never going to load.
   * Anything the tour opens is copied from a real template; only files that
   * exist to give the size and date columns something to sort are synthesised.
   */
  const real = (rel, from, ageDays) => {
    const p = path.join(WS, rel)
    fs.copyFileSync(path.join(ROOT, from), p)
    const t = new Date(Date.now() - ageDays * 86_400_000)
    fs.utimesSync(p, t, t)
  }
  real('Reports/Quarterly Review.docx', 'resources/templates/blank.docx', 1)
  real('Reports/Cost Model.xlsx', 'resources/templates/blank.xlsx', 0)
  real('Clients/Northwind/Statement of Work.docx', 'resources/templates/blank.docx', 6)
  real('Clients/Meridian/Proposal.docx', 'resources/templates/blank.docx', 20)
  real('Projects/Harbour Terminal/Programme.xlsx', 'resources/templates/blank.xlsx', 2)
  if (fs.existsSync(path.join(ROOT, 'Workspace-OS-Overview.pptx'))) {
    real('Reports/Board Deck.pptx', 'Workspace-OS-Overview.pptx', 3)
  }

  // Never opened by the tour — these exist so the size and date columns have a
  // spread worth sorting.
  file('Reports/Findings.pdf', 890_000, 12)
  file('Reports/notes.md', 1_800, 0)
  file('Clients/Northwind/Contracts/MSA 2026.pdf', 410_000, 40)
  file('Projects/Harbour Terminal/Drawings/GA-100.pdf', 1_200_000, 9)

  seedDemoHome()

  // Real images — the gallery and icon views should show actual pictures, not
  // a grid of identical glyphs.
  if (fs.existsSync(ASSETS)) {
    for (const f of fs.readdirSync(ASSETS).filter((n) => n.endsWith('.png'))) {
      fs.copyFileSync(path.join(ASSETS, f), path.join(WS, 'Photos', f))
    }
  }
}

/** A believable roster for the Home surface, in place of the real one. */
function seedDemoHome() {
  const agents = path.join(DEMO_HOME, '.claude', 'agents')
  fs.rmSync(DEMO_HOME, { recursive: true, force: true })
  fs.mkdirSync(agents, { recursive: true })

  const spec = (name, description, body) =>
    fs.writeFileSync(
      path.join(agents, `${name}.md`),
      `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
    )

  spec(
    'Tender Reader',
    'Reads a tender pack and returns the obligations, dates and exclusions as a spreadsheet.',
    'Read every document in the pack. Extract obligations, deadlines and exclusions.',
  )
  spec(
    'Cost Checker',
    'Re-checks a cost model against the rates in the contract and flags every line that disagrees.',
    'Compare each line of the cost model to the contracted rate. Report disagreements only.',
  )
  spec(
    'Site Report',
    'Turns site photos and field notes into a formatted weekly report.',
    'Group the photos by area, pair them with the notes, and write the weekly report.',
  )
  spec(
    'Meeting Notes',
    'Turns a transcript into decisions, owners and dates — and files them.',
    'Extract decisions with an owner and a date. Anything without both is not a decision.',
  )
}

/* ── recording ────────────────────────────────────────────────────────────── */

/** A running instance holds the single-instance lock and the launch fails. */
function killRunningApp() {
  // Same patterns as the office harness: a dev-launched Electron holds the
  // single-instance lock just as the installed app does, and a surviving engine
  // host wedges the next launch.
  for (const pattern of ['Workspace OS.app', 'node_modules/electron', 'wos-lok-host']) {
    try {
      execFileSync('pkill', ['-9', '-f', pattern], { stdio: 'ignore' })
    } catch {
      /* none running */
    }
  }
}

const segments = []

async function record(name, body, budgetMs = 300_000) {
  const dir = path.join(RAW, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })

  killRunningApp()
  await sleep(900)

  const launchedAt = Date.now()
  const app = await electron.launch({
    args: [path.join(ROOT, 'out/main/index.js')],
    cwd: ROOT,
    env: {
      ...process.env,
      WORKSPACE_TEST_ROOT: WS,
      HOME: DEMO_HOME,
      /**
       * The engine paths, passed explicitly — as e2e/office/_harness.mjs does.
       *
       * Without these the app falls back to `app.getAppPath() + scripts/lok/…`,
       * and when it is launched as `out/main/index.js` getAppPath() returns
       * `out/main`, not the repo root. So the host binary resolves to a path
       * that cannot exist, `lokAvailable()` is false, and no document ever
       * opens. That — not HOME, and not the unplugged SSD which masked it —
       * is why the office segment failed every time.
       */
      WOS_LOK_INSTALL: `${DEV_ENGINE}/Frameworks/`,
      WOS_LOK_FUND: `${DEV_ENGINE}/Resources/fundamentalrc`,
      WOS_LOK_HOST: path.join(ROOT, 'scripts/lok/wos-lok-host'),
      // Keep the real CLI reachable despite the redirected HOME, so the app
      // still reports its agent runtime as available.
      CLAUDE_BIN: process.env.CLAUDE_BIN || `${process.env.HOME}/.local/bin/claude`,
    },
    recordVideo: { dir, size: SIZE },
  })
  const win = await app.firstWindow({ timeout: 30000 })
  await win.waitForSelector('#root', { timeout: 30000 })
  await dropCurtain(win) // everything from here until mark() is hidden

  // Match the OS window to the recording size, or the capture is letterboxed.
  await app.evaluate(({ BrowserWindow }, s) => {
    const w = BrowserWindow.getAllWindows()[0]
    // setContentSize, not setSize: the video frame is the WEB AREA, and sizing
    // the outer window leaves the contents short by the title bar.
    w.setContentSize(s.width, s.height)
    w.center()
  }, SIZE)

  await win.evaluate(() => {
    const K = 'workspace-os:settings'
    const cur = (() => {
      try {
        return JSON.parse(localStorage.getItem(K) || '{}')
      } catch {
        return {}
      }
    })()
    localStorage.setItem(
      K,
      JSON.stringify({ ...cur, newShell: true, terminalOpen: false, terminalMinimized: false, terminalPlacement: 'bottom' }),
    )
    localStorage.setItem('workspace-os:files-view', 'list')
    localStorage.removeItem('workspace-os:browser-session')
    localStorage.setItem('workspace-os:browser-assistant', JSON.stringify({ open: true, width: 300 }))
  })
  await win.reload()
  await win.waitForSelector('#root', { timeout: 30000 })
  await dropCurtain(win)
  await sleep(1500)
  await installStagecraft(win)

  let markedAt = null
  /** Raises the curtain: the hard black→content edge the trim looks for. */
  const mark = async () => {
    if (markedAt !== null) return
    markedAt = Date.now()
    await raiseCurtain(win)
  }

  try {
    // A stuck segment used to stall the entire recording. Now it forfeits its
    // own budget and the run carries on with whatever it captured.
    await Promise.race([
      body({ win, app, mark }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`segment budget of ${budgetMs / 1000}s exhausted`)), budgetMs),
      ),
    ])
  } catch (err) {
    console.log(`      (${name}: ${err.message})`)
  } finally {
    const endedAt = Date.now()
    await sleep(900) // let the last frame settle before the stream closes
    const video = win.video()
    await app.close().catch(() => {})
    const file = video ? await video.path().catch(() => null) : null
    await sleep(600)

    const resolved = file && fs.existsSync(file) ? file : biggestWebm(dir)
    if (markedAt === null) {
      // Nothing was ever shown: the segment bailed before raising the curtain.
      // Without this it donates its entire untrimmed length — six minutes of
      // black in the last run, which is why the cut came out at 460s.
      console.log(`      (${name} produced nothing — excluded from the cut)`)
    } else if (resolved) {
      // The curtain's black→content edge, found IN the video. Wall-clock math
      // cannot be used here: the recorder starts an unknown latency after
      // launch, and the first attempt silently trimmed away the title card.
      const from = curtainEnd(resolved)
      segments.push({
        name,
        file: resolved,
        trimFrom: from,
        trimTo: from + (endedAt - (markedAt ?? launchedAt)) / 1000 + 0.8,
      })
      console.log(`  ✓ ${name} — ${(fs.statSync(resolved).size / 1e6).toFixed(1)} MB`)
    } else {
      console.error(`  ✗ ${name} — no video produced`)
    }
  }
}

/**
 * Seconds at which the black curtain lifts — i.e. where the content starts.
 *
 * `pixel_th=0.02` separates the pure-black curtain from the title cards, which
 * are nearly but not quite black (#0c0e12 ≈ 0.05 luma). Falls back to 0 rather
 * than guessing if no leading black run is found, so a detection failure yields
 * a slightly long segment instead of a decapitated one.
 */
function curtainEnd(file) {
  // spawnSync, and BOTH streams: blackdetect logs to stderr while ffmpeg exits
  // 0, so execFileSync's return value (stdout) is always empty. That silently
  // reported "no curtain found" on every segment and left the setup in the cut.
  const r = spawnSync(
    'ffmpeg',
    // pic_th below the 0.98 default so a stray band of padding cannot hide a
    // curtain that is otherwise unmistakably black.
    ['-i', file, '-vf', 'blackdetect=d=0.2:pix_th=0.02:pic_th=0.85', '-an', '-f', 'null', '-'],
    { encoding: 'utf8' },
  )
  return parseCurtain(`${r.stdout ?? ''}\n${r.stderr ?? ''}`)
}

function parseCurtain(text) {
  const runs = [...text.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)].map((m) => ({
    start: Number(m[1]),
    end: Number(m[2]),
  }))
  if (runs.length === 0) return 0

  // There is rarely ONE leading black run. The window paints black for a frame
  // or two before the curtain is even installed, so the head of the recording
  // looks like 0.04-0.40 then 0.68-17.32. Taking the first match trimmed at
  // 0.32s — the START of the curtain — and the cut then opened on the setup it
  // was supposed to hide. So merge runs separated by less than a second and
  // take the end of the merged block.
  if (runs[0].start > 2) return 0 // no leading black at all: nothing to trim
  let end = runs[0].end
  for (const r of runs.slice(1)) {
    if (r.start > end + 1) break // a genuine gap — content has started
    end = r.end
  }
  return Math.max(0, end - 0.08)
}

/** The window's own recording, when several pages were captured (webview guests). */
function biggestWebm(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => ({ f: path.join(dir, f), size: fs.statSync(path.join(dir, f)).size }))
    .sort((a, b) => b.size - a.size)
  return files[0]?.f ?? null
}

/* ── helpers shared by the segments ───────────────────────────────────────── */

const railButton = (label) =>
  `[class*=rail] button:has-text("${label}"), button[aria-label="${label}"]`

async function goRail(win, label) {
  const found = await win.evaluate((l) => {
    const el = [...document.querySelectorAll('button,[role=tab],a,[role=button]')].find(
      (e) =>
        new RegExp(l, 'i').test(e.textContent || '') ||
        new RegExp(l, 'i').test(e.getAttribute('aria-label') || ''),
    )
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, label)
  if (!found) return false
  await win.evaluate(
    ([x, y]) => {
      const c = document.getElementById('wos-demo-cursor')
      c.classList.add('on')
      c.style.transform = `translate(${x}px, ${y}px)`
    },
    [found.x, found.y],
  )
  await sleep(560)
  await win.mouse.click(found.x, found.y)
  await sleep(1500)
  return true
}

const key = async (win, k, opts = {}) => {
  await win.evaluate(
    ([kk, o]) => window.dispatchEvent(new KeyboardEvent('keydown', { key: kk, bubbles: true, ...o })),
    [k, opts],
  )
  await sleep(1100)
}

/* ── the tour ─────────────────────────────────────────────────────────────── */

async function segShell() {
  await record('01-shell', async ({ win, mark }) => {
    await mark()
    await titleCard(
      win,
      'Workspace OS',
      'Documents, mail, the web and agents — in one window, on your machine.',
      2600,
    )
    await caption(win, 'One rail. Every surface stays live.')
    for (const r of ['Files', 'Browser', 'Calendar', 'Cockpit', 'Home']) {
      await goRail(win, r)
    }
    await clearCaption(win)
    await hideCursor(win)
  })
}

async function segFiles() {
  await record('02-files', async ({ win, mark }) => {
    await goRail(win, 'Files')
    await sleep(1200)
    await mark()

    await titleCard(win, 'Files', 'A real file browser — four ways to look at the same folder.', 2100)

    const B = '[data-testid="file-browser"]'
    await caption(win, 'Sort by size, date or kind — on real file metadata')
    await show(win, `${B} button[aria-label="Sort by size"]`, { settle: 1100 })
    await show(win, `${B} button[aria-label="Sort by date modified"]`, { settle: 1100 })

    await caption(win, 'Filter by kind, without losing the folders that lead somewhere')
    await show(win, `${B} button:has-text("Spreadsheet")`, { settle: 1200 })
    await show(win, `${B} button[aria-label="Clear filters"]`, { settle: 900 })

    // Into Photos FIRST: the caption promises thumbnails, and the workspace
    // root holds nothing but folders. Showing four folder glyphs under
    // "with real thumbnails" makes the feature look like it does not work.
    await caption(win, 'Icons — with real thumbnails, not a grid of glyphs')
    await show(win, `${B} [class*=nameText]:has-text("Photos")`, { settle: 1100 })
    await show(win, `${B} button[aria-label="Icons view"]`, { settle: 1600 })
    await sleep(1200)

    await caption(win, 'Gallery — for when you need to see it, not read its name')
    await show(win, `${B} button[aria-label="Gallery view"]`, { settle: 1600 })
    await show(win, `${B} [class*=stripItem]`, { nth: 2, settle: 1500 })
    await show(win, `${B} [class*=stripItem]`, { nth: 3, settle: 1600 })

    await caption(win, 'Columns — the whole path stays on screen as you drill')
    await show(win, `${B} button[aria-label="Columns view"]`, { settle: 1000 })
    await show(win, `${B} nav[aria-label="Breadcrumb"] button`, { settle: 1200 })
    await show(win, `${B} [class*=colName]:has-text("Projects")`, { settle: 1200 })
    await show(win, `${B} [class*=colName]:has-text("Harbour Terminal")`, { settle: 1500 })

    await clearCaption(win)
    await hideCursor(win)
  })
}

async function segOffice() {
  await record(
    '03-office',
    async ({ win, mark }) => {
      // The engine cold-boot happens here, BEFORE the mark, behind the curtain.
      await goRail(win, 'Files')
      await sleep(1200)
      // The document lives in Reports/, and the tree shows folders collapsed —
      // clicking its name at the top level matches nothing. Navigate the
      // browser pane into the folder first, the way a person would.
      const B = '[data-testid="file-browser"]'
      await show(win, `${B} [class*=nameText]:has-text("Reports")`, { settle: 1200 })
      await show(win, `${B} [class*=nameText]:has-text("Quarterly Review")`, { settle: 2500 })

      if (!(await waitForEngine(win, 150_000))) {
        console.log('      (engine never opened the document — segment skipped)')
        return
      }
      await sleep(1500)
      await focusDocument(win)
      await mark()

      await titleCard(
        win,
        'Native office',
        'A real LibreOffice engine, running locally. No upload, no round-trip.',
        2500,
      )

      await caption(win, 'Editing a .docx in place — the file on disk IS the document')
      /**
       * Enough text that the page looks like a DOCUMENT.
       *
       * The first cut typed two lines, so seven tenths of every office shot was
       * blank white page — which read as an empty app rather than as a word
       * processor. Typed rather than pre-seeded because watching the words
       * arrive is the point of the shot.
       */
      await win.keyboard.type('Harbour Terminal \u2014 quarterly review', { delay: 42 })
      await win.keyboard.press('Enter')
      await win.keyboard.type(
        'Berths 4 and 5 returned to service in March, three weeks ahead of the ' +
          'programme. Throughput has held above plan every month since.',
        { delay: 12 },
      )
      await win.keyboard.press('Enter')
      await win.keyboard.type(
        'Dredging is complete to the design depth across the approach channel, ' +
          'and the pilotage trial closed without exception.',
        { delay: 12 },
      )
      await win.keyboard.press('Enter')
      await sleep(700)
      await win.keyboard.type('Berth capacity is ', { delay: 45 })
      await sleep(1200)

      // ── liveness, in the document that is on screen ──────────────────────
      // Folded into this segment rather than its own: it costs one engine boot
      // instead of two, and the claim only lands if the number is visibly
      // sitting in a document when it changes.
      await caption(win, 'Now the part that matters — one number, in one place')
      const metricId = await win
        .evaluate(() => window.workspace.metrics.create('Berth capacity', 4200).then((m) => m.id))
        .catch(() => null)

      if (metricId) {
        const tag = 'wos-metric-demo-' + Date.now()
        const inserted = await win
          .evaluate(
            ({ t, n }) => window.workspace.lok.macro('WosInsertContentControl', t + '|4200|' + n),
            { t: tag, n: 'Berth capacity' },
          )
          .catch(() => false)

        if (inserted) {
          await win.evaluate(
            ({ id, tg }) =>
              window.workspace.transclusions.add({
                metricId: id,
                filePath: '/tmp/wos-demo/Reports/Quarterly Review.docx',
                target: { kind: 'docx-cc', tag: tg },
                lastValue: 4200,
              }),
            { id: metricId, tg: tag },
          )
          await sleep(1900)

          await caption(win, 'Change it at the source\u2026')
          await sleep(1300)
          await win.evaluate((id) => window.workspace.metrics.update(id, { value: 5150 }), metricId)
          await sleep(3000) // the OPEN document updates without a reopen
          await caption(win, '\u2026and the document already says 5 150. Nothing to go stale.')
          await sleep(2600)
        } else {
          console.log('      (insert macro unavailable — liveness beat skipped)')
        }
        await win.evaluate((id) => window.workspace.metrics.delete(id), metricId).catch(() => {})
      }

      await clearCaption(win)
      await hideCursor(win)
    },
    360_000,
  )
}

/** Polls until the engine actually has a document open. */
async function waitForEngine(win, budgetMs) {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    const parts = await win.evaluate(() => window.workspace.lok?.parts?.()).catch(() => null)
    if (parts && parts.parts > 0) return true
    await sleep(900)
  }
  return false
}

/** Puts the caret in the document, so typing reaches the engine. */
async function focusDocument(win) {
  for (let i = 0; i < 12; i++) {
    const ok = await win
      .evaluate(() => {
        const d = document.querySelector('[class*=docWrap]')
        if (!d) return false
        d.focus()
        return document.activeElement === d
      })
      .catch(() => false)
    if (ok) return true
    await sleep(400)
  }
  return false
}

async function segBrowser() {
  await record('05-browser', async ({ win, mark }) => {
    await goRail(win, 'Browser')
    await sleep(2500)
    await mark()

    await titleCard(win, 'The web, inside the workspace', 'With an assistant that reads the page you are on.', 2300)

    await caption(win, 'A full browser — signed-in sessions, history, tabs')
    await sleep(1600)

    await caption(win, 'The assistant panel collapses when you want the width back')
    await show(win, 'button[aria-label="Hide the assistant"]', { settle: 1500 })
    await show(win, 'button[aria-label="Show the assistant"]', { settle: 1400 })

    await clearCaption(win)
    await hideCursor(win)
  })
}

async function segRoom() {
  await record('06-room', async ({ win, mark }) => {
    await goRail(win, 'Browser')
    await sleep(2000)
    await mark()

    await titleCard(win, 'Room when you need it', 'And a terminal that gets out of the way without stopping.', 2300)

    await caption(win, '⌃⌘F — one surface fills the window')
    await show(win, 'button[aria-label="Fill the window"]', { settle: 1800 })
    await sleep(900)
    await caption(win, 'Esc brings the rail and tabs back')
    await win.keyboard.press('Escape')
    await sleep(1800)

    await caption(win, '⌘J — the terminal, docked below')
    await key(win, 'j', { metaKey: true })
    await sleep(1800)

    await caption(win, '⌥⌘J minimises it — the session keeps running')
    await key(win, 'j', { metaKey: true, altKey: true })
    await sleep(2000)

    await caption(win, 'Restore, and you are back in the same shell')
    await show(win, 'button[aria-label="Restore the terminal"]', { settle: 1800 })

    await caption(win, 'Or move it to the side')
    await win.evaluate(() => {
      const K = 'workspace-os:settings'
      const cur = JSON.parse(localStorage.getItem(K) || '{}')
      localStorage.setItem(K, JSON.stringify({ ...cur, terminalPlacement: 'right' }))
      window.dispatchEvent(new StorageEvent('storage', { key: K }))
    })
    await sleep(2400)

    await clearCaption(win)
    await hideCursor(win)
  })
}

async function segClose() {
  await record('07-close', async ({ win, mark }) => {
    await goRail(win, 'Cockpit')
    await sleep(1800)
    await mark()
    await caption(win, 'Agents work in the same workspace, on the same files')
    await sleep(2200)
    await clearCaption(win)
    await hideCursor(win)
    await titleCard(win, 'Workspace OS', 'One workspace. Everything in it, alive.', 3000)
  })
}

/* ── stitching ───────────────────────────────────────────────────────────── */

function stitch() {
  if (segments.length === 0) {
    console.error('\nNothing recorded — nothing to stitch.')
    return null
  }
  const parts = []
  for (const [i, seg] of segments.entries()) {
    const out = path.join(RAW, `part-${String(i).padStart(2, '0')}.mp4`)
    const dur = Math.max(1, seg.trimTo - seg.trimFrom)
    // Re-encode every part to identical parameters so concat cannot desync, and
    // fade each in/out so the cuts between sections read as deliberate.
    execFileSync(
      'ffmpeg',
      [
        '-y', '-loglevel', 'error',
        '-ss', seg.trimFrom.toFixed(2),
        '-t', dur.toFixed(2),
        '-i', seg.file,
        '-vf', `scale=${SIZE.width}:${SIZE.height}:force_original_aspect_ratio=decrease,pad=${SIZE.width}:${SIZE.height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,fade=t=in:st=0:d=0.35,fade=t=out:st=${Math.max(0, dur - 0.45).toFixed(2)}:d=0.45`,
        '-an',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
        out,
      ],
      { stdio: 'inherit' },
    )
    parts.push(out)
  }

  const list = path.join(RAW, 'concat.txt')
  fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'))
  const final = path.join(OUT, 'workspace-os-demo.mp4')
  execFileSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', final],
    { stdio: 'inherit' },
  )
  return final
}

/* ── main ─────────────────────────────────────────────────────────────────── */

fs.mkdirSync(RAW, { recursive: true })
seedWorkspace()
console.log(`\nSeeded ${WS}\nRecording…\n`)

const TOUR = [
  ['shell', segShell],
  ['files', segFiles],
  ['office', segOffice],
  ['browser', segBrowser],
  ['room', segRoom],
  ['close', segClose],
]

for (const [name, fn] of TOUR) {
  if (!wanted(name)) continue
  try {
    await fn()
  } catch (err) {
    console.error(`  ✗ ${name} — ${err.message}`)
  }
}

console.log('\nStitching…')
const final = stitch()
if (final) {
  const secs = execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', final,
  ])
    .toString()
    .trim()
  console.log(`\n✓ ${final}`)
  console.log(`  ${Number(secs).toFixed(1)}s · ${(fs.statSync(final).size / 1e6).toFixed(1)} MB\n`)
}
