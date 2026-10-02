/**
 * Landscape adoption B1 exit test (docs/landscape/ADOPTION.md): the old Home
 * lives in the landscape as Today.
 *
 * In the real app, in a throwaway workspace: a case waiting on the person
 * leads the hero and opens in Cases; "Not now" hands the hero on; a finished
 * run and a case note appear under "While you were away"; a file created while
 * the app runs appears among the files with its name and opens on the stage;
 * mail waiting for a reply appears in the Mail card; Menu → Home and the
 * Team | Today switch open Today; the project menu offers Open folder.
 *
 * The user's localStorage (runs, mail cards, snoozes) is saved before and
 * restored after.
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

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-today-'))
fs.writeFileSync(path.join(ws, 'README.md'), '# Workspace\n')

await killAll()
const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root, env: { ...process.env, WORKSPACE_TEST_ROOT: ws } })
const win = await app.firstWindow({ timeout: 20000 })
win.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
await win.waitForSelector('#root', { timeout: 20000 })
const saved = await win.evaluate(() => JSON.stringify({ ...localStorage }))
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  let c = {}
  try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
  localStorage.setItem(K, JSON.stringify({ ...c, startOn: 'landscape', terminalOpen: false }))
  localStorage.removeItem('wos:hero-snooze')
})
await win.reload()
await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(400)
}
await win.waitForTimeout(1000)
const settle = () => win.waitForTimeout(800)
const view = () => win.getAttribute('[data-shell="landscape"]', 'data-view')

try {
  // ── seed: two cases waiting on the person, a finished run, mail waiting ──
  const seeded = await win.evaluate(async () => {
    const statuses = await window.workspace.cases.statuses('application')
    const wait = ['offer', 'interview', 'drafted'].find((s) => statuses.includes(s)) ?? 'drafted'
    const a = await window.workspace.cases.create({ title: 'Northwind offer', type: 'application' })
    await window.workspace.cases.setStatus(a.id, wait)
    await window.workspace.cases.addNote(a.id, 'Salary band confirmed', 'agent')
    const b = await window.workspace.cases.create({ title: 'Contoso interview', type: 'application' })
    await window.workspace.cases.setStatus(b.id, wait)
    const s = window.__reviewStore
    s.reset()
    s.openRun({ runId: 'e2e-today', sessionId: 'e2e-today', sessionName: 'Felix', agentName: 'Felix', prompt: 'Find three grants for the pilot', mode: 'full', checkpointId: null })
    s.patchRun('e2e-today', { status: 'pending', resolvedAt: Date.now() - 120_000 })
    const m = window.__mailReviewStore
    m.reset()
    m.ingestTriage('e2e-acct', 'INBOX', [{ folder: 'INBOX', uid: 7, subject: 'Quarterly numbers?', from: { name: 'Dana', address: 'dana@example.com' }, reason: 'asks a question', score: 80 }])
    return { a: a.id, b: b.id, wait }
  })

  // ── Today from the switch ──
  await win.click('[data-switch="today"]')
  await settle()
  check('Team | Today switch opens Today', (await view()) === 'today')
  await win.waitForSelector('[data-testid="today-view"][data-loading="false"]', { timeout: 8000 })

  const hero = await win.evaluate(() => {
    const h = document.querySelector('[data-testid="today-hero"]')
    return { kind: h?.getAttribute('data-kind'), text: h?.textContent ?? '' }
  })
  check('a case waiting on you leads the hero', hero.kind === 'case', JSON.stringify(hero))
  check('the hero says how many compete (1 of 2)', /1 of 2/.test(hero.text), hero.text)
  const leading = /Northwind/.test(hero.text) ? 'Northwind' : /Contoso/.test(hero.text) ? 'Contoso' : null
  check('the hero names a seeded case', !!leading, hero.text)

  await win.click('[data-testid="today-snooze"]')
  await settle()
  const after = await win.textContent('[data-testid="today-hero"]')
  const other = leading === 'Northwind' ? 'Contoso' : 'Northwind'
  check('"Not now" hands the hero to the other case', after.includes(other) && !/1 of 2/.test(after), after)
  const snoozes = await win.evaluate(() => JSON.parse(localStorage.getItem('wos:hero-snooze') || '{}'))
  check('the snooze is stored until tomorrow morning', Object.values(snoozes).some((t) => t > Date.now() + 60_000), JSON.stringify(snoozes))

  const away = await win.textContent('[data-today="away"]')
  check('While you were away: the finished run', away.includes('Felix finished: Find three grants'), away)
  check('While you were away: the agent note on the case', away.includes('Salary band confirmed'), away)

  const mail = await win.textContent('[data-today="mail"]')
  check('mail waiting for a reply shows in the Mail card', mail.includes('Quarterly numbers?'), mail)

  // ── a file created while the app runs ──
  fs.writeFileSync(path.join(ws, 'Pilot budget.csv'), 'item,amount\nseats,12\n')
  await win.waitForSelector('[data-today="files"] [data-file="Pilot budget.csv"]', { timeout: 8000 }).catch(() => {})
  const fileTile = await win.$('[data-today="files"] [data-file="Pilot budget.csv"]')
  check('a new file appears among the files', !!fileTile)
  if (fileTile) {
    await fileTile.click()
    await settle()
    const tab = await win.evaluate(() => [...document.querySelectorAll('[class*="_tabOn_"]')].map((t) => t.textContent).join('|'))
    check('…and opens on the stage', (await view()) === 'stage' && tab.includes('Pilot budget'), `${await view()} ${tab}`)
    await win.click('[data-testid="stage-landscape"]')
    await settle()
  }

  // ── the hero opens the case in Cases ──
  await win.click('[data-switch="today"]').catch(() => {})
  await settle()
  await win.click('[data-testid="today-hero-go"]')
  await settle()
  const picked = await win.evaluate(() => document.querySelector('[data-case][class*="_sel_"]')?.getAttribute('data-case'))
  const otherId = other === 'Northwind' ? seeded.a : seeded.b
  check('the hero action opens that case in Cases', (await view()) === 'cases' && picked === otherId, `${await view()} ${picked} want ${otherId}`)

  // ── Menu → Home is Today; Esc steps back ──
  await win.click('[data-dock="menu"]')
  await settle()
  await win.click('[data-menu="home"]')
  await settle()
  check('Menu → Home opens Today in the landscape', (await view()) === 'today')
  await win.keyboard.press('Escape')
  await settle()
  check('Esc steps back to the team', (await view()) === 'overview')

  // ── the project menu offers Open folder ──
  await win.click('[data-testid="project-pill"]')
  await win.waitForTimeout(400)
  check('the project menu offers Open folder…', !!(await win.$('[data-testid="project-open-folder"]')))
  await win.keyboard.press('Escape')
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
