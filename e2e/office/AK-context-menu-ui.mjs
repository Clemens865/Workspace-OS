// Phase AK — right-click menus in the LIVE app, on the REAL engine.
//
// AJ proved the engine emits its context menu; this proves the app shows it:
// a right-click on Writer text, a Calc cell and an Impress slide opens our menu
// with the engine's items, submenus open on hover, a pick dispatches (Heading 1
// lands in the saved .docx), our own dialogs are routed to (Format cells), and
// the native menu bar's check marks follow the engine's state (Bold).
import fs from 'node:fs'
import path from 'node:path'
import { launch, newDoc, focusDoc, type, selectAll, save, docXml, poll, makeReporter, enginePresent, shot, TESTROOT } from './_harness.mjs'

if (!enginePresent()) { console.log('SKIP: engine missing'); process.exit(0) }
const R = makeReporter('AK context menu UI')
const { app, win } = await launch()
// The office harness drives the legacy layout ("New document" button); the dev
// profile may have the new shell switched on from other work — switch it off
// for this run the way browser-tabs.mjs switches it on.
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
// The startup splash returns after a reload; Enter lets us in.
for (let i = 0; i < 20 && await win.locator('[class*=splash]').first().isVisible().catch(() => false); i++) {
  await win.keyboard.press('Enter')
  await win.waitForTimeout(300)
}

const MENU = '[data-testid="context-menu"]'
const rightClickDoc = async (x, y) => {
  await win.locator('[class*=docWrap]').first().click({ button: 'right', position: { x, y }, force: true })
  return win.locator(MENU).first().waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false)
}
const menuLabels = async () => (await win.locator(`${MENU} [role^=menuitem] [class*=label]`).allInnerTexts()).map((l) => l.trim())
const closeMenu = async () => { await win.keyboard.press('Escape'); await win.waitForTimeout(150) }
/** Menu-bar item state via Electron's Menu API (main process). */
// Walks a menu path (Format ▸ Text ▸ Bold — the office menus mirror LibreOffice's nesting).
const menuBarItem = (...labels) => app.evaluate(({ Menu }, labels) => {
  let items = Menu.getApplicationMenu()?.items ?? []
  let it = null
  for (const l of labels) { it = items.find((x) => x.label === l); if (!it) return null; items = it.submenu?.items ?? [] }
  return it ? { checked: it.checked, enabled: it.enabled, type: it.type } : null
}, labels)

