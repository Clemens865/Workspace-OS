// Phase AH — Writer viewport tiling, against the REAL engine.
//
// A many-page Word document used to be painted WHOLE into one document-sized
// canvas — thousands of tiles, and past ~32k device px the canvas allocation
// itself fails. Writer now windows its paint to the visible scroll viewport
// exactly like Calc (Impress deliberately keeps the bounded full paint).
// Fixture: a hand-rolled minimal .docx (a zip of OOXML parts — .rtf routes to
// the text editor, not the office engine, so it must be a real Word file).
import * as H from './_harness.mjs'
import fs from 'fs'
import { execSync } from 'child_process'

const r = H.makeReporter('PHASE AH — Writer viewport tiling')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const FILE = '/tmp/wos-test/AH-writer-viewport.docx'
try { fs.mkdirSync('/tmp/wos-test', { recursive: true }) } catch { /* exists */ }
for (const f of fs.readdirSync('/tmp/wos-test')) if (f.startsWith('.~lock') || f.startsWith('AH-writer')) fs.rmSync('/tmp/wos-test/' + f, { force: true })

// ~1200 paragraphs → dozens of pages.
{
  const dir = '/tmp/wos-test/AH-docx-src'
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir + '/_rels', { recursive: true })
  fs.mkdirSync(dir + '/word', { recursive: true })
  fs.writeFileSync(dir + '/[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>')
  fs.writeFileSync(dir + '/_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>')
  const paras = Array.from({ length: 1200 }, (_, i) =>
    `<w:p><w:r><w:t>This is paragraph number ${i + 1} of the large document, with enough words to take a real line of width across the page.</w:t></w:r></w:p>`)
  fs.writeFileSync(dir + '/word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:r><w:t>FIRSTLINE-MARKER</w:t></w:r></w:p>' + paras.join('') +
    '<w:p><w:r><w:t>LASTLINE-MARKER</w:t></w:r></w:p>' +
    '</w:body></w:document>')
  execSync(`cd '${dir}' && zip -r -X -q '${FILE}' '[Content_Types].xml' _rels word`)
}

const { app, win } = await H.launch()
await H.openDoc(win, 'AH-writer-viewport.docx', 'Word')
r.ok(await win.getByRole('button', { name: 'Layout', exact: true }).first().isVisible().catch(() => false), 'Writer ribbon shows Layout tab')

// IMPORTANT: earlier-opened docs stay mounted as resident (hidden) tabs, so a
// bare querySelector can grab a stale tab's element — scope to VISIBLE ones.
const canvasBox = () => win.evaluate(() => {
  const c = [...document.querySelectorAll('canvas[class*="pageWindowed"]')].find((e) => e.offsetParent !== null)
  if (!c) return null
  return { w: c.width, h: c.height, top: c.style.top, position: getComputedStyle(c).position }
})
const docBox = () => win.evaluate(() => {
  const d = [...document.querySelectorAll('[class*="docWrap"]')].find((e) => e.offsetParent !== null)
  return d ? { h: d.clientHeight } : null
})

// 1) The paint is WINDOWED: viewport-sized canvas, document-sized spacer.
const box0 = await H.poll(async () => { const b = await canvasBox(); return b && b.h > 0 ? b : false }, { timeout: 25000 })
const doc0 = await docBox()
r.ok(box0, `Writer canvas painted (${box0 && box0.h}px tall backing)`)
r.ok(box0 && box0.position === 'absolute', 'Writer canvas is absolutely positioned (windowed)')
r.ok(box0 && box0.h < 6000, `canvas is viewport-bounded, not whole-doc (${box0 && box0.h}px < 6000)`)
r.ok(doc0 && doc0.h > 20000, `doc-sized spacer spans the whole document (${doc0 && doc0.h}px > 20000)`)

// 2) SCROLLING deep re-windows the canvas to the scrolled region.
const beforeTop = box0 && box0.top
await win.evaluate(() => { const g = [...document.querySelectorAll('[class*="pages"]')].find((e) => e.offsetParent !== null); if (g) g.scrollTop = 30000 })
const moved = await H.poll(async () => { const b = await canvasBox(); return b && b.top !== beforeTop ? b : false }, { timeout: 8000 })
r.ok(moved, `scroll re-windowed the canvas (top ${beforeTop} → ${moved && moved.top})`)
r.ok(moved && moved.h < 6000, `scrolled window stays viewport-bounded (${moved && moved.h}px)`)

// 3) TYPING still works with the windowed canvas: go back to the top, click in,
//    type, and confirm the canvas pixels change (the settle landed fresh tiles).
await win.evaluate(() => { const g = [...document.querySelectorAll('[class*="pages"]')].find((e) => e.offsetParent !== null); if (g) g.scrollTop = 0 })
await H.poll(async () => (await canvasBox())?.top === '0px', { timeout: 8000 })
await H.focusDoc(win)
await H.clickDoc(win, 200, 100)
const sigBefore = await H.canvasSig(win)
await H.type(win, 'EDITMARK ')
await win.waitForTimeout(700) // settle repaint
const sigChanged = await H.poll(async () => (await H.canvasSig(win)) !== sigBefore, { timeout: 6000 })
r.ok(sigChanged, 'typing repaints the windowed canvas (pixels changed)')

await H.shot(win, 'AH-writer-viewport')
await app.close()
process.exit(r.done() ? 0 : 1)
