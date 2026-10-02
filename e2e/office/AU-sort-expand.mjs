// Phase AU — Calc sort with Excel's "expand the selection" question, LIVE app
// on the REAL engine. A column picked inside a data block: Sort A→Z asks;
// "Expand" sorts whole rows by that column (names travel with their amounts),
// "Continue with the current selection" sorts only the column.
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { launch, newDoc, focusDoc, type, save, docXml, poll, makeReporter, enginePresent, shot, TESTROOT } from './_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

if (!enginePresent()) { console.log('SKIP: engine missing'); process.exit(0) }
const R = makeReporter('AU sort expand')
const { app, win } = await launch()
// The new shell (WorkspaceShell) is the default; WOS_E2E_SHELL=legacy drives the classic layout.
const NEW_SHELL = process.env.WOS_E2E_SHELL !== 'legacy'
await win.evaluate((NEW_SHELL) => {
  const K = 'workspace-os:settings'
  let cur = {}
  try { cur = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
  localStorage.setItem(K, JSON.stringify({ ...cur, newShell: NEW_SHELL }))
}, NEW_SHELL)
await win.reload()
await win.waitForSelector('#root', { timeout: 20000 })
await win.waitForTimeout(800)
for (let i = 0; i < 20 && await win.locator('[class*=splash]').first().isVisible().catch(() => false); i++) {
  await win.keyboard.press('Enter')
  await win.waitForTimeout(300)
}
const newest = (re) => fs.readdirSync(TESTROOT).filter((f) => re.test(f)).map((f) => path.join(TESTROOT, f))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
const tab = (name) => win.getByRole('button', { name, exact: true }).last()
// Shared strings are appended in first-use order, so map cell → text through them.
const cellsOf = (file, col) => {
  const sheet = docXml(file, 'Excel')
  const ss = (() => { try { return execSync(`unzip -p '${file}' xl/sharedStrings.xml`, { encoding: 'utf8' }) } catch { return '' } })()
  const strings = (ss.match(/<t[^>]*>[^<]*<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, ''))
  const out = []
  for (let r = 2; r <= 4; r++) {
    const m = sheet.match(new RegExp(`<c r="${col}${r}"([^>]*)><v>([^<]*)</v>`))
    if (!m) { out.push(''); continue }
    out.push(/t="s"/.test(m[1]) ? strings[Number(m[2])] : m[2])
  }
  return out
}

try {
  await newDoc(win, 'Excel')
  await poll(async () => !!newest(/^New Spreadsheet.*\.xlsx$/), { timeout: 20000 })
  const xlsx = newest(/^New Spreadsheet.*\.xlsx$/)
  const nameBox = win.locator('[data-testid="name-box"]')
  const goTo = async (cell) => { await nameBox.fill(cell); await nameBox.press('Enter'); await win.waitForTimeout(150); await focusDoc(win) }
  const put = async (cell, text) => { await goTo(cell); await type(win, text + '\n') }
  const data = { A1: 'Name', B1: 'Amount', C1: 'City', A2: 'Zed', B2: '3', C2: 'Oslo', A3: 'Anna', B3: '1', C3: 'Rome', A4: 'Mia', B4: '2', C4: 'Bern' }
  for (const [c, t] of Object.entries(data)) await put(c, t)
  await save(win)
  R.ok(cellsOf(xlsx, 'A').join(',') === 'Zed,Anna,Mia', `table typed (${cellsOf(xlsx, 'A').join(',')})`)
  // Pick B2:B4 (the Amount column) and sort ascending.
  await goTo('B2')
  await win.keyboard.press('Shift+ArrowDown'); await win.keyboard.press('Shift+ArrowDown')
  await win.waitForTimeout(300)
  await tab('Data').click()
  await win.locator('[data-testid="sort-asc"]').click()
  const asked = await poll(async () => win.locator('[data-testid="sort-expand"]').isVisible().catch(() => false), { timeout: 8000 })
  R.ok(asked, 'Sort A→Z on a column inside a data block asks to expand the selection')
  R.ok(/column B/.test(await win.locator('[data-testid="sort-expand"]').innerText().catch(() => '')), '… naming the picked column')
  await shot(win, 'AU-sort-ask')
  await win.locator('[data-testid="sort-expand-yes"]').click()
  const expanded = await poll(async () => { await save(win); return cellsOf(xlsx, 'A').join(',') === 'Anna,Mia,Zed' && cellsOf(xlsx, 'C').join(',') === 'Rome,Bern,Oslo' }, { timeout: 20000, interval: 800 })
  R.ok(expanded, `Expand: whole rows sorted by Amount (A=${cellsOf(xlsx, 'A').join(',')} C=${cellsOf(xlsx, 'C').join(',')})`)
  R.ok(cellsOf(xlsx, 'B').join(',') === '1,2,3', '… header row stays put')
  // Same pick, descending, current selection only.
  await goTo('B2')
  await win.keyboard.press('Shift+ArrowDown'); await win.keyboard.press('Shift+ArrowDown')
  await win.waitForTimeout(300)
  await win.locator('[data-testid="sort-desc"]').click()
  await poll(async () => win.locator('[data-testid="sort-expand"]').isVisible().catch(() => false), { timeout: 8000 })
  await win.locator('[data-testid="sort-expand-no"]').click()
  const only = await poll(async () => { await save(win); return cellsOf(xlsx, 'B').join(',') === '3,2,1' && cellsOf(xlsx, 'A').join(',') === 'Anna,Mia,Zed' }, { timeout: 20000, interval: 800 })
  R.ok(only, `Current selection: only the column sorted (B=${cellsOf(xlsx, 'B').join(',')} A=${cellsOf(xlsx, 'A').join(',')})`)
  await shot(win, 'AU-sort-done')
} catch (e) {
  R.ok(false, `unexpected: ${e.message}`)
  console.log(e.stack)
} finally {
  await app.close().catch(() => {})
}
process.exit(R.done() ? 0 : 1)
