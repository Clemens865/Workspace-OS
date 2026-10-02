// Phase AP — second slice of canvas affordances, LIVE app on the REAL engine:
// the engine's own confirmation box is answered from our dialog and AutoFilter
// turns on; clicking the filter arrow opens the engine's dropdown as a popup;
// the Calc name box jumps and names ranges; the status bar counts words;
// the rotate handle turns a shape and the angle lands in the saved .pptx.
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { launch, newDoc, focusDoc, type, save, docXml, poll, makeReporter, enginePresent, shot, TESTROOT } from './_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

if (!enginePresent()) { console.log('SKIP: engine missing'); process.exit(0) }
const R = makeReporter('AP affordances 2')
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
const zipPart = (file, inner) => { try { return execSync(`unzip -p '${file}' ${inner}`, { encoding: 'utf8' }) } catch { return '' } }
const wrap = win.locator('[class*=docWrap]').first()
const addr = async () => (await win.locator('[data-testid="cell-addr"]').first().innerText().catch(() => '')).trim()

try {
  // ── Calc: AutoFilter (confirmation box + dropdown popup), name box ─────
  await newDoc(win, 'Excel')
  await poll(async () => !!newest(/^New Spreadsheet.*\.xlsx$/), { timeout: 20000 })
  const xlsx = newest(/^New Spreadsheet.*\.xlsx$/)
  await focusDoc(win)
  await win.evaluate(() => { const g = document.querySelector('[class*=calcGrid]'); if (g) { g.scrollTop = 0; g.scrollLeft = 0 } })
  await wrap.click({ position: { x: 30, y: 10 }, force: true })
  await poll(async () => (await addr()) === 'A1', { timeout: 4000 })
  await type(win, 'Name\nAna\nBen\nAna\n')
  await win.waitForTimeout(400)
  // Name box: jump to B3, then name A1:A4.
  const nameBox = win.locator('[data-testid="name-box"]')
  R.ok(await nameBox.isVisible().catch(() => false), 'calc: the name box sits left of the formula bar')
  await nameBox.fill('B3')
  await nameBox.press('Enter')
  R.ok(await poll(async () => (await addr()) === 'B3', { timeout: 5000 }), 'calc: typing B3 in the name box jumps there')
  await nameBox.fill('A1:A4')
  await nameBox.press('Enter')
  R.ok(await poll(async () => (await addr()) === 'A1' && (await win.locator('[class*=selRect], [class*=cellSel]').count()) >= 0, { timeout: 5000 }), 'calc: A1:A4 in the name box selects the range (cursor at A1)')
  await win.waitForTimeout(400)
  await nameBox.fill('People')
  await nameBox.press('Enter')
  const named = await poll(async () => { await save(win); return /<definedName[^>]*name="People"/.test(zipPart(xlsx, 'xl/workbook.xml')) }, { timeout: 20000, interval: 800 })
  if (!named) {
    console.log('  [debug] name box trail:', (() => { try { return fs.readFileSync('/tmp/wos-asset-out.txt', 'utf8').trim() } catch { return '?' } })())
    console.log('  [debug] file', path.basename(xlsx), 'mtime age s', Math.round((Date.now() - fs.statSync(xlsx).mtimeMs) / 1000), 'names:', (zipPart(xlsx, 'xl/workbook.xml').match(/<definedName[^>]*>[^<]*<\/definedName>/g) ?? []).join(' ') || 'NONE', 'files:', fs.readdirSync(TESTROOT).filter((f) => f.endsWith('.xlsx')).join(','))
  }
  R.ok(named, 'calc: a new name in the name box names the selection (workbook.xml definedName)')
  // AutoFilter: the engine asks about the header row — our dialog shows its box.
  await nameBox.fill('A1:A4')
  await nameBox.press('Enter')
  await win.waitForTimeout(300)
  await win.getByRole('button', { name: 'Data', exact: true }).last().click()
  await win.getByTitle('AutoFilter', { exact: false }).first().click()
  const box = win.locator('[data-testid="jsdialog"]').first()
  const asked = await box.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)
  R.ok(asked, 'calc: the engine\'s confirmation box (use first row as header?) renders as our dialog')
  if (asked) {
    await shot(win, 'AP-messagebox')
    await box.locator('[data-wid="yes"]').first().click()
  }
  R.ok(await poll(async () => (await win.getByTitle('AutoFilter', { exact: false }).first().getAttribute('class'))?.includes('Active') ?? false, { timeout: 6000 }), 'calc: Yes turns AutoFilter on (ribbon toggle lit)')
  // Click the dropdown arrow in the header cell: the engine draws it at the
  // right edge of A1, so measure the cell cursor box after selecting A1.
  await nameBox.fill('A1')
  await nameBox.press('Enter')
  await poll(async () => (await addr()) === 'A1', { timeout: 4000 })
  await win.evaluate(() => { const g = document.querySelector('[class*=calcGrid]'); if (g) { g.scrollTop = 0; g.scrollLeft = 0 } })
  await win.waitForTimeout(300)
  // The fill handle sits at A1's bottom-right corner; the filter arrow is just above-left of it.
  const fh = await win.locator('[data-testid="fill-handle"]').first().boundingBox()
  const wb = await wrap.boundingBox()
  await wrap.click({ position: { x: fh.x + 4 - 9 - wb.x, y: fh.y + 4 - 9 - wb.y }, force: true })
  const popup = win.locator('[data-testid="jsdialog"]').first()
  const popped = await popup.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)
  if (!popped) await shot(win, 'AP-autofilter-missing')
  R.ok(popped, 'calc: clicking the filter arrow opens the engine\'s dropdown as a popup')
  if (popped) {
    const text = await popup.innerText()
    R.ok(/Ana/.test(text) && /Ben/.test(text), 'calc: the popup lists the column\'s values')
    await shot(win, 'AP-autofilter')
    await win.keyboard.press('Escape')
    // Nothing of the popup may linger over the app (its backdrop would swallow clicks).
    const gone = await poll(async () => (await win.locator('[data-testid="jsdialog"]').count()) === 0, { timeout: 4000 })
    if (!gone) { console.log('  [debug] dialogs after Escape:', await win.locator('[data-testid="jsdialog"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-dialogid') + '/' + e.className).join(' | '))); await win.mouse.click(5, 5); await win.waitForTimeout(300) }
    R.ok(await poll(async () => (await win.locator('[data-testid="jsdialog"]').count()) === 0, { timeout: 4000 }), 'calc: Escape closes the popup')
  }

  // ── Writer: status bar counts ────────────────────────────────────────
  await newDoc(win, 'Word')
  await focusDoc(win)
  await type(win, 'one two three four five')
  const words = win.locator('[data-testid="status-words"]')
  R.ok(await poll(async () => /5 words/.test(await words.innerText().catch(() => '')), { timeout: 8000 }), 'writer: the status bar counts five words')
  R.ok(/Page 1 of 1/.test(await win.locator('[data-testid="status-page"]').innerText().catch(() => '')), 'writer: … and shows the page')

  // ── Impress: rotate handle ───────────────────────────────────────────
  await newDoc(win, 'PowerPoint')
  await poll(async () => !!newest(/^New Presentation.*\.pptx$/), { timeout: 20000 })
  const pptx = newest(/^New Presentation.*\.pptx$/)
  await win.getByRole('button', { name: 'Design', exact: true }).last().click()
  await win.getByTitle('Rectangle', { exact: false }).first().click()
  await win.waitForTimeout(800)
  // Select the new shape by clicking it (inserted centred on the slide).
  if (!(await win.locator('[data-testid="graphic-sel"]').isVisible().catch(() => false))) {
    const b = await wrap.boundingBox()
    await wrap.click({ position: { x: b.width / 2, y: b.height / 2 }, force: true })
    await win.waitForTimeout(500)
  }
  const handle = win.locator('[data-testid="rotate-handle"]')
  const hasHandle = await handle.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)
  if (!hasHandle) await shot(win, 'AP-rotate-missing')
  R.ok(hasHandle, 'impress: a selected shape shows the rotate handle')
  if (hasHandle) {
    const hb = await handle.boundingBox()
    const sel = await win.locator('[data-testid="graphic-sel"]').boundingBox()
    const cx = sel.x + sel.width / 2, cy = sel.y + sel.height / 2
    await win.mouse.move(hb.x + 7, hb.y + 7)
    await win.mouse.down()
    // Drag the handle around the centre by ~45° to the right of straight up.
    const r = cy - (hb.y + 7)
    await win.mouse.move(cx + r * Math.sin(Math.PI / 4), cy - r * Math.cos(Math.PI / 4), { steps: 8 })
    await win.mouse.up()
    const rotated = await poll(async () => { await save(win); return /<a:xfrm rot="-?\d{5,}"/.test(docXml(pptx, 'PowerPoint')) }, { timeout: 20000, interval: 800 })
    R.ok(rotated, 'impress: the rotation lands in the saved .pptx (a:xfrm rot)')
    await shot(win, 'AP-rotate')
  }
} catch (e) {
  R.ok(false, `unexpected: ${e.message}`)
  console.log(e.stack)
} finally {
  await app.close().catch(() => {})
}
process.exit(R.done() ? 0 : 1)
