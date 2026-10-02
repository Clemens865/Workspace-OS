/**
 * Landscape adoption exit test (docs/landscape/ADOPTION.md, phase A):
 * every stage surface wears the landscape materials.
 *
 * For each surface reached through the Menu, reads computed styles in the real
 * app: the stage root uses Inter and a mist gradient, and no visible chrome
 * element is painted in the previous design's blues. Document-editing
 * affordances (handles, grips, cursors) are exempt by design, as is the
 * contents of a webview (not part of this DOM).
 *
 * Run: npm run e2e:landscape   (or: node e2e/landscape/adoption.mjs after a build)
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

// A small real workspace so Files, Home and Cases have something to draw.
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-adoption-'))
fs.writeFileSync(path.join(ws, 'Notes.md'), '# Notes\n\nA line.\n')
fs.writeFileSync(path.join(ws, 'Budget.csv'), 'item,amount\nrent,100\n')
fs.mkdirSync(path.join(ws, 'Drafts'))

await killAll()
const app = await electron.launch({
  args: [path.join(root, 'out/main/index.js')],
  cwd: root,
  env: { ...process.env, WORKSPACE_TEST_ROOT: ws },
})
const win = await app.firstWindow({ timeout: 20000 })
win.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
await win.waitForSelector('#root', { timeout: 20000 })
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  let c = {}
  try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
  localStorage.setItem(K, JSON.stringify({ ...c, startOn: 'landscape', terminalOpen: false }))
})
await win.reload()
await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(400)
}
await win.waitForTimeout(800)

/** Colours of the previous design, as computed rgb() strings. */
const OLD = ['rgb(0, 113, 227)', 'rgb(0, 96, 191)', 'rgb(47, 107, 216)', 'rgb(234, 240, 255)']

const audit = () =>
  win.evaluate((OLD) => {
    const stage = document.querySelector('[data-shell="landscape"] .wos')
    if (!stage) return { error: 'no stage' }
    const cs = getComputedStyle(stage)
    // Document affordances keep their own colours (see landscape-tokens.css).
    const EXEMPT = /Grip|Handle|Ruler|Rotate|Cursor|Selection|Annot|lok|Lok|xterm|monaco/i
    const hits = []
    for (const el of stage.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      const s = getComputedStyle(el)
      if (s.visibility !== 'visible' || s.display === 'none') continue
      let p = el
      let exempt = false
      while (p && p !== stage) {
        if (EXEMPT.test(typeof p.className === 'string' ? p.className : '')) { exempt = true; break }
        p = p.parentElement
      }
      if (exempt) continue
      for (const prop of ['backgroundColor', 'color', 'borderTopColor', 'borderBottomColor']) {
        if (OLD.includes(s[prop])) {
          // a border colour only counts when the border is drawn
          if (prop.startsWith('border') && parseFloat(s[prop.replace('Color', 'Width')]) === 0) continue
          hits.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0].slice(0, 40)} ${prop}=${s[prop]}`)
        }
      }
    }
    return {
      font: cs.fontFamily,
      bg: cs.backgroundImage,
      hits: [...new Set(hits)].slice(0, 6),
      count: hits.length,
    }
  }, OLD)

try {
  await win.click('[data-dock="menu"]')
  await win.waitForTimeout(900)
  const rails = await win.$$eval('[data-menu]', (els) => els.map((e) => e.getAttribute('data-menu')))
  check('the Menu lists the stage surfaces', rails.length >= 10, rails.join(','))

  let first = true
  for (const r of rails) {
    await win.click('[data-dock="menu"]').catch(() => {})
    await win.waitForTimeout(700)
    await win.click(`[data-menu="${r}"]`)
    await win.waitForTimeout(1600)
    const a = await audit()
    if (first) {
      check('stage uses Inter', /Inter/.test(a.font ?? ''), a.font)
      check('stage background is the mist gradient', /gradient/.test(a.bg ?? ''), a.bg)
      first = false
    }
    check(`${r}: no old-design blue in the chrome`, a.count === 0, a.hits?.join(' | '))
    await win.click('[data-testid="stage-landscape"]').catch(() => {})
    await win.waitForTimeout(700)
  }
} catch (e) {
  check('run completed', false, e.message)
} finally {
  await app.close()
  fs.rmSync(ws, { recursive: true, force: true })
}
console.log(`\n${total - fails}/${total} passed`)
process.exit(fails ? 1 : 0)
