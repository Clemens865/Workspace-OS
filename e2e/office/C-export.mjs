// Phase C — Export & file. Drives the ribbon Export ▾ menu for each Writer
// format and asserts a valid file is produced (and the original is untouched).
import * as H from './_harness.mjs'
import fs from 'fs'
import path from 'path'

const r = H.makeReporter('PHASE C — Export & file')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const { app, win } = await H.launch()
const file = await H.newDoc(win, 'Word') // /tmp/wos-test/New Document.docx
const dir = path.dirname(file)
const stem = path.basename(file, '.docx')
await H.clickDoc(win)
await H.type(win, 'Export this document to every format.')
await H.save(win)
const origSize = fs.statSync(file).size

// clean prior exports (anything stem.* that isn't the original .docx)
for (const f of fs.readdirSync(dir)) {
  if (f.startsWith(stem) && f !== `${stem}.docx`) fs.rmSync(path.join(dir, f))
}

const formats = [
  ['PDF', 'pdf'], ['OpenDocument (.odt)', 'odt'], ['Rich Text (.rtf)', 'rtf'],
  ['Plain Text (.txt)', 'txt'], ['Web Page (.html)', 'html'], ['EPUB (.epub)', 'epub'],
]

// screenshot the open Export menu once
await win.getByTitle('Export to another format').click()
await win.waitForTimeout(200)
await H.shot(win, 'C-export-menu')
await win.keyboard.press('Escape').catch(() => {})
await win.mouse.click(700, 400).catch(() => {})

for (const [label, ext] of formats) {
  await win.getByTitle('Export to another format').click()
  await win.getByText(label, { exact: true }).click()
  // wait for an exported file with this extension to appear
  let found = ''
  for (let i = 0; i < 25; i++) {
    found = fs.readdirSync(dir).find((f) => f.startsWith(stem) && f.endsWith(`.${ext}`)) || ''
    if (found && fs.statSync(path.join(dir, found)).size > 0) break
    await win.waitForTimeout(200)
  }
  r.ok(!!found, `export ${ext.toUpperCase()} → ${found || 'no file'}`)
}

// the "Exported …" toast shows after export completes
await win.getByTitle('Export to another format').click()
await win.getByText('PDF', { exact: true }).click()
let toastSeen = false
for (let i = 0; i < 15; i++) {
  if (await win.getByText('Exported', { exact: false }).isVisible().catch(() => false)) { toastSeen = true; break }
  await win.waitForTimeout(200)
}
r.ok(toastSeen, 'export shows confirmation toast')
await H.shot(win, 'C-export-toast')

// original document is unchanged by exporting
r.ok(fs.existsSync(file) && fs.statSync(file).size === origSize, 'original .docx untouched by export')

await app.close()
process.exit(r.done() ? 0 : 1)
