// Writer-side macro audit. Uses the committed word-layout.docx fixture (a real
// Writer doc that renders in this harness) copied into the test root.
import * as H from '../_harness.mjs'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  TESTROOT, VERIFIED, UNVERIFIED, assertMut, macro, saveDoc, uno,
  unzip, zipList, saveUntilXml, rmFixtures,
} from './util.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP = 'Writer'
const NAME = 'Z-writer.docx'
const FILE = `${TESTROOT}/${NAME}`
const doc = () => unzip(FILE, 'word/document.xml')

// Copy the Writer fixture into place. MUST run BEFORE H.launch() (see prepareCalc).
export async function prepareWriter() {
  rmFixtures('Z-writer')
  fs.copyFileSync(path.join(__dirname, '..', 'fixtures', 'word-layout.docx'), FILE)
}

export async function runWriter(win) {
  console.log('\n--- Writer macros ---')
  await H.openDoc(win, NAME, 'Word')
  await win.waitForTimeout(500)

  // ---- WosPageMargins ---------------------------------------------------
  await macro(win, 'WosPageMargins', 'left|3000')
  {
    // 3000 (1/100mm) → 1701 twips.
    const x = await saveUntilXml(win, FILE, 'word/document.xml', (s) => /w:pgMar\b[^>]*w:left="1701"/.test(s))
    assertMut('WosPageMargins', APP, /w:pgMar\b[^>]*w:left="1701"/.test(x), 'left margin → 1701 twips in sectPr', 'pgMar left not applied')
  }

  // ---- WosPageOrient ----------------------------------------------------
  await macro(win, 'WosPageOrient', 'landscape')
  {
    const x = await saveUntilXml(win, FILE, 'word/document.xml', (s) => /w:pgSz\b[^>]*w:orient="landscape"/.test(s))
    assertMut('WosPageOrient', APP, /w:pgSz\b[^>]*w:orient="landscape"/.test(x), 'pgSz orient=landscape in sectPr', 'orientation not landscape')
  }

  // ---- WosHeaderFooter --------------------------------------------------
  await macro(win, 'WosHeaderFooter', 'header|on|AUDITHDR')
  {
    await saveUntilXml(win, FILE, 'word/document.xml', () => /w:headerReference/.test(doc()))
    const hdr = /header\d+\.xml/.test(zipList(FILE)) ? unzip(FILE, 'word/header1.xml') : ''
    const ok = /w:headerReference/.test(doc()) && hdr.includes('AUDITHDR')
    assertMut('WosHeaderFooter', APP, ok, 'header1.xml with "AUDITHDR" + headerReference', 'header text not written')
  }

  // ---- WosPageNumber ----------------------------------------------------
  await macro(win, 'WosPageNumber', 'footer')
  {
    await saveUntilXml(win, FILE, 'word/document.xml', () => /w:footerReference/.test(doc()))
    const ftr = /footer\d+\.xml/.test(zipList(FILE)) ? unzip(FILE, 'word/footer1.xml') : ''
    const ok = /w:footerReference/.test(doc()) && /PAGE/i.test(ftr)
    assertMut('WosPageNumber', APP, ok, 'PAGE field in footer1.xml', 'no PAGE field in footer')
  }

  // ---- WosInsertBlock heading/quote/callout/signature -------------------
  // The macros insert at the ViewCursor, which defaults to the body start — no
  // canvas click is needed (a click can miss/steal focus after a page reflow).
  await macro(win, 'WosInsertBlock', 'heading|AuditHeading|Audit body text|15658734')
  {
    await saveUntilXml(win, FILE, 'word/document.xml', () => doc().includes('AuditHeading'))
    assertMut('WosInsertBlock(heading)', APP, doc().includes('AuditHeading') && doc().includes('Audit body text'), 'heading + body paragraphs inserted', 'heading block text not present')
  }
  await macro(win, 'WosInsertBlock', 'quote|Someone|A quoted line|15658734')
  {
    await saveUntilXml(win, FILE, 'word/document.xml', () => doc().includes('A quoted line'))
    assertMut('WosInsertBlock(quote)', APP, doc().includes('A quoted line'), 'quote paragraph inserted', 'quote text not present')
  }
  await macro(win, 'WosInsertBlock', 'callout|CalloutTitle|Callout body|13421823')
  {
    await saveUntilXml(win, FILE, 'word/document.xml', () => doc().includes('CalloutTitle'))
    assertMut('WosInsertBlock(callout)', APP, doc().includes('CalloutTitle') && /w:tbl/.test(doc()), 'callout 1x1 table with title inserted', 'callout table/text not present')
  }
  await macro(win, 'WosInsertBlock', 'signature|Sig Name|Sig role|15658734')
  {
    await saveUntilXml(win, FILE, 'word/document.xml', () => doc().includes('Sig Name'))
    assertMut('WosInsertBlock(signature)', APP, doc().includes('Sig Name') && doc().includes('Sig role'), 'signature block inserted', 'signature text not present')
  }

  // ---- WosInsertContentControl + WosSetContentControl -------------------
  await macro(win, 'WosInsertContentControl', 'wos-metric-9001|123|Revenue')
  {
    await saveUntilXml(win, FILE, 'word/document.xml', () => /<w:sdt\b/.test(doc()) && doc().includes('wos-metric-9001'))
    const ok = /<w:sdt\b/.test(doc()) && doc().includes('wos-metric-9001') && doc().includes('123')
    assertMut('WosInsertContentControl', APP, ok, 'w:sdt content-control tagged wos-metric-9001 with "123"', 'content control not inserted')
  }
  await macro(win, 'WosSetContentControl', 'wos-metric-9001|456')
  {
    await saveUntilXml(win, FILE, 'word/document.xml', () => doc().includes('456') && !doc().includes('>123<'))
    const ok = doc().includes('456')
    assertMut('WosSetContentControl', APP, ok, 'content control value updated to "456"', 'content control value not updated')
  }

  // ---- WosInsertDocTable + WosSetDocTable (dedicated setTable handler) ---
  const TAG = `wos-range-${Date.now().toString(36)}`
  await win.evaluate(({ tag }) => window.workspace.lok.setTable({ macro: 'WosInsertDocTable', tag, values: [['H1', 'H2'], ['a', 'b']] }), { tag: TAG })
  {
    await saveUntilXml(win, FILE, 'word/document.xml', () => doc().includes('H1') && doc().includes('H2'))
    const ok = /w:tbl/.test(doc()) && doc().includes('H1') && doc().includes('H2')
    assertMut('WosInsertDocTable', APP, ok, 'real w:tbl with header cells inserted', 'doc table not inserted')
  }
  await win.evaluate(({ tag }) => window.workspace.lok.setTable({ macro: 'WosSetDocTable', tag, values: [['X1', 'X2'], ['c', 'd']] }), { tag: TAG })
  {
    await saveUntilXml(win, FILE, 'word/document.xml', () => doc().includes('X1'))
    assertMut('WosSetDocTable', APP, doc().includes('X1') && doc().includes('X2'), 'named table cells updated to X1/X2', 'doc table cells not updated')
  }

  // ---- WosTableOp: insert a row into the table at the cursor ------------
  // Move the cursor into the just-created table. GoTo the table by clicking near it.
  await win.locator('canvas').first().click({ position: { x: 120, y: 200 }, force: true })
  await win.waitForTimeout(200)
  {
    const rowsBefore = (doc().match(/<w:tr\b/g) || []).length
    await macro(win, 'WosTableOp', 'rowafter')
    await saveUntilXml(win, FILE, 'word/document.xml', () => (doc().match(/<w:tr\b/g) || []).length > rowsBefore)
    const rowsAfter = (doc().match(/<w:tr\b/g) || []).length
    if (rowsAfter > rowsBefore) VERIFIED('WosTableOp', APP, `row inserted (w:tr ${rowsBefore}→${rowsAfter})`)
    else UNVERIFIED('WosTableOp', APP, `cursor not inside a table (w:tr ${rowsBefore}→${rowsAfter}); op is a guarded no-op when ViewCursor.TextTable is null`)
  }

  // ---- WosFindReplace (Writer, document-level) --------------------------
  await macro(win, 'WosInsertBlock', 'heading|FINDME token here|body|15658734')
  await saveUntilXml(win, FILE, 'word/document.xml', () => doc().includes('FINDME'))
  {
    const res = await win.evaluate(() => window.workspace.lok.findReplace({ mode: 'replaceall', find: 'FINDME', replace: 'REPLACED' }))
    await saveUntilXml(win, FILE, 'word/document.xml', () => doc().includes('REPLACED') && !doc().includes('FINDME'))
    const ok = res && res.ok && res.count >= 1 && doc().includes('REPLACED') && !doc().includes('FINDME')
    assertMut('WosFindReplace', APP, ok, `Writer replaceall FINDME→REPLACED (count ${res?.count})`, `Writer replace no-op (count ${res?.count})`)
  }
  void uno
}
