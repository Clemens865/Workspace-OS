// Manual screenshots for the office chapters, taken in the NEW shell with a
// fictional Northwind workspace. Output: PNGs in the scratchpad (resampled later).
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ENGINE = '/Volumes/LOBuild/core/instdir/LibreOffice.app/Contents'
const OUT = process.argv[2]
const WS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-manual-')), 'Workspace')
fs.mkdirSync(WS, { recursive: true })
try { fs.rmSync('/tmp/wos-lok-host-profile', { recursive: true, force: true }) } catch {}
try { execSync('pkill -f "out/main/index.js"') } catch {}
const app = await electron.launch({ args: [path.join(ROOT, 'out/main/index.js')], cwd: ROOT, env: { ...process.env, WORKSPACE_TEST_ROOT: WS, WOS_LOK_INSTALL: ENGINE + '/Frameworks/', WOS_LOK_FUND: ENGINE + '/Resources/fundamentalrc', WOS_LOK_HOST: path.join(ROOT, 'scripts/lok/wos-lok-host') } })
const win = await app.firstWindow({ timeout: 20000 })
await win.waitForSelector('#root', { timeout: 20000 }); await win.waitForTimeout(800)
await win.evaluate(() => { const K = 'workspace-os:settings'; let cur = {}; try { cur = JSON.parse(localStorage.getItem(K) || '{}') } catch {}; localStorage.setItem(K, JSON.stringify({ ...cur, newShell: true, terminalOpen: false })) })
await win.reload(); await win.waitForSelector('#root', { timeout: 20000 }); await win.waitForTimeout(1200)
for (let i = 0; i < 30 && await win.locator('[class*=splash]').first().isVisible().catch(() => false); i++) { await win.keyboard.press('Enter'); await win.waitForTimeout(300) }
const sleep = (ms) => win.waitForTimeout(ms)
const shot = (name) => win.screenshot({ path: path.join(OUT, name + '.png') })
const tab = (name) => win.getByRole('button', { name, exact: true }).last()
const focusDoc = async () => { for (let i = 0; i < 15; i++) { if (await win.evaluate(() => { const d = document.querySelector('[class*=docWrap]'); if (!d) return false; d.focus(); return document.activeElement === d })) return; await sleep(200) } }
const type = async (t) => { await win.keyboard.type(t, { delay: 20 }); await sleep(200) }
const macro = (n, a) => win.evaluate(([n, a]) => window.workspace.lok.officeMacro(n, a).then((r) => r.raw), [n, a])
const waitDoc = async (t) => { for (let i = 0; i < 120; i++) { const ok = await win.evaluate(() => { const c = document.querySelector('[class*=docWrap] canvas'); return !!c && c.width > 100 }).catch(() => false); const tabOk = await tab(t).isVisible().catch(() => false); if (ok && tabOk) return; await sleep(350) } }
const newDoc = async (kind, t) => {
  const btn = win.getByRole('button', { name: 'New document', exact: true })
  if (!(await btn.isVisible().catch(() => false))) { await win.getByRole('button', { name: 'Files', exact: true }).first().click(); await sleep(400) }
  await btn.click()
  const p = win.getByText(`${kind} document`)
  if (await p.isVisible().catch(() => false)) await p.click(); else await win.getByText(kind === 'Excel' ? 'Excel spreadsheet' : 'PowerPoint').click()
  await waitDoc(t); await sleep(800)
}
const rename = (from, to) => { try { fs.renameSync(path.join(WS, from), path.join(WS, to)) } catch {} }

// ── Writer ──────────────────────────────────────────────────────────────
await newDoc('Word', 'Layout'); await focusDoc()
await win.locator('select[title="Paragraph style"]').first().selectOption({ label: 'Heading 1' }).catch(() => {})
await type('Northwind Q3 sales review\n')
await type('Revenue grew 12% against Q2, led by the Nordic region. Ana Lindqvist presents the account plan on Thursday; the board deck follows this memo.\n')
await sleep(500)
// context menu on the paragraph
const wrap = () => win.locator('[class*=docWrap]').first()
{ const b = await wrap().boundingBox(); await win.mouse.click(b.x + 200, b.y + 175, { button: 'right' }); await sleep(900) }
await shot('30-writer-context-menu')
await win.keyboard.press('Escape'); await sleep(300)
// References tab + ruler visible
await tab('References').click(); await sleep(400)
await shot('31-writer-references-ruler')
// Review: a comment via the Review tab
await tab('Review').click(); await sleep(300)
await win.keyboard.press('Meta+ArrowUp').catch(() => {})
await win.getByTitle('Insert comment', { exact: false }).first().click().catch(() => {})
await sleep(600)
const draft = win.locator('[data-testid="review-draft"]')
if (await draft.isVisible().catch(() => false)) { await draft.fill('Check the Nordic figure against the August close.'); await draft.locator('xpath=following::button[contains(., "Add")][1]').click().catch(() => {}); await sleep(1200) }
await shot('32-writer-review')
// Table with grips, after the paragraph
await focusDoc(); await win.keyboard.press('End'); await win.keyboard.press('Enter'); await sleep(300)
await tab('Insert').click(); await win.getByTitle('Insert table', { exact: false }).first().click(); await sleep(400)
await win.getByRole('button', { name: /^Insert$/ }).first().click().catch(async () => { await win.keyboard.press('Enter') })
await sleep(1200)
await type('Region'); await win.keyboard.press('Tab'); await type('Q3'); await win.keyboard.press('Tab'); await type('Q2')
await sleep(600)
await shot('33-writer-table-grips')
rename('New Document.docx', 'Q3 sales review.docx')

