/**
 * Making a Hairline figure with the REAL model (opt-in: it spends model calls).
 *
 *   WOS_LIVE=1 [WOS_LIVE_ASK="a sales funnel"] [WOS_SHOT_DIR=<dir>] node e2e/landscape/hairline-live.mjs
 *
 * The figure must pass the skill's checks (with at most the one automatic
 * fix) and draw in its own frame, answering the pointer.
 */
import { _electron as electron } from 'playwright'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { killAll } from '../office/_harness.mjs'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
if (process.env.WOS_LIVE !== '1') {
  console.log('skipped (set WOS_LIVE=1)')
  process.exit(0)
}
let fails = 0
const check = (n, c, d) => {
  console[c ? 'log' : 'error'](`  ${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` — ${d}` : ''}`)
  if (!c) fails++
}
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-hl-live-')))
const ws = path.join(tmp, 'workspace')
fs.mkdirSync(ws)
await killAll()
const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root, env: { ...process.env, WORKSPACE_TEST_ROOT: ws, WOS_NO_MEANING: '1', WOS_NO_TIDY: '1' } })
const win = await app.firstWindow({ timeout: 20000 })
await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(400)
}
try {
  await win.click('[data-dock="apps"]')
  await win.click('[data-testid="apps-add-hairline"]')
  const el = await win.waitForSelector('[data-testid="app-frame"]', { timeout: 10000 })
  await win.waitForTimeout(2500)
  const f = await el.contentFrame()
  await f.click('#tabs [data-tab="make"]')
  await f.fill('#idea', process.env.WOS_LIVE_ASK ?? 'a sales funnel whose stages widen toward the pointer')
  const t0 = Date.now()
  await f.click('#make-go')
  for (let i = 0; i < 1200; i++) {
    const s = await f.evaluate(() => ({ done: !document.getElementById('make-result').hidden, problems: !document.getElementById('make-problems').hidden, busy: !document.getElementById('make-busy').hidden }))
    if (s.done || (s.problems && !s.busy)) break
    await win.waitForTimeout(500)
  }
  console.log(`  (took ${Math.round((Date.now() - t0) / 1000)} s)`)
  const r = await f.evaluate(() => ({ name: document.getElementById('make-name').textContent, means: document.getElementById('make-means').textContent, done: !document.getElementById('make-result').hidden, problems: document.getElementById('make-problems').textContent }))
  console.log(`  figure: ${r.name} — ${r.means}`)
  check('the real model makes a figure that passes the skill’s checks and draws', r.done && !r.problems, r.problems)
  if (r.done) {
    const fr = await (await f.$('#make-stage iframe')).contentFrame()
    const parts = await fr.evaluate(() => document.querySelectorAll('svg *').length)
    const box = await (await f.$('#make-stage iframe')).boundingBox()
    await win.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.55, { steps: 10 })
    await win.waitForTimeout(1200)
    const readout = await f.textContent('#make-readout')
    check('…its drawing has parts, and it answers the pointer (its read-out leaves "rest")', parts > 10 && readout && readout !== 'rest', `${parts} parts, readout "${readout}"`)
    if (process.env.WOS_SHOT_DIR) await win.screenshot({ path: path.join(process.env.WOS_SHOT_DIR, 'hairline-live.png') })
  }
} catch (e) {
  check('run completed', false, e.message)
} finally {
  await app.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}
process.exit(fails ? 1 : 0)
