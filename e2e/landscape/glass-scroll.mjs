/**
 * Glass follows its card when a list scrolls (real app, real WebGL).
 *
 * The Liquid Glass panes are drawn by WebGL behind the DOM. Scrolling a list
 * inside a panel (the Cases shelf) used to leave the panes where the cards had
 * been. Here: many cases on the shelf, scroll it, and every visible card's
 * pane must be drawn where the card now is.
 *
 * Run: npm run e2e:landscape
 */
import { _electron as electron } from 'playwright'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { killAll } from '../office/_harness.mjs'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')

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

const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-glass-')))
await killAll()
const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root, env: { ...process.env, WORKSPACE_TEST_ROOT: ws } })
const win = await app.firstWindow({ timeout: 20000 })
await win.waitForSelector('#root', { timeout: 20000 })
const saved = await win.evaluate(() => JSON.stringify({ ...localStorage }))
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  let c = {}
  try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
  localStorage.setItem(K, JSON.stringify({ ...c, startOn: 'landscape', terminalOpen: false, landscapeQuality: 'full' }))
})
await win.reload()
await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(400)
}

/** Each visible folio's DOM top against its pane's drawn top (the pane reaches a few px past the card). */
const offsets = () =>
  win.evaluate(() => {
    const perf = window.__landscapePerf
    const shelf = document.querySelector('[data-case]')?.parentElement
    const box = shelf?.getBoundingClientRect()
    return [...document.querySelectorAll('[data-case]')]
      .map((el) => {
        const r = el.getBoundingClientRect()
        if (!box || r.bottom < box.top + 10 || r.top > box.bottom - 10) return null // scrolled out of view
        const g = perf?.glassBox(el)
        return g && g.visible ? Math.round(g.top - r.top) : null
      })
      .filter((x) => x !== null)
  })

try {
  const supported = await win.evaluate(() => !!window.__landscapePerf?.supported)
  if (!supported) {
    console.log('  SKIP  no WebGL here')
  } else {
    await win.evaluate(async () => {
      for (let i = 1; i <= 18; i++) await window.workspace.cases.create({ title: `Glass check case ${String(i).padStart(2, '0')}`, type: 'task' })
    })
    await win.click('[data-dock="cases"]')
    await win.waitForTimeout(2500)
    const before = await offsets()
    check('every visible card has its glass where the card is', before.length > 3 && before.every((d) => Math.abs(d) <= 8), JSON.stringify(before))

    await win.evaluate(() => {
      const shelf = document.querySelector('[data-case]')?.parentElement
      if (shelf) shelf.scrollTop += 260
    })
    await win.waitForTimeout(900)
    const after = await offsets()
    check('after scrolling the shelf, the glass has followed its cards', after.length > 3 && after.every((d) => Math.abs(d) <= 8), JSON.stringify(after))
  }
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
  fs.rmSync(ws, { recursive: true, force: true })
}
console.log(`\n${total - fails}/${total} passed`)
process.exit(fails ? 1 : 0)