// ── Calc ────────────────────────────────────────────────────────────────
await newDoc('Excel', 'Data'); await focusDoc()
const nameBox = win.locator('[data-testid="name-box"]')
const goTo = async (c) => { await nameBox.fill(c); await nameBox.press('Enter'); await sleep(120); await focusDoc() }
const put = async (c, t) => { await goTo(c); await type(t + '\n') }
const rows = [['Region', 'Q2', 'Q3', 'Change'], ['Nordics', '412', '486', '=C2/B2-1'], ['DACH', '388', '401', '=C3/B3-1'], ['Benelux', '205', '221', '=C4/B4-1'], ['Iberia', '150', '162', '=C5/B5-1'], ['Total', '=SUM(B2:B5)', '=SUM(C2:C5)', '=C6/B6-1']]
for (let r = 0; r < rows.length; r++) for (let c = 0; c < 4; c++) await put(String.fromCharCode(65 + c) + (r + 1), rows[r][c])
await goTo('B2'); await win.keyboard.press('Shift+ArrowDown'); await win.keyboard.press('Shift+ArrowDown'); await win.keyboard.press('Shift+ArrowDown'); await sleep(300)
await tab('Data').click(); await win.locator('[data-testid="outline-group"]').click(); await sleep(900)
await tab('Formulas').click(); await sleep(400)
await goTo('D2'); await sleep(300)
await shot('34-calc-outline-formulas')
await goTo('C2'); await win.keyboard.press('Shift+ArrowDown'); await win.keyboard.press('Shift+ArrowDown'); await win.keyboard.press('Shift+ArrowDown'); await sleep(300)
await tab('Data').click(); await win.locator('[data-testid="sort-asc"]').click(); await sleep(900)
await shot('35-calc-sort-expand')
await win.locator('[data-testid="sort-expand-yes"]').click().catch(() => {}); await sleep(800)
await win.locator('[data-testid="text-to-columns"]').click(); await sleep(1500)
await shot('36-calc-engine-dialog')
await win.keyboard.press('Escape'); await sleep(500)
rename('New Spreadsheet.xlsx', 'Q3 forecast.xlsx')

// ── Impress ─────────────────────────────────────────────────────────────
await newDoc('PowerPoint', 'Design')
await macro('WosSlideText', 'set|0|Northwind Q3 review|Revenue up 12%\tNordics lead the quarter\tAccount plan Thursday')
await sleep(600)
await tab('Design').click(); await win.getByTitle('Rectangle', { exact: true }).first().click(); await sleep(1000)
await tab('Animations').click(); await sleep(300)
await win.locator('[data-testid="anim-ooo-entrance-fly-in"]').click(); await sleep(1200)
await shot('37-impress-animations')
await tab('Transitions').click(); await sleep(300); await win.locator('[data-testid="transition-fade"]').click(); await sleep(900)
await shot('38-impress-transitions')
await win.keyboard.press('Escape')
await tab('Home').click(); await win.getByTitle('New slide', { exact: true }).first().click(); await sleep(1500)
await macro('WosSlideText', 'set|1|Regions|Nordics 486\tDACH 401\tBenelux 221')
await sleep(500)
await tab('View').click(); await win.locator('[data-testid="mode-sorter"]').click(); await sleep(2500)
await shot('39-impress-sorter')
await win.locator('[data-testid="view-close"]').click()
rename('New Presentation.pptx', 'Board deck.pptx')
console.log('CAPTURED', fs.readdirSync(OUT).join(' '))
await app.close().catch(() => {}); process.exit(0)
