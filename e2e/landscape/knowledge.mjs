/**
 * Knowledge: an agent asks the workspace (real app, real index, real bridge).
 *
 * The workspace holds a Word, Excel, PowerPoint and PDF file. A fake Claude,
 * run as an agent granted only `research`, calls `wos-action` itself:
 * - knowledge.search finds the fact inside the office files and says where
 *   (page, slide, sheet) — every agent may search what it can already read;
 * - knowledge.read returns an office file as text;
 * - memory.remember is still refused (a write needs its own grant).
 * The run's instructions tell it how to do all of this.
 *
 * Run: npm run e2e:landscape
 */
import { _electron as electron } from 'playwright'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { killAll } from '../office/_harness.mjs'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')

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

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-knowledge-')))
const ws = path.join(tmp, 'workspace')
fs.mkdirSync(ws)

// ── the workspace: four office files, each holding one fact ──
async function seed() {
  const docx = new JSZip()
  docx.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  docx.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  docx.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Cover letter for Contoso. The hiring manager is Dana Whitfield.</w:t></w:r></w:p></w:body></w:document>')
  fs.writeFileSync(path.join(ws, 'Contoso letter.docx'), await docx.generateAsync({ type: 'nodebuffer' }))

  const wb = new ExcelJS.Workbook()
  wb.addWorksheet('Summary').addRow(['Total', 10])
  const b = wb.addWorksheet('Budget')
  b.addRow(['Item', 'Amount'])
  b.addRow(['Quantum licences', 4200])
  await wb.xlsx.writeFile(path.join(ws, 'Pilot budget.xlsx'))

  const pptx = new JSZip()
  const slide = (t) => `<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`
  pptx.file('ppt/slides/slide1.xml', slide('Pilot rollout'))
  pptx.file('ppt/slides/slide2.xml', slide('Rollout to Sales, Finance and Ops before November'))
  fs.writeFileSync(path.join(ws, 'Rollout.pptx'), await pptx.generateAsync({ type: 'nodebuffer' }))

  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  pdf.addPage().drawText('Northwind offer letter', { x: 50, y: 700, font, size: 14 })
  pdf.addPage().drawText('Northwind offers an annual salary of 128000 EUR.', { x: 50, y: 700, font, size: 12 })
  fs.writeFileSync(path.join(ws, 'Northwind offer.pdf'), await pdf.save())
}
await seed()

// ── a fake Claude that uses the bridge the way a real agent would ──
const outFile = path.join(tmp, 'agent-out.json')
const fake = path.join(tmp, 'claude.cjs')
fs.writeFileSync(
  fake,
  `#!${process.execPath}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (!args.includes('-p')) { process.stdout.write('2.1.266 (Claude Code)\\n'); process.exit(0); }
process.stdin.resume();
process.stdin.on('end', () => {
  const run = (id, json) => { const r = spawnSync('wos-action', ['run', id, json], { encoding: 'utf8', env: process.env }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
  const out = {
    system: args[args.indexOf('--append-system-prompt') + 1] || '',
    search: run('knowledge.search', JSON.stringify({ query: 'What salary did Northwind offer?' })),
    sheet: run('knowledge.search', JSON.stringify({ query: 'quantum licences' })),
    read: run('knowledge.read', JSON.stringify({ path: 'Rollout.pptx' })),
    remember: run('memory.remember', JSON.stringify({ text: 'poisoned', source: 'test' })),
  };
  fs.writeFileSync(${JSON.stringify(outFile)}, JSON.stringify(out));
  process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Done.' } } }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', session_id: '11111111-2222-3333-4444-555555555551', is_error: false, result: 'ok' }) + '\\n');
});
process.stdin.on('data', () => {});
`,
)
fs.chmodSync(fake, 0o755)

const AGENT = 'Rhea E2E — Researcher'
await killAll()
const app = await electron.launch({
  args: [path.join(root, 'out/main/index.js')],
  cwd: root,
  env: { ...process.env, WORKSPACE_TEST_ROOT: ws, CLAUDE_BIN: fake, WOS_ACTION_DIR: path.join(root, 'resources/wos-action') },
})
const win = await app.firstWindow({ timeout: 20000 })
win.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
await win.waitForSelector('#root', { timeout: 20000 })
const saved = await win.evaluate(() => JSON.stringify({ ...localStorage }))
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  let c = {}
  try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
  localStorage.setItem(K, JSON.stringify({ ...c, startOn: 'landscape', terminalOpen: false, sessionCases: 'manual', agentModel: '' }))
})
await win.reload()
await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(400)
}

try {
  // The index reads the office files (in the background, off the main process).
  let hits = []
  for (let i = 0; i < 60 && hits.length < 1; i++) {
    hits = await win.evaluate(() => window.workspace.knowledge.search('Northwind salary').catch(() => []))
    if (!hits.length) await win.waitForTimeout(500)
  }
  check('the index has read the PDF', hits[0]?.path === 'Northwind offer.pdf' && hits[0]?.location === 'Page 2', JSON.stringify(hits[0]))

  // An agent with only `research`: no knowledge grant, so search/read must ride the baseline.
  await win.evaluate((name) => window.workspace.agents.write({ name, description: 'Researches things', persona: 'You research.', capabilities: ['research'], scope: 'project' }), AGENT)
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('wos:agents-changed')))
  await win.waitForTimeout(800)
  await win.evaluate(async (name) => {
    const s = window.__sessionStore.create({ agentName: name })
    await window.__sessionStore.send(s.id, 'Look something up')
  }, AGENT)
  for (let i = 0; i < 60 && !fs.existsSync(outFile); i++) await win.waitForTimeout(500)
  const out = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : null
  check('the agent ran', !!out)
  if (out) {
    check('its instructions say how to search and read office files', out.system.includes('knowledge.search') && out.system.includes('knowledge.read'))
    check('knowledge.search finds the salary inside the PDF, on page 2', out.search.code === 0 && /Northwind offer\.pdf/.test(out.search.out) && /Page 2/.test(out.search.out) && /128000/.test(out.search.out), out.search.out.slice(0, 300))
    check('…and the row inside the spreadsheet, on its sheet', out.sheet.code === 0 && /Pilot budget\.xlsx/.test(out.sheet.out) && /Sheet: Budget/.test(out.sheet.out), out.sheet.out.slice(0, 300))
    check('knowledge.read returns the deck as text, slide by slide', out.read.code === 0 && /\[Slide 2\]/.test(out.read.out) && /before November/.test(out.read.out), out.read.out.slice(0, 300))
    check('memory.remember is still refused without the grant', out.remember.code !== 0 || /refus|not allowed|grant|denied/i.test(out.remember.out), out.remember.out.slice(0, 200))
  }
  const poisoned = await win.evaluate(() => window.workspace.memory.search('poisoned', 5))
  check('…and nothing was written to memory', !poisoned.some((m) => m.text === 'poisoned'), JSON.stringify(poisoned))
} catch (e) {
  check('run completed', false, e.message)
} finally {
  await win
    .evaluate((saved) => {
      localStorage.clear()
      for (const [k, v] of Object.entries(JSON.parse(saved))) localStorage.setItem(k, v)
    }, saved)
    .catch(() => {})
  await app.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log(`\n${total - fails}/${total} passed`)
process.exit(fails ? 1 : 0)
