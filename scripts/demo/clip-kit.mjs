/**
 * The recording framework for the clip library.
 *
 * A SESSION launches the app once; CLIPS are recorded inside it. Between clips
 * a black curtain is dropped, so the finished session video is
 *
 *   [black] clip [black] clip [black] …
 *
 * and `blackdetect` recovers the boundaries exactly. Wall-clock timing cannot
 * do this — the recorder starts an unknown latency after launch — and an
 * earlier attempt that tried lost the first seconds of every clip.
 *
 * One launch per session rather than per clip because the office engine
 * cold-boots in ~30s; paying that once for three clips is the difference
 * between a two-minute run and a ten-minute one.
 */
import { _electron as electron } from 'playwright'
import { execFileSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { installStagecraft, dropCurtain, raiseCurtain, armCurtainOnLoad, sleep } from './stagecraft.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const WS = '/tmp/wos-demo'
export const DEMO_HOME = '/tmp/wos-demo-home'
/** Electron ignores $HOME for userData on macOS; this flag is what actually
 *  isolates the profile — without it the app reuses the REAL search index and
 *  mail accounts, which is a privacy problem in anything we film. */
export const PROFILE = '/tmp/wos-demo-profile'
const DEV_ENGINE = '/Volumes/LOBuild/core/instdir/LibreOffice.app/Contents'

export const SIZE = { width: 1512, height: 945 }
export const OUT = path.join(ROOT, 'build/demo/clips')

/** Every clip recorded so far, for the manifest. */
export const manifest = []

function killRunningApp() {
  for (const p of ['Workspace OS.app', 'node_modules/electron', 'wos-lok-host']) {
    try {
      execFileSync('pkill', ['-9', '-f', p], { stdio: 'ignore' })
    } catch {
      /* none running */
    }
  }
}

/**
 * Runs one app session. `body` receives a context with `clip()`; everything
 * outside a clip happens behind the curtain and never reaches the video.
 */
export async function session(name, body) {
  const dir = path.join(OUT, '_raw', name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })

  killRunningApp()
  await sleep(900)

  const app = await electron.launch({
    args: [path.join(ROOT, 'out/main/index.js'), `--user-data-dir=${PROFILE}`],
    cwd: ROOT,
    env: {
      ...process.env,
      WORKSPACE_TEST_ROOT: WS,
      HOME: DEMO_HOME,
      // Passed explicitly: app.getAppPath() is `out/main` when the built entry
      // is launched directly, so the default host path cannot exist and the
      // office engine silently never opens a document.
      WOS_LOK_INSTALL: `${DEV_ENGINE}/Frameworks/`,
      WOS_LOK_FUND: `${DEV_ENGINE}/Resources/fundamentalrc`,
      WOS_LOK_HOST: path.join(ROOT, 'scripts/lok/wos-lok-host'),
      CLAUDE_BIN: process.env.CLAUDE_BIN || `${process.env.HOME}/.local/bin/claude`,
    },
    recordVideo: { dir, size: SIZE },
  })

  const win = await app.firstWindow({ timeout: 30000 })
  await armCurtainOnLoad(win) // survives the reloads sessions do while seeding
  await win.waitForSelector('#root', { timeout: 30000 })
  await dropCurtain(win)
  await app.evaluate(({ BrowserWindow }, s) => {
    const w = BrowserWindow.getAllWindows()[0]
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
      JSON.stringify({
        ...cur,
        newShell: true,
        terminalOpen: false,
        terminalMinimized: false,
        terminalPlacement: 'bottom',
      }),
    )
    localStorage.setItem('workspace-os:files-view', 'list')
    localStorage.removeItem('workspace-os:browser-session')
    localStorage.setItem('workspace-os:browser-assistant', JSON.stringify({ open: true, width: 300 }))
  })
  await win.reload()
  await win.waitForSelector('#root', { timeout: 30000 })
  await dropCurtain(win)
  await sleep(1200)
  await installStagecraft(win)

  const clips = []
  const ctx = {
    win,
    app,
    /** Everything inside `body` is filmed; everything outside it is not. */
    async clip(id, title, description, body) {
      await sleep(500) // a clean run of black before the clip opens
      await raiseCurtain(win)
      await sleep(250)
      const started = Date.now()
      try {
        await body()
      } catch (err) {
        console.log(`      ! ${id}: ${err.message}`)
      }
      const ms = Date.now() - started
      await dropCurtain(win)
      await sleep(500)
      clips.push({ id, title, description, ms })
      console.log(`    · ${id} (${(ms / 1000).toFixed(1)}s)`)
    },
  }

  try {
    await body(ctx)
  } catch (err) {
    console.log(`  ! session ${name}: ${err.message}`)
  }

  await sleep(700)
  const video = win.video()
  await app.close().catch(() => {})
  const file = video ? await video.path().catch(() => null) : null
  await sleep(600)

  const src = file && fs.existsSync(file) ? file : biggest(dir)
  if (!src) {
    console.log(`  ! ${name}: no video produced`)
    return
  }
  cutClips(src, clips, name)
}

