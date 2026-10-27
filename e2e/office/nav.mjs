// Navigation smoke: quick-open (⌘P + Go menu), Library search (FTS5 content
// hit), and the View-menu Files/terminal toggles. Engine-independent — uses
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

  // ── 3. Library search returns a content hit from the FTS index ───────────
  // (the old sidebar Search panel is retired; content search lives in the Library)
  await win.click('[data-stage-dock="library"]')
  const lib = win.getByTestId('library-search')
  t.ok(await poll(() => lib.isVisible().catch(() => false)), 'the stage topbar opens the Library search')
  await win.evaluate(() => window.workspace.search.start().catch(() => {}))
  const hitSel = `[data-library-file="${NAV_FILE}"]`
  const hit = await poll(async () => {
    // Retype to re-trigger the debounce in case indexing finished after the query.
    await lib.fill('')
    await lib.fill(TOKEN)
    await win.waitForTimeout(700)
    return win.locator(hitSel).isVisible().catch(() => false)
  }, { timeout: 30000, interval: 200 })
  t.ok(!!hit, `Library search finds "${TOKEN}" inside ${NAV_FILE} (content index)`)
  await shot(win, 'nav-search-panel')

  // Clicking the hit opens the file on the stage.
  await win.click(hitSel)
  const opened = await poll(() => win.locator('.monaco-editor').first().isVisible().catch(() => false))
  t.ok(!!opened, 'clicking a search hit opens the file')

  // ── 4. View menu: Files and the terminal ──────────────────────────────────
  const surface = () => win.evaluate(() => document.querySelector('[data-testid="stage-surface-tab"]')?.textContent ?? '')
  await win.click('[data-stage-dock="menu"]')
  await win.click('[data-menu="settings"]')
  await poll(async () => (await surface()) === 'Settings')
  await clickMenu(app, 'view-toggle-files')
  t.ok(await poll(async () => (await surface()) === 'Files'), 'View ▸ Toggle File Panel brings Files forward on the stage')

  const terminalOpen = () => win.evaluate(() => {
    const d = document.querySelector('[data-testid="terminal-dock"]')
    return !!d && d.getBoundingClientRect().height > 0
  })
  const before = await terminalOpen()
  await clickMenu(app, 'view-toggle-terminal')
  t.ok(await poll(async () => (await terminalOpen()) !== before), 'View ▸ Toggle Terminal toggles the terminal dock')
  await clickMenu(app, 'view-toggle-terminal')
  t.ok(await poll(async () => (await terminalOpen()) === before), 'toggling again restores it')

  // ⌘J keyboard path drives the same toggle.
  await win.keyboard.press('Meta+j')
  t.ok(await poll(async () => (await terminalOpen()) !== before), '⌘J toggles the terminal')
  await win.keyboard.press('Meta+j')
  await poll(async () => (await terminalOpen()) === before)

  await shot(win, 'nav-final')
  await app.close()
  process.exit(t.done() ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
