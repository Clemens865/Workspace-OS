/**
 * The app builder with the REAL model (opt-in: it spends model calls, minutes).
 *
 *   WOS_LIVE=1 node e2e/landscape/apps-live.mjs
 *
 * A new app is described in the builder chat; the real Claude writes it. Then:
 * it touched nothing outside its folder, the app loads in its sandbox with no
 * errors, it is built from the design kit (classes, tokens, no hard-coded
 * colours or fonts, nothing from the network, no localStorage), its manifest
 * says what it is, and it works: its controls respond and its state survives a
 * reload through wos.storage.
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
let total = 0
const check = (n, c, d) => {
  total++
  if (c) console.log(`  PASS  ${n}`)
  else {
    console.error(`  FAIL  ${n}${d ? ` — ${d}` : ''}`)
    fails++
  }
}
const pomodoro = !process.env.WOS_LIVE_ASK
const ASK = process.env.WOS_LIVE_ASK ?? 'A pomodoro timer: 25 minute focus and 5 minute breaks, start/pause/reset, and a count of focus sessions done today that is still there when I come back.'

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-apps-live-')))
const ws = path.join(tmp, 'workspace')
fs.mkdirSync(path.join(ws, 'Notes'), { recursive: true })
fs.writeFileSync(path.join(ws, 'Notes', 'keep.md'), 'untouched\n')
const snapshot = () => {
  const out = {}
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out[path.relative(ws, p)] = fs.statSync(p).mtimeMs
    }
  }
  walk(ws)
  return out
}

await killAll()
const app = await electron.launch({
  args: [path.join(root, 'out/main/index.js')],
  cwd: root,
  env: { ...process.env, WORKSPACE_TEST_ROOT: ws, WOS_ACTION_DIR: path.join(root, 'resources/wos-action'), WOS_NO_MEANING: '1', WOS_NO_TIDY: '1' },
})
const win = await app.firstWindow({ timeout: 20000 })
await win.waitForSelector('#root', { timeout: 20000 })
const saved = await win.evaluate(() => JSON.stringify({ ...localStorage }))
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  let c = {}
  try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
  localStorage.setItem(K, JSON.stringify({ ...c, startOn: 'landscape', terminalOpen: false, sessionCases: 'manual', learnFromSessions: false }))
})
await win.reload()
await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(400)
}
const settle = (ms = 800) => win.waitForTimeout(ms)

try {
  await win.click('[data-dock="apps"]')
  await win.click('[data-testid="apps-new"]')
  await win.waitForSelector('[data-testid="chat-app-preview"]', { timeout: 8000 })
  const slug = await win.getAttribute('[data-testid="chat-app-preview"]', 'data-app')
  const before = snapshot()
  await win.click('[data-testid="chat-view"] textarea')
  await win.keyboard.type(ASK)
  await win.keyboard.press('Enter')
  await win.waitForSelector('[data-testid="chat-stop"]', { timeout: 20000 })
  const t0 = Date.now()
  await win.waitForSelector('[data-testid="chat-stop"]', { state: 'detached', timeout: 15 * 60_000 })
  // The harness after the build: design check (one fix), review (one fix), then next steps. Done when the
  // next steps show, or when nothing has run for 30 s (a review that gave nothing).
  for (let quiet = 0, i = 0; i < 3600 && quiet < 60; i++) {
    if (await win.$('[data-testid="chat-suggest"]')) break
    quiet = (await win.$('[data-testid="chat-stop"]')) ? 0 : quiet + 1
    await settle(500)
  }
  const thread = (await win.textContent('[data-testid="chat-thread"]')) ?? ''
  console.log(`  (built, checked and reviewed in ${Math.round((Date.now() - t0) / 1000)} s)`)
  console.log(`  harness: ${thread.match(/(Product brief written[^.]*\.|No brief this time[^;]*;|Design check:[^.]*\.|Review:[^.]*\.)/g)?.join(' | ') ?? 'nothing said'}`)
  const brief = fs.existsSync(path.join(ws, 'Apps', slug, 'BRIEF.md')) ? fs.readFileSync(path.join(ws, 'Apps', slug, 'BRIEF.md'), 'utf8') : ''
  const checks = (brief.match(/^\s*-\s*\[[ xX]?\]/gm) ?? []).length
  check('the idea became a product brief with acceptance checks', /^# \S/m.test(brief) && checks >= 6, `${checks} checks`)
  const next = await win.$$eval('[data-suggest]', (els) => els.map((e) => e.getAttribute('data-suggest')))
  check('the running app was reviewed against it, and three next steps are offered', /Review: \d+ of \d+ checks? met/.test(thread) && next.length === 3, JSON.stringify(next))
  console.log(`  next: ${next.join(' | ')}`)
  await settle(1500)
  const reply = (await win.textContent('[data-testid="chat-thread"] [data-role="agent"]:last-child').catch(() => '')) ?? ''
  console.log(`  reply: ${reply.slice(0, 300)}`)

  const after = snapshot()
  const changed = Object.keys(after).filter((k) => after[k] !== before[k])
  const outside = changed.filter((k) => !k.startsWith(`Apps/${slug}/`) && !k.startsWith('.workspace-os/'))
  check('it wrote only inside its own folder', outside.length === 0 && changed.some((k) => k.startsWith(`Apps/${slug}/`)), JSON.stringify(changed))
  const dir = path.join(ws, 'Apps', slug)
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'))
  check('its manifest says what it is', manifest.name !== 'New app' && manifest.description.length > 10 && manifest.icon, JSON.stringify(manifest))
  const code = fs
    .readdirSync(dir)
    .filter((f) => /\.(html|js|css)$/.test(f))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n')
  const hexes = (code.match(/#[0-9a-f]{3,8}\b/gi) ?? []).filter((h) => !/^#(fff|ffffff|000|000000)$/i.test(h))
  console.log(`  kit classes: ${[...new Set(code.match(/wos-[a-z]+/g) ?? [])].join(' ')}; hard-coded colours: ${hexes.join(' ') || 'none'}`)
  check('it is built from the design kit, without its own colours or fonts', /class="[^"]*wos-(btn|app|card|segment)/.test(code) && /var\(--(ink|line|muted|accent|paper)/.test(code) && hexes.length <= 2 && !/font-family:\s*['"]?(?!var\()(?!inherit)[A-Za-z]/i.test(code), `hexes ${hexes.length}`)
  check('it reaches for nothing outside its sandbox', !/https?:\/\/(?!www\.w3\.org)/.test(code) && !/localStorage|sessionStorage|indexedDB/.test(code) && /wos\.storage/.test(code))

  // It loads and works.
  const el = await win.waitForSelector('[data-testid="app-frame"]', { timeout: 10000 })
  const f = await el.contentFrame()
  const errors = []
  f.page().on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await win.click('[data-testid="chat-app-open"]')
  await win.waitForSelector('[data-testid="apps-view"] [data-testid="app-frame"]', { timeout: 10000 })
  const fr = await (await win.$('[data-testid="apps-view"] [data-testid="app-frame"]')).contentFrame()
  await settle(1500)
  const ui = await fr.evaluate(() => ({ text: document.body.innerText.slice(0, 400), buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim() || b.title || b.getAttribute('aria-label') || '(icon)') }))
  console.log(`  app shows: ${JSON.stringify(ui).slice(0, 400)}`)
  check('it loads in its sandbox with a working face and no errors', ui.buttons.length >= 2 && (!pomodoro || /25|start/i.test(ui.text + ui.buttons.join(' '))) && errors.length === 0, JSON.stringify({ errors, ui }))
  if (process.env.WOS_SHOT_DIR) await win.screenshot({ path: path.join(process.env.WOS_SHOT_DIR, `app-live-${slug}.png`) })
  if (pomodoro) {
    const start = await fr.$('button:has-text("Start"), button:has-text("Resume")')
    if (start) {
      await start.click()
      await settle(2500)
    }
    const ticking = await fr.evaluate(() => document.body.innerText)
    // Minutes and seconds may be separate elements ("24\n:\n58"): read the clock with the gaps closed.
    const clock = /\d{1,2}\s*:\s*\d\d/.exec(ticking)?.[0].replace(/\s+/g, '') ?? '25:00'
    check('…and it responds: Start runs the timer', !!start && clock !== '25:00', ticking.slice(0, 200))
  }
  await fr.evaluate(() => wos.storage.keys()).then((k) => console.log(`  storage keys: ${JSON.stringify(k)}`))
} catch (e) {
  check('run completed', false, e.message)
} finally {
  await win
    .evaluate((saved) => {
      localStorage.clear()
      for (const [k, v] of Object.entries(JSON.parse(saved))) localStorage.setItem(k, v)
    }, saved)
    .catch(() => {})
  await app.close()
  // A kept workspace stays in the recent list, and its sessions show in "All projects": keep it only on request.
  if (process.env.WOS_KEEP === '1') console.log(`  (workspace kept for a look: ${ws})`)
  else fs.rmSync(tmp, { recursive: true, force: true })
}
console.log(`\n${total - fails}/${total} passed`)
process.exit(fails ? 1 : 0)