function biggest(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => ({ f: path.join(dir, f), size: fs.statSync(path.join(dir, f)).size }))
    .sort((a, b) => b.size - a.size)
  return files[0]?.f ?? null
}

/** The lit stretches between black runs, in order, are the clips. */
function cutClips(src, clips, sessionName) {
  const r = spawnSync(
    'ffmpeg',
    ['-i', src, '-vf', 'blackdetect=d=0.25:pix_th=0.02:pic_th=0.85', '-an', '-f', 'null', '-'],
    { encoding: 'utf8' },
  )
  const text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
  const runs = [...text.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)].map((m) => ({
    start: Number(m[1]),
    end: Number(m[2]),
  }))

  const duration = Number(
    spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', src], {
      encoding: 'utf8',
    }).stdout.trim(),
  )

  // Merge black runs closer than 0.4s: the window paints black for a frame or
  // two of its own around the curtain, and those must not read as extra gaps.
  const merged = []
  for (const run of runs) {
    const last = merged[merged.length - 1]
    if (last && run.start - last.end < 0.4) last.end = run.end
    else merged.push({ ...run })
  }

  const lit = []
  let cursor = 0
  for (const b of merged) {
    if (b.start - cursor > 0.6) lit.push({ from: cursor, to: b.start })
    cursor = b.end
  }
  if (duration - cursor > 0.6) lit.push({ from: cursor, to: duration })

  /**
   * Align from the END.
   *
   * The very first page load is unprotected — `firstWindow()` only resolves
   * once the app has painted, and the init script that re-arms the curtain can
   * only affect LATER loads. So the session reliably opens with one lit stretch
   * of setup that is not a clip. Clips are always the final N ranges.
   */
  const chosen = lit.slice(Math.max(0, lit.length - clips.length))
  if (chosen.length !== clips.length) {
    console.log(`  ! ${sessionName}: ${chosen.length} usable ranges for ${clips.length} clips`)
  }

  fs.mkdirSync(OUT, { recursive: true })
  clips.forEach((c, i) => {
    const range = chosen[i]
    if (!range) return
    const out = path.join(OUT, `${c.id}.mp4`)
    // 0.15s trimmed off each end so no frame of the curtain survives.
    const from = range.from + 0.15
    const dur = Math.max(0.5, range.to - range.from - 0.3)
    execFileSync(
      'ffmpeg',
      [
        '-y', '-loglevel', 'error',
        '-ss', from.toFixed(3), '-t', dur.toFixed(3), '-i', src,
        '-vf', `fps=30,setsar=1`,
        '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p',
        out,
      ],
      { stdio: 'inherit' },
    )
    manifest.push({ ...c, session: sessionName, file: path.relative(ROOT, out), seconds: Number(dur.toFixed(1)) })
  })
}

export { sleep }
