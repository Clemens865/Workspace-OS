/**
 * WOS-009: the office canvas must share the macOS pasteboard with the rest of
 * the world, in both directions.
 *
 * `.uno:Copy` fills the ENGINE's clipboard, which lives inside the out-of-process
 * LOK host. Nothing outside that process can see it, so copying in a .docx put
 * nothing on the system pasteboard and nothing copied elsewhere could be pasted
 * in. Both halves are asserted here against the REAL engine, because that is the
 * only thing that can prove the new host commands (`getsel`/`pastebuf`) actually
 * reach LibreOffice — a mocked bridge would pass with the engine side missing.
 *
 * The paste direction asserts on the SAVED FILE, not on the canvas: the pixels
 * changing would not prove the text entered the document model.
 */
import { launch, killAll, newDoc, save, docXml, type as typeText, focusDoc, selectAll } from './_harness.mjs'
import fs from 'fs'
import path from 'path'

const TESTROOT = '/tmp/wos-test'
const TYPED = 'wos009 copied out of a document'
const EXTERNAL = 'wos009 pasted in from another app'

function newestDocx() {
  const files = fs
    .readdirSync(TESTROOT)
    .filter((f) => f.endsWith('.docx') && !f.startsWith('.~lock'))
    .map((f) => ({ f, t: fs.statSync(path.join(TESTROOT, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  return files[0] ? path.join(TESTROOT, files[0].f) : ''
}

/**
 * Compare case-insensitively. LibreOffice's autocorrect capitalises the first
 * letter of a sentence as you type, so text typed as "wos009 …" comes back out
 * of the document as "Wos009 …". That is the engine behaving normally; an exact
 * match here fails for a reason that has nothing to do with the clipboard.
 */
const has = (haystack, needle) => haystack.toLowerCase().includes(needle.toLowerCase())

let fails = 0
const check = (n, c, d) => {
  if (c) console.log(`  ✓ ${n}`)
  else {
    console.error(`  ✗ ${n}${d ? ` — ${d}` : ''}`)
    fails++
  }
}

try {
  fs.mkdirSync(TESTROOT, { recursive: true })
} catch {
  /* exists */
}
for (const f of fs.readdirSync(TESTROOT)) {
  if (f.startsWith('New Document') || f.startsWith('.~lock')) {
    try {
      fs.rmSync(path.join(TESTROOT, f), { force: true })
    } catch {
      /* in use */
    }
  }
}

const { app, win } = await launch()

/** Exactly what the office Edit menu sends for ⌘C/⌘V (see menu-office.ts). */
const sendMenuAction = (id) =>
  app.evaluate(({ BrowserWindow }, actionId) => {
    BrowserWindow.getAllWindows()[0].webContents.send('menu:run-action', actionId)
  }, id)
const readSystemClipboard = () => app.evaluate(({ clipboard }) => clipboard.readText())
const writeSystemClipboard = (t) => app.evaluate(({ clipboard }, text) => clipboard.writeText(text), t)

try {
    // The new shell is the default; WOS_E2E_SHELL=legacy drives the classic layout.
  const NEW_SHELL = process.env.WOS_E2E_SHELL !== 'legacy'
await win.evaluate((NEW_SHELL) => {
    const K = 'workspace-os:settings'
    const cur = (() => {
      try {
        return JSON.parse(localStorage.getItem(K) || '{}')
      } catch {
        return {}
      }
    })()
    localStorage.setItem(K, JSON.stringify({ ...cur, newShell: NEW_SHELL }))
  }, NEW_SHELL)
  await win.reload()
  await win.waitForSelector('#root', { timeout: 20000 })
  await win.waitForTimeout(1200)

  await newDoc(win, 'Word')
  const file = newestDocx()
  check('a new Word document opened in the canvas', !!file, file || 'no .docx found')
  await win.waitForTimeout(1500)

  // ------------------------------------------------ document → system pasteboard
  await typeText(win, TYPED)
  await win.waitForTimeout(400)

  // Put something else on the pasteboard first, so a pass cannot come from the
  // text having been there all along.
  await writeSystemClipboard('nothing to do with the document')
  await selectAll(win)
  await sendMenuAction('edit.copy')
  await win.waitForTimeout(1500)

  const onPasteboard = await readSystemClipboard()
  check(
    'copying in a document puts the selection on the macOS pasteboard (WOS-009)',
    has(onPasteboard, TYPED),
    `pasteboard held "${onPasteboard.slice(0, 120)}"`,
  )

  // ------------------------------------------------ system pasteboard → document
  // Collapse the selection so the paste adds text instead of replacing all of it,
  // then paste something that could only have come from outside the engine.
  await focusDoc(win)
  await win.keyboard.press('ArrowRight')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(300)

  await writeSystemClipboard(EXTERNAL)
  await focusDoc(win)
  await sendMenuAction('edit.paste')
  await win.waitForTimeout(2000)

  await save(win)
  const xml = docXml(file, 'Word')
  check(
    'text copied in another app pastes into the document (WOS-009)',
    has(xml, EXTERNAL),
    xml ? `document.xml had ${xml.length} bytes but not the pasted text` : 'could not read document.xml',
  )
  check(
    'the originally typed text is still there — paste added, it did not replace',
    has(xml, TYPED),
    'the typed text went missing',
  )
} finally {
  try {
    await app.close()
  } catch {
    /* already gone */
  }
  await killAll()
}

console.log(fails === 0 ? '\nWOS-009 E2E PASS' : `\n${fails} check(s) FAILED`)
process.exit(fails === 0 ? 0 : 1)
