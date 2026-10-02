// Sprint 2 navigation smoke: quick-open (⌘P + Go menu), sidebar Search panel
// (FTS5 content hit), and View-menu panel toggles. Engine-independent — uses
// a markdown file, so it runs even without the LibreOffice build mounted.
import fs from 'fs'
import path from 'path'
import { launch, poll, shot, makeReporter } from './_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const TESTROOT = '/tmp/wos-test'
const NAV_FILE = 'nav-notes.md'
const TOKEN = 'zebrafission' // unique content token for the search-index assertion

const clickMenu = (app, id) =>
  app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
    if (!item) throw new Error(`menu item not found: ${itemId}`)
    item.click()
  }, id)

/** Visibility of a CSS-module element ('_name_hash…'), false when unmounted/hidden. */
const moduleVisible = (win, name) =>
  win.evaluate((n) => {
    const el = document.querySelector(`[class*="_${n}_"]`)
    return !!el && el.offsetParent !== null
  }, name)

async function main() {
  fs.mkdirSync(TESTROOT, { recursive: true })
  fs.writeFileSync(
    path.join(TESTROOT, NAV_FILE),
    `# Nav Notes\n\nThe secret word is ${TOKEN} quokka.\n`,
  )

  const t = makeReporter('nav')
  const { app, win } = await launch()

  // ── 1. ⌘P opens quick-open; fuzzy match + Enter opens the file ────────────
  await win.keyboard.press('Meta+p')
  const qoInput = win.getByTestId('quick-open-input')
  t.ok(await qoInput.isVisible().catch(() => false), '⌘P opens the quick-open palette')

  await qoInput.fill('nav-notes')
  const topHit = await poll(async () => {
    const name = await win.locator('[class*="_resultName_"]').first().textContent().catch(() => null)
    return name === NAV_FILE
  })
  t.ok(!!topHit, 'fuzzy query ranks the target file first')
  await win.keyboard.press('Enter')
  t.ok(!(await qoInput.isVisible().catch(() => false)), 'palette closes after choosing a file')
  const editorUp = await poll(() => win.locator('.monaco-editor').first().isVisible().catch(() => false), { timeout: 15000 })
  t.ok(!!editorUp, 'chosen markdown file opens in the canvas (Monaco)')
  await shot(win, 'nav-quickopen')

  // ── 2. Go ▸ Go to File… (native menu wiring) opens the same palette ───────
  await clickMenu(app, 'go-quick-open')
  const viaMenu = await poll(() => win.getByTestId('quick-open-input').isVisible().catch(() => false))
  t.ok(!!viaMenu, 'Go ▸ Go to File… menu item opens quick-open')
  await win.keyboard.press('Escape')
  await poll(async () => !(await win.getByTestId('quick-open-input').isVisible().catch(() => true)))

  // ── 3. Sidebar Search panel returns a content hit from the FTS index ──────
  await win.getByRole('button', { name: 'Search', exact: true }).click()
  const spInput = win.getByTestId('search-panel-input')
  t.ok(await spInput.isVisible().catch(() => false), 'sidebar Search tab shows the search panel')

  await spInput.fill(TOKEN)
  const hit = await poll(async () => {
    // Retype to re-trigger the debounce in case indexing finished after the query.
    const visible = await win.getByText(NAV_FILE).and(win.locator(`[class*="_hitName_"]`)).first().isVisible().catch(() => false)
    if (!visible) { await spInput.fill(''); await spInput.fill(TOKEN) }
    return visible
  }, { timeout: 30000, interval: 900 })
  t.ok(!!hit, `search panel finds "${TOKEN}" inside ${NAV_FILE} (content index)`)
  await shot(win, 'nav-search-panel')

  // Clicking the hit opens/activates the file.
  await win.locator(`[class*="_hit_"]`).first().click()
  const stillOpen = await poll(() => win.locator('.monaco-editor').first().isVisible().catch(() => false))
  t.ok(!!stillOpen, 'clicking a search hit opens the file')

  // ── 4. View menu toggles the panels ────────────────────────────────────────
  t.ok(await moduleVisible(win, 'filePanel'), 'file panel starts visible')
  await clickMenu(app, 'view-toggle-files')
  t.ok(await poll(async () => !(await moduleVisible(win, 'filePanel'))), 'View ▸ Toggle File Panel hides the sidebar')
  await clickMenu(app, 'view-toggle-files')
  t.ok(await poll(() => moduleVisible(win, 'filePanel')), 'toggling again restores the sidebar')

  t.ok(await moduleVisible(win, 'terminal'), 'terminal starts visible')
  await clickMenu(app, 'view-toggle-terminal')
  t.ok(await poll(async () => !(await moduleVisible(win, 'terminal'))), 'View ▸ Toggle Terminal hides the terminal strip')
  await clickMenu(app, 'view-toggle-terminal')
  t.ok(await poll(() => moduleVisible(win, 'terminal')), 'toggling again restores the terminal')

  // ⌘J keyboard path drives the same toggle.
  await win.keyboard.press('Meta+j')
  t.ok(await poll(async () => !(await moduleVisible(win, 'terminal'))), '⌘J toggles the terminal')
  await win.keyboard.press('Meta+j')
  await poll(() => moduleVisible(win, 'terminal'))

  await shot(win, 'nav-final')
  await app.close()
  process.exit(t.done() ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
