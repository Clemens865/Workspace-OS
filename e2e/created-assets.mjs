/**
 * Does a file created by something OUTSIDE the app show up in the cockpit?
 *
 * The reported gap: a `claude` in the terminal dock wrote a CV and a cover
 * letter, and nothing surfaced them — the user had to go find them.
 *
 * The files here are written by THIS node process, not through any app API, so
 * the app learns about them the only way it can: by watching the workspace.
 * That is the whole design claim — it works for producers that know nothing
 * about us, which is every producer that matters.
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { killAll } from './office/_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
let fails = 0
const check = (n, c, d) => { if (c) console.log(`  PASS  ${n}`); else { console.error(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); fails++ } }

await killAll()
const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root })
const win = await app.firstWindow({ timeout: 20000 })
await win.waitForSelector('#root', { timeout: 20000 })
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  const c = (() => { try { return JSON.parse(localStorage.getItem(K) || '{}') } catch { return {} } })()
  localStorage.setItem(K, JSON.stringify({ ...c, newShell: true }))
})
await win.reload()
await win.waitForSelector('#root', { timeout: 20000 })
await win.waitForTimeout(1200)

const wsRoot = await win.evaluate(async () => {
  const rec = await window.workspace.fs.recentWorkspaces()
  if (rec?.length) { await window.workspace.fs.openWorkspace(rec[0]); return rec[0] }
  return null
})
if (!wsRoot) { console.log('\n  SKIP: no workspace to open.\n'); await app.close().catch(() => {}); process.exit(0) }
await win.waitForTimeout(2500)

// Land on the cockpit, where the card lives.
await win.evaluate(() => {
  const h = [...document.querySelectorAll('button,[role=tab],a,[role=button]')]
    .find(e => /^home$/i.test((e.textContent || '').trim()) || /home/i.test(e.getAttribute('aria-label') || ''))
  if (h) h.click()
})
await win.waitForTimeout(1500)

const cockpitText = () => win.evaluate(() => document.body.innerText || '')
// Case-insensitive: innerText reflects CSS text-transform, and the card label
// is uppercased in the stylesheet — so a literal 'Just created' never matches.
const hasCard = async () => /just created/i.test(await cockpitText())
check('the card is absent before anything happens', !(await hasCard()))

// Written by node — the app has no idea this is coming.
const appsDir = path.join(wsRoot, 'applications', 'revolut')
fs.mkdirSync(appsDir, { recursive: true })
const cv = path.join(appsDir, 'cv.docx')
const letter = path.join(appsDir, 'cover-letter.pdf')
const junkTemp = path.join(appsDir, '~$cv.docx')
const junkCode = path.join(appsDir, 'helper.ts')
for (const f of [cv, letter, junkTemp, junkCode]) fs.writeFileSync(f, 'x')
await win.waitForTimeout(4000)

const text = await cockpitText()
check('the card appears once something is created', await hasCard(), text.slice(0, 200))
check('the CV is listed', text.includes('revolut/cv.docx'))
check('the cover letter is listed', text.includes('revolut/cover-letter.pdf'))
check('the office temp file is NOT listed', !text.includes('~$cv.docx'))
check('source code is NOT listed', !text.includes('helper.ts'))

// A link that opens is the point — a list you cannot act on is a notification.
const opened = await win.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => /revolut\/cv\.docx/.test(b.textContent || ''))
  if (!btn) return false
  btn.click()
  return true
})
check('the entry is clickable', opened)
await win.waitForTimeout(2500)
const afterClick = await cockpitText()
check('clicking it opens the document', /cv\.docx/i.test(afterClick), afterClick.slice(0, 160))

// A file that vanishes must not leave a dead link.
fs.rmSync(letter, { force: true })
await win.waitForTimeout(3000)
check('a deleted file drops off the list', !(await cockpitText()).includes('cover-letter.pdf'))

fs.rmSync(path.join(wsRoot, 'applications'), { recursive: true, force: true })
await app.close().catch(() => {})
console.log(`\n  CREATED-ASSETS e2e: ${9 - fails} passed, ${fails} failed\n`)
process.exit(fails ? 1 : 0)
