/**
 * WOS-008 — ⌘V into a chrome text field must actually paste, and the pasted
 * text must survive into React state.
 *
 * Reported against the mail composer, but the fault is not mail's: whenever an
 * office document is open the office Edit menu owns ⌘X/C/V/A app-wide and sends
 * `edit.paste` instead of Electron's native paste role. That lands in
 * editRouter, which had two defects — it read the clipboard through
 * `navigator.clipboard.readText()` (refused, because the app denies every
 * permission request) and then wrote `input.value` directly (invisible to
 * React's value tracker, so a controlled field never updated).
 *
 * This test does NOT open a document. It sends the exact IPC the office menu
 * sends, which is the whole trigger — and keeps the test independent of the
 * engine SSD.
 *
 * Getting the second assertion right took three attempts, and the two failures
 * are worth recording because both LOOKED like passes:
 *
 *   1. Typing a character after the paste proves nothing — that keystroke fires
 *      a real onChange whose `e.target.value` reads the DOM, which already
 *      holds the pasted text, so state silently catches up.
 *   2. Blurring to force a re-render proves nothing either — it did not
 *      reliably cause one.
 *
 * Both passed with the fix reverted. What finally works is reading a value that
 * can ONLY have come from React state: the omnibox renders `Search for "…"`
 * from its `value` prop, so if that row carries the pasted text, onChange
 * really fired and a controlled field would keep it. That is the property the
 * mail composer needs — its Send reads `body` state, not the DOM.
 *
 * (Measured, not assumed: in the real app the input carries a React
 * `_valueTracker`, and a direct `.value =` assignment leaves it matching the
 * node, which is exactly what suppresses onChange.)
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'
import { killAll } from './office/_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
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

await killAll()
const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root })
const win = await app.firstWindow({ timeout: 20000 })
await win.waitForSelector('#root', { timeout: 20000 })
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  const c = (() => {
    try {
      return JSON.parse(localStorage.getItem(K) || '{}')
    } catch {
      return {}
    }
  })()
  localStorage.setItem(K, JSON.stringify({ ...c, newShell: true }))
  localStorage.removeItem('workspace-os:browser-session')
})
await win.reload()
await win.waitForSelector('#root', { timeout: 20000 })
await win.waitForTimeout(1200)
await win.evaluate(() => {
  const h = [...document.querySelectorAll('button,[role=tab],a,[role=button]')].find(
    (e) => /browser/i.test(e.textContent || '') || /browser/i.test(e.getAttribute('aria-label') || ''),
  )
  if (h) h.click()
})
await win.waitForTimeout(2500)

const ADDRESS = 'input[aria-label="Address bar"]'
const barValue = () => win.evaluate((s) => document.querySelector(s)?.value ?? '', ADDRESS)

/** Exactly what menu-office.ts does for ⌘V — see its `send('edit.paste')`. */
const sendMenuAction = (id) =>
  app.evaluate(({ BrowserWindow }, actionId) => {
    BrowserWindow.getAllWindows()[0].webContents.send('menu:run-action', actionId)
  }, id)

const setSystemClipboard = (text) =>
  app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text)
const readSystemClipboard = () => app.evaluate(({ clipboard }) => clipboard.readText())

const found = await win.evaluate((s) => !!document.querySelector(s), ADDRESS)
check('the address bar is present', found)
if (!found) {
  await app.close().catch(() => {})
  console.log(`\n  CLIPBOARD e2e: ${total - fails} passed, ${fails} failed\n`)
  process.exit(1)
}

// ---------------------------------------------------------------- paste
// Spaces matter: they make the omnibox treat the text as a SEARCH, which is
// what renders the "Search for …" row this test reads React state out of.
const PROBE = 'wos paste probe'
await setSystemClipboard(PROBE)

// Focus and empty the field, the way a person would before pasting.
await win.click(ADDRESS)
await win.waitForTimeout(300)
await win.evaluate((s) => {
  const el = document.querySelector(s)
  el.focus()
  el.setSelectionRange(0, el.value.length)
}, ADDRESS)
await win.keyboard.press('Backspace')
await win.waitForTimeout(300)
check('the field starts empty', (await barValue()) === '', `"${await barValue()}"`)

await sendMenuAction('edit.paste')
await win.waitForTimeout(800)

const afterPaste = await barValue()
check('the clipboard text was inserted into the field', afterPaste === PROBE, `"${afterPaste}"`)

// The decisive one. This text is rendered from the component's `value` PROP,
// so it can only be there if onChange fired and React state was updated. A
// paste that only mutated the DOM node leaves this row showing the old state.
const stateText = await win.evaluate(
  () => document.querySelector('#omnibox-suggestions')?.textContent ?? '(no suggestion list)',
)
check(
  'the paste reached React state, not just the DOM node',
  stateText.includes(PROBE),
  `suggestion list read "${stateText}" — it renders from state, so the paste never got there`,
)

// ---------------------------------------------------------------- copy
await setSystemClipboard('')
await win.evaluate((s) => {
  const el = document.querySelector(s)
  el.focus()
  el.setSelectionRange(0, el.value.length)
}, ADDRESS)
await sendMenuAction('edit.copy')
await win.waitForTimeout(800)

const copied = await readSystemClipboard()
check('copy reaches the system pasteboard', copied === PROBE, `"${copied}"`)

// ---------------------------------------------------------------- cut
await win.evaluate((s) => {
  const el = document.querySelector(s)
  el.focus()
  el.setSelectionRange(0, el.value.length)
}, ADDRESS)
await sendMenuAction('edit.cut')
await win.waitForTimeout(800)
await win.evaluate((s) => document.querySelector(s).focus(), ADDRESS)
await win.keyboard.type('Q')
await win.waitForTimeout(600)

const afterCut = await barValue()
check('cut emptied the field in React state too', afterCut === 'Q', `"${afterCut}"`)

await app.close().catch(() => {})
console.log(`\n  CLIPBOARD e2e: ${total - fails} passed, ${fails} failed\n`)
process.exit(fails ? 1 : 0)
