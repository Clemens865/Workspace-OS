/**
 * WOS-001: a NEW .docx must accept typing immediately, with no click first.
 *
 * The regression this guards is one the existing suite could never catch: every
 * other office test calls clickDoc()/focusDoc() before typing, which focuses the
 * very element whose missing focus WAS the bug. This test deliberately does NOT
 * click the page.
 *
 * It asserts on the SAVED FILE — the only evidence that keystrokes actually
 * reached the document. The failure mode was that everything looked right and
 * nothing arrived.
 */
import { launch, killAll, newDoc, save, docXml, type as typeText } from './_harness.mjs'
import fs from 'fs'
import path from 'path'

const TESTROOT = '/tmp/wos-test'

/** The .docx the app ACTUALLY created — it appends " 2" when a stale file or
 *  LibreOffice lock survives, and asserting on the expected name then reads the
 *  wrong file and reports a false failure. */
function newestDocx() {
  const files = fs.readdirSync(TESTROOT)
    .filter((f) => f.endsWith('.docx') && !f.startsWith('.~lock'))
    .map((f) => ({ f, t: fs.statSync(path.join(TESTROOT, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  return files[0] ? path.join(TESTROOT, files[0].f) : ''
}

let fails = 0
const check = (n, c, d) => {
  if (c) console.log(`  ✓ ${n}`)
  else { console.error(`  ✗ ${n}${d ? ` — ${d}` : ''}`); fails++ }
}

// Clean BEFORE the app starts. Doing this after launch races the engine: a
// surviving `.~lock.<file>#` makes a reopened document silently read-only while
// still rendering — the classic "renders but won't type" flake — and a stale
// "New Document.docx" makes the app create "New Document 2.docx" instead.
try { fs.mkdirSync(TESTROOT, { recursive: true }) } catch { /* exists */ }
for (const f of fs.readdirSync(TESTROOT)) {
  if (f.startsWith('New Document') || f.startsWith('.~lock')) {
    try { fs.rmSync(path.join(TESTROOT, f), { force: true }) } catch { /* in use */ }
  }
}

const { app, win } = await launch()
try {
  // The office harness drives the OLD layout. Pin it explicitly — a previous e2e
  // that flipped `newShell` on leaves it in localStorage, and every office test
  // then fails looking for a button that only exists in the old UI.
    // The new shell is the default; WOS_E2E_SHELL=legacy drives the classic layout.
  const NEW_SHELL = process.env.WOS_E2E_SHELL !== 'legacy'
await win.evaluate((NEW_SHELL) => {
    const K = 'workspace-os:settings'
    const cur = (() => { try { return JSON.parse(localStorage.getItem(K) || '{}') } catch { return {} } })()
    localStorage.setItem(K, JSON.stringify({ ...cur, newShell: NEW_SHELL }))
  }, NEW_SHELL)
  await win.reload()
  await win.waitForSelector('#root', { timeout: 20000 })
  await win.waitForTimeout(1200)

  // Create through the real UI so the canvas actually mounts (an IPC-only open
  // leaves the renderer unmounted, and then this proves nothing).
  await newDoc(win, 'Word')
  const file = newestDocx()
  check('a new Word document opened in the canvas', !!file, file || 'no .docx found')

  // Give the post-open focus/caret effect a beat, then type WITHOUT clicking.
  await win.waitForTimeout(1500)
  await typeText(win, 'wos001 typed with no click')

  await save(win)
  const xml = docXml(file, 'Word')
  check(
    'typed text reached the document without clicking first (WOS-001)',
    /wos001 typed with no click/i.test(xml),
    xml ? `document.xml had ${xml.length} bytes but not the text` : 'could not read document.xml',
  )
} finally {
  try { await app.close() } catch { /* already gone */ }
  await killAll()
}

console.log(fails === 0 ? '\nWOS-001 E2E PASS' : `\n${fails} check(s) FAILED`)
process.exit(fails === 0 ? 0 : 1)
