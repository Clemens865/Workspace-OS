/**
 * What the tour recording (record-tour.mjs) stands on: a demo workspace and
 * home (nothing of the person's own appears), the app launched with the
 * scripted Claude, a pointer that is visible on the video (a recording has no
 * cursor of its own), and moves that also reach inside an app's frame.
 */
import { _electron as electron } from 'playwright'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { installStagecraft, sleep } from './stagecraft.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '../..')
export const WS = '/tmp/wos-tour'
export const HOME = '/tmp/wos-tour-home'
export const ASSETS = '/tmp/wos-tour-assets'
export const SIZE = { width: 1512, height: 945 }
export { sleep }

const put = (rel, text, ageDays = 0) => {
  const p = path.join(WS, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text)
  const t = new Date(Date.now() - ageDays * 86_400_000)
  fs.utimesSync(p, t, t)
}

/** A believable workspace and roster, nothing of the person's own. */
export function seed() {
  for (const d of [WS, HOME, ASSETS]) fs.rmSync(d, { recursive: true, force: true })
  put('Work/Northwind offer.md', 'Hamburg, 12 September 2026\n\nDear Clara,\n\nNorthwind Logistics is pleased to offer you the position of Senior Product Manager for our routing platform "Waypoint". Your annual salary will be EUR 120,000, and your start date is 1 March 2027. You will report to Anna Berg, Head of Product.\n', 3)
  put('Work/Harbour Terminal/Programme notes.md', '# Programme\n\n- Piling complete by week 42\n- Crane delivery slipped two weeks\n- Next site visit: Friday\n', 1)
  put('Notes/Ideas.md', '# Ideas\n\n- A reading list app\n- Ask the wiki about [[Northwind Logistics]]\n', 0)
  put('Reports/Q3 summary.md', '# Q3\n\nRevenue grew 12 percent. Costs held flat.\n', 5)
  fs.copyFileSync(path.join(ROOT, 'resources/templates/blank.docx'), path.join(WS, 'Reports/Quarterly Review.docx'))
  fs.mkdirSync(ASSETS, { recursive: true })
  fs.writeFileSync(path.join(ASSETS, 'Quarterly notes.txt'), 'Revenue grew 12 percent in Q3.\nTwo new clients signed: Meridian and Contoso.\nThe Harbour Terminal schedule slipped by two weeks.\n')

  const agents = path.join(HOME, '.claude', 'agents')
  fs.mkdirSync(agents, { recursive: true })
  const agent = (name, description, body) => fs.writeFileSync(path.join(agents, `${name}.md`), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`)
  agent('Tender Reader', 'Reads a tender pack and returns the obligations, dates and exclusions as a spreadsheet.', 'Read every document in the pack.')
  agent('Cost Checker', 'Re-checks a cost model against the contract rates and flags every line that disagrees.', 'Compare each line to the contracted rate.')
  agent('Site Report', 'Turns site photos and field notes into a formatted weekly report.', 'Group the photos by area and write the report.')
}

function killRunning() {
  for (const p of ['Workspace OS.app', 'node_modules/electron', 'wos-lok-host']) {
    try {
      execFileSync('pkill', ['-9', '-f', p], { stdio: 'ignore' })
    } catch {
      /* none */
    }
  }
}

/** The app, recording, on the demo workspace and home, with the scripted Claude. */
export async function launch(videoDir) {
  killRunning()
  await sleep(800)
  const app = await electron.launch({
    args: [path.join(ROOT, 'out/main/index.js')],
    cwd: ROOT,
    env: {
      ...process.env,
      HOME,
      // The app's own data in a scratch folder: redirecting HOME alone leaves it in the person's real profile.
      WOS_USERDATA_DIR: path.join(HOME, 'userdata'),
      WORKSPACE_TEST_ROOT: WS,
      CLAUDE_BIN: path.join(ROOT, 'scripts/demo/tour-claude.cjs'),
      WOS_ACTION_DIR: path.join(ROOT, 'resources/wos-action'),
      WOS_NO_MEANING: '1',
      WOS_NO_TIDY: '1',
    },
    recordVideo: { dir: videoDir, size: SIZE },
  })
  const win = await app.firstWindow({ timeout: 30000 })
  await win.waitForSelector('#root', { timeout: 30000 })
  await app.evaluate(({ BrowserWindow }, s) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setContentSize(s.width, s.height)
    w.center()
  }, SIZE)
  await win.evaluate(() => {
    const K = 'workspace-os:settings'
    localStorage.setItem(K, JSON.stringify({ startOn: 'landscape', terminalOpen: false, sessionCases: 'manual', learnFromSessions: false, agentModel: '' }))
  })
  await win.reload()
  await win.waitForSelector('[data-shell="landscape"]', { timeout: 30000 })
  for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
    await win.keyboard.press('Enter').catch(() => {})
    await sleep(400)
  }
  await installStagecraft(win)
  return { app, win }
}

/** The page coordinates of a locator (inside a frame too). */
async function centre(loc) {
  const b = await loc.first().boundingBox({ timeout: 6000 }).catch(() => null)
  return b && { x: b.x + b.width / 2, y: b.y + b.height / 2, b }
}

/** Moves the visible pointer (and the real one) to a target. */
export async function point(win, loc, { dx = 0, dy = 0 } = {}) {
  const c = await centre(loc)
  if (!c) return null
  const at = { x: c.x + dx, y: c.y + dy }
  await win.evaluate(([x, y]) => {
    const el = document.getElementById('wos-demo-cursor')
    el.classList.add('on')
    el.style.transform = `translate(${x}px, ${y}px)`
  }, [at.x, at.y])
  await win.mouse.move(at.x, at.y, { steps: 12 })
  await sleep(450)
  return at
}

/** Point, pulse, click. Skips (and says so) when the target is not there, so one moved button costs one beat. */
export async function tap(win, loc, { settle = 650, ...o } = {}) {
  const at = await point(win, loc, o)
  if (!at) {
    console.log(`      (skipped: ${loc})`)
    return false
  }
  await win.evaluate(() => {
    const c = document.getElementById('wos-demo-cursor')
    c.classList.remove('tap')
    void c.offsetWidth
    c.classList.add('tap')
  })
  await sleep(160)
  await win.mouse.click(at.x, at.y)
  await sleep(settle)
  return true
}

/** Types like a person. */
export async function type(win, loc, text, { delay = 38 } = {}) {
  if (!(await tap(win, loc, { settle: 200 }))) return
  await loc.first().pressSequentially(text, { delay })
}

/** A drag with the visible pointer following. */
export async function drag(win, from, to, steps = 14) {
  await win.evaluate(([x, y]) => {
    const el = document.getElementById('wos-demo-cursor')
    el.classList.add('on')
    el.style.transition = 'none'
    el.style.transform = `translate(${x}px, ${y}px)`
  }, [from.x, from.y])
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps, y = from.y + ((to.y - from.y) * i) / steps
    await win.mouse.move(x, y)
    await win.evaluate(([x, y]) => (document.getElementById('wos-demo-cursor').style.transform = `translate(${x}px, ${y}px)`), [x, y])
    await sleep(30)
  }
  await win.mouse.up()
  await win.evaluate(() => (document.getElementById('wos-demo-cursor').style.transition = ''))
  await sleep(400)
}

/** Waits for a condition, up to a limit, without failing the take. */
export async function until(fn, ms = 15000) {
  for (let t = 0; t < ms; t += 250) {
    if (await Promise.resolve().then(fn).catch(() => false)) return true
    await sleep(250)
  }
  return false
}

/** The frame of the app on screen (inside Apps or beside a builder chat). */
export async function appFrame(win, scope = '[data-testid="apps-view"]') {
  const el = await win.waitForSelector(`${scope} [data-testid="app-frame"]`, { timeout: 15000 })
  let f = null
  await until(async () => (f = await el.contentFrame()) && (await f.evaluate(() => typeof window.wos === 'object' && document.readyState === 'complete')), 15000)
  await sleep(500)
  return f
}
