// Stress test for the "user keeps 50 files open" scenario. Opens many documents
// (cycling Word/Excel/PowerPoint), then jumps around between them, asserting each
// renders and the engine never permanently wedges. Validates the resident-doc
// cache + LRU eviction + the self-healing watchdog at scale.
import * as H from './_harness.mjs'
import fs from 'fs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const TESTROOT = '/tmp/wos-test'
const N = 50
const guard = setTimeout(() => { console.log('STRESS HUNG'); process.exit(2) }, 600000)

// Build N deterministic files cycling the three office types.
const tpl = ['test-sheet.xlsx', 'test-deck.pptx', 'test-document.docx'].filter((f) => fs.existsSync(`${TESTROOT}/${f}`))
const names = []
for (let i = 0; i < N; i++) {
  const src = tpl[i % tpl.length]
  const ext = src.split('.').pop()
  const dst = `stress-${String(i).padStart(2, '0')}.${ext}`
  fs.copyFileSync(`${TESTROOT}/${src}`, `${TESTROOT}/${dst}`)
  names.push(dst)
}

const { app, win } = await H.launch()
win.on('pageerror', (e) => console.log('  [pageerror]', e.message.split('\n')[0]))
const painted = () => win.evaluate(() =>
  [...document.querySelectorAll('canvas')].some((c) => c.width > 400 && c.height > 400) &&
  !document.body.innerText.includes('Rendering…'))
async function openFile(name) {
  await win.getByText(name, { exact: true }).first().click()
  return H.poll(painted, { timeout: 16000 })
}

let openedOk = 0
let firstOpenMs = 0
const t0 = Date.now()
// 1) open all N in sequence
for (const name of names) {
  if (await openFile(name)) openedOk++
  else console.log(`  open failed: ${name}`)
}
firstOpenMs = Date.now() - t0
console.log(`opened ${openedOk}/${N} files in ${(firstOpenMs / 1000).toFixed(1)}s`)

// 2) jump around: recent (cache hits) + far-back (LRU-evicted, must reload) + edits
let revisitOk = 0
const visits = [names[49], names[0], names[48], names[5], names[47], names[1], names[25], names[49], names[10], names[2]]
const switchTimes = []
for (const name of visits) {
  const s = Date.now()
  const ok = await openFile(name)
  switchTimes.push(Date.now() - s)
  if (ok) revisitOk++
  else console.log(`  revisit failed: ${name}`)
}
console.log(`revisited ${revisitOk}/${visits.length}; switch ms: ${switchTimes.join(',')}`)

// 3) edit a recently-opened spreadsheet to prove editing still works after the churn
const sheet = names.find((n) => n.endsWith('.xlsx'))
let editOk = false
if (sheet) {
  await openFile(sheet)
  await win.locator('[class*="docWrap"] canvas').first().click({ position: { x: 80, y: 55 }, force: true }).catch(() => {})
  await H.focusDoc(win)
  await win.keyboard.type('Stress9', { delay: 35 })
  await win.keyboard.press('Enter')
  editOk = await H.poll(async () => {
    await H.save(win)
    try { return (await import('child_process')).execSync(`unzip -p '${TESTROOT}/${sheet}' xl/sharedStrings.xml`, { encoding: 'utf8' }).includes('Stress9') } catch { return false }
  })
}
console.log(`edit after churn: ${editOk}`)

await app.close().catch(() => {})
clearTimeout(guard)
const pass = openedOk === N && revisitOk === visits.length && editOk
console.log(`\n=== STRESS ${pass ? 'PASS' : 'FAIL'} (opened ${openedOk}/${N}, revisited ${revisitOk}/${visits.length}, edit ${editOk}) ===`)
process.exit(pass ? 0 : 1)