try {
  // ── Writer ─────────────────────────────────────────────────────────────
  await newDoc(win, 'Word')
  // The app may pick "New Document 2.docx" when a same-named tab is still open
  // from a previous run — read whichever New Document*.docx is newest.
  const newest = () => fs.readdirSync(TESTROOT).filter((f) => /^New Document.*\.docx$/.test(f))
    .map((f) => path.join(TESTROOT, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
  const docx = newest()
  await focusDoc(win)
  await type(win, 'Right-click me')
  R.ok(await rightClickDoc(140, 90), 'writer: right-click on text opens the menu')
  let labels = await menuLabels()
  R.ok(labels.includes('Paragraph') && labels.includes('Insert Comment'), `writer: engine items present (${labels.length}: ${labels.slice(0, 6).join(' · ')}…)`)
  R.ok(!labels.includes('No Break') && !labels.includes('Open Local Copy'), 'writer: hidden/disabled entries are gone')
  await win.locator(`${MENU} [role=menuitem]`, { hasText: 'Paragraph' }).first().hover()
  const sub = win.locator(`${MENU} [role=menuitemcheckbox]`, { hasText: 'Heading 1' })
  R.ok(await sub.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false), 'writer: Paragraph submenu opens on hover')
  await shot(win, 'AK-writer-menu')
  await sub.click()
  R.ok(!(await win.locator(MENU).isVisible().catch(() => false)), 'writer: picking an item closes the menu')
  await win.waitForTimeout(600)
  const styled = await poll(async () => { await save(win); return /w:pStyle w:val="Heading1"/.test(docXml(docx)) }, { timeout: 25000, interval: 800 })
  R.ok(styled, 'writer: Heading 1 from the menu is in the saved .docx')

  // Native menu bar follows the engine: Bold on the selection → Format ▸ Bold checked.
  // Heading 1 is bold by style, so read the state first and assert it TOGGLES
  // each way — that is what proves the check mark tracks the engine.
  await selectAll(win)
  await win.waitForTimeout(400)
  const before = (await menuBarItem('Format', 'Text', 'Bold'))?.checked ?? false
  await win.locator('[class*=tabContent] [title="Bold"]').first().click()
  const flipped = await poll(async () => (await menuBarItem('Format', 'Text', 'Bold'))?.checked === !before, { timeout: 6000 })
  R.ok(flipped, `menu bar: Format ▸ Bold check mark follows the engine (${before} → ${!before})`)
  await win.locator('[class*=tabContent] [title="Bold"]').first().click()
  const back = await poll(async () => (await menuBarItem('Format', 'Text', 'Bold'))?.checked === before, { timeout: 6000 })
  R.ok(back, `menu bar: … and back (${!before} → ${before})`)

  // Keyboard: the menu takes focus; ↓ moves, → opens a submenu, Esc closes.
  R.ok(await rightClickDoc(140, 90), 'writer: menu reopened for keyboard navigation')
  // Walk down to the first row that owns a submenu (which row that is depends
  // on the selection: Cut/Copy are enabled only with one), open it with →, and
  // expect focus to have moved into a NESTED menu.
  const focusInfo = () => win.evaluate(() => {
    const el = document.activeElement
    const menus = el ? [...document.querySelectorAll('[data-testid="context-menu"] [role=menu]')] : []
    return { id: el?.dataset?.id ?? '', hasPopup: el?.getAttribute('aria-haspopup') === 'menu', nested: menus.some((m) => m.contains(el)) }
  })
  let steps = 0
  while (steps++ < 10 && !(await focusInfo()).hasPopup) await win.keyboard.press('ArrowDown')
  const parent = await focusInfo()
  await win.keyboard.press('ArrowRight')
  await win.waitForTimeout(200)
  const child = await focusInfo()
  R.ok(parent.hasPopup && child.nested && child.id !== parent.id, `writer: ↓ reaches a submenu row (${parent.id}), → focuses its first item (${child.id})`)
  await win.keyboard.press('ArrowLeft')
  await win.waitForTimeout(150)
  R.ok((await focusInfo()).id === parent.id, 'writer: ← returns focus to the parent row')
  await closeMenu()
  R.ok(!(await win.locator(MENU).isVisible().catch(() => false)), 'writer: Esc closes the menu')

  // ── Calc ───────────────────────────────────────────────────────────────
  await newDoc(win, 'Excel')
  R.ok(await rightClickDoc(120, 60), 'calc: right-click on a cell opens the menu')
  labels = await menuLabels()
  R.ok(labels.includes('Paste Special') && labels.includes('Format Cells…'), `calc: engine items present (${labels.slice(0, 6).join(' · ')}…)`)
  await win.locator(`${MENU} [role=menuitem]`, { hasText: 'Format Cells…' }).first().click()
  R.ok(await win.getByText('Format cells', { exact: true }).waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false), 'calc: Format Cells… opens our own dialog, not the engine tunnel')
  await win.keyboard.press('Escape')
  await win.waitForTimeout(200)
  // Header strips keep the app's own menus.
  const colHeader = win.locator('[class*=colHeader], [data-testid="col-headers"]').first()
  if (await colHeader.isVisible().catch(() => false)) {
    await colHeader.click({ button: 'right', position: { x: 60, y: 10 }, force: true })
    const shown = await win.locator(MENU).first().waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)
    labels = shown ? await menuLabels() : []
    R.ok(shown && labels.some((l) => l.startsWith('Insert column')), 'calc: column header keeps the app menu')
    await closeMenu()
  }

  // Sheet tab menu: Duplicate adds a tab; Hide removes it from the strip.
  const tabs = () => win.locator('[data-sheet-tab]').count()
  await win.locator('[data-sheet-tab="0"]').click({ button: 'right' })
  R.ok(await win.locator(MENU).first().waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false), 'calc: right-click on a sheet tab opens the tab menu')
  await win.locator(`${MENU} [role=menuitem]`, { hasText: 'Duplicate sheet' }).first().click()
  R.ok(await poll(async () => (await tabs()) === 2, { timeout: 8000 }), 'calc: Duplicate sheet from the tab menu adds a tab')
  await win.locator('[data-sheet-tab="1"]').click({ button: 'right' })
  await win.locator(`${MENU} [role=menuitem]`, { hasText: 'Hide sheet' }).first().click()
  R.ok(await poll(async () => (await tabs()) === 1, { timeout: 8000 }), 'calc: Hide sheet from the tab menu hides the tab')
  await win.locator('[data-sheet-tab="0"]').click({ button: 'right' })
  await win.locator(`${MENU} [role=menuitem]`, { hasText: 'Show sheet' }).first().hover()
  const hiddenName = win.locator(`${MENU} [role=menuitem]`, { hasText: 'Sheet1 (2)' }).first()
  R.ok(await hiddenName.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false), 'calc: Show sheet lists the hidden sheet by name')
  await hiddenName.click()
  R.ok(await poll(async () => (await tabs()) === 2, { timeout: 8000 }), 'calc: … and shows it again')

  // ── Impress ────────────────────────────────────────────────────────────
  await newDoc(win, 'PowerPoint')
  const box = await win.locator('[class*=docWrap]').first().boundingBox()
  // Empty slide area: the left margin, mid-height (placeholders sit centred).
  const opened = await rightClickDoc(Math.round(box.width * 0.04), Math.round(box.height * 0.5))
  if (!opened) await shot(win, 'AK-impress-nomenu')
  R.ok(opened, 'impress: right-click on the slide opens the menu')
  labels = opened ? await menuLabels() : []
  R.ok(labels.includes('Layout') && labels.includes('Slide Properties…'), `impress: engine items present (${labels.slice(0, 6).join(' · ')}…)`)
  if (labels.includes('Layout')) {
    await win.locator(`${MENU} [role=menuitem]`, { hasText: 'Layout' }).first().hover()
    R.ok(await win.locator(`${MENU} [role=menuitem]`, { hasText: 'Title Only' }).first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false), 'impress: Layout submenu lists the auto-layouts')
    await shot(win, 'AK-impress-menu')
  }
  await closeMenu()
  // Slide thumbnail menu: Duplicate adds a slide; Hide dims it.
  const slides = () => win.locator('[data-slide-tab]').count()
  await win.locator('[data-slide-tab="0"]').click({ button: 'right' })
  R.ok(await win.locator(MENU).first().waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false), 'impress: right-click on a thumbnail opens the slide menu')
  await win.locator(`${MENU} [role=menuitem]`, { hasText: 'Duplicate slide' }).first().click()
  R.ok(await poll(async () => (await slides()) === 2, { timeout: 8000 }), 'impress: Duplicate slide from the thumbnail menu adds a slide')
  await win.locator('[data-slide-tab="1"]').click({ button: 'right' })
  await win.locator(`${MENU} [role=menuitem]`, { hasText: 'Hide slide' }).first().click()
  R.ok(await poll(async () => (await win.locator('[data-slide-tab="1"][data-hidden="true"]').count()) === 1, { timeout: 8000 }), 'impress: Hide slide dims the thumbnail')
  await shot(win, 'AK-impress-rail')
} catch (e) {
  R.ok(false, `unexpected: ${e.message}`)
} finally {
  await app.close().catch(() => {})
}
process.exit(R.done() ? 0 : 1)
