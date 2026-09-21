/**
 * Generates the demo workbook for the "build an email from a file" feature.
 *
 *   node scripts/demo/make-demo-workbook.mjs
 *
 * Output: examples/Harbour-Terminal-Q3.xlsx
 *
 * Kept as a script rather than a committed binary so the data can be tuned —
 * a demo file is only as good as the story its numbers tell, and that gets
 * revised.
 *
 * The data is shaped to exercise all four intents AND the things that break
 * this kind of feature:
 *
 *   - a TOTALS row, which a model will happily chart as if it were another
 *     berth, producing one bar three times the others;
 *   - a formula whose CACHED result is what our reader sees;
 *   - a blank separator row, which is what exposed the `actualRowCount` bug;
 *   - ratios stored as 0.91 but displayed as 91%, so "0.91%" in an email is a
 *     visible error rather than a plausible one;
 *   - a genuine finding (one client is 42% of revenue) so "Executive summary"
 *     has a decision to lead with rather than a description to pad.
 *
 * Formatting is real — currency, percentages, bold headers, column widths —
 * because half the point of a demo file is that it looks like a document
 * someone actually keeps.
 */
import ExcelJS from 'exceljs'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = path.join(ROOT, 'examples/Harbour-Terminal-Q3.xlsx')

const HEADER = { bold: true, color: { argb: 'FF1B1B5E' } }
const headerRow = (ws, values) => {
  const row = ws.addRow(values)
  row.font = HEADER
  row.eachCell((c) => {
    c.border = { bottom: { style: 'thin', color: { argb: 'FF2F5BFF' } } }
  })
  return row
}

const wb = new ExcelJS.Workbook()
wb.creator = 'Workspace OS'
wb.created = new Date(2026, 8, 30)

/* ── 1. Throughput — the bar-chart candidate, with the totals-row trap ────── */

const t = wb.addWorksheet('Throughput')
t.columns = [
  { width: 16 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 14 },
]
headerRow(t, ['Berth', 'Q1 (TEU)', 'Q2 (TEU)', 'Q3 (TEU)', 'Change Q2→Q3', 'Utilisation'])
const berths = [
  ['Berth 4', 4820, 5010, 5150, 0.0279, 0.91],
  ['Berth 5', 3050, 3110, 2740, -0.119, 0.68],
  ['Berth 6', 1980, 2240, 3610, 0.6116, 0.86],
  ['Berth 7', 2410, 2380, 2455, 0.0315, 0.71],
]
for (const b of berths) t.addRow(b)
t.addRow([]) // the separator that broke extraction before the index fix
const total = t.addRow(['Total', 12260, 12740, 13955, 0.0954, ''])
total.font = { bold: true }
t.getCell('E7').value = { formula: '(D7-C7)/C7', result: 0.0954 }
t.getCell('F7').value = { formula: 'AVERAGE(F2:F5)', result: 0.79 }
for (const r of [2, 3, 4, 5, 7]) {
  t.getCell(`E${r}`).numFmt = '+0.0%;-0.0%'
  t.getCell(`F${r}`).numFmt = '0%'
  for (const c of ['B', 'C', 'D']) t.getCell(`${c}${r}`).numFmt = '#,##0'
}

/* ── 2. Client revenue — the table digest, and the finding worth leading on ─ */

const c = wb.addWorksheet('Client revenue')
c.columns = [{ width: 22 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 18 }]
headerRow(c, ['Client', 'Q2 (EUR)', 'Q3 (EUR)', 'Share of Q3', 'Contract ends'])
const clients = [
  ['Northbank Shipping', 1840000, 2010000, 0.42, '2027-03-31'],
  ['Meridian Freight', 980000, 1120000, 0.234, '2028-09-30'],
  ['Kestrel Lines', 760000, 815000, 0.17, '2026-12-31'],
  ['Atlas Bulk', 540000, 505000, 0.106, '2027-06-30'],
  ['Others (7)', 310000, 335000, 0.07, '—'],
]
for (const row of clients) c.addRow(row)
const cTotal = c.addRow(['Total', 4430000, 4785000, 1, ''])
cTotal.font = { bold: true }
c.getCell('C7').value = { formula: 'SUM(C2:C6)', result: 4785000 }
for (let r = 2; r <= 7; r += 1) {
  c.getCell(`B${r}`).numFmt = '#,##0 "€"'
  c.getCell(`C${r}`).numFmt = '#,##0 "€"'
  c.getCell(`D${r}`).numFmt = '0.0%'
}

/* ── 3. Notes — prose the model can draw on for the "why" ─────────────────── */

const n = wb.addWorksheet('Notes')
n.columns = [{ width: 20 }, { width: 82 }]
headerRow(n, ['Topic', 'Note'])
;[
  ['Berth 5', 'Crane 2 out of service 14 Aug – 2 Sep for gearbox replacement. Volume was diverted to Berth 6.'],
  ['Berth 6', 'Dredging completed 8 Jul. Draft now 14.5 m, so post-panamax calls are possible for the first time.'],
  ['Northbank', 'Contract ends 31 Mar 2027. Renewal talks have not started. Largest single client by some margin.'],
  ['Kestrel Lines', 'Contract ends 31 Dec 2026 — the nearest expiry, and no renewal meeting is scheduled.'],
  ['Headcount', 'Two straddle-carrier operators left in Q3; neither has been replaced.'],
].forEach((r) => n.addRow(r))

fs.mkdirSync(path.dirname(OUT), { recursive: true })
await wb.xlsx.writeFile(OUT)
console.log(`\n✓ ${path.relative(ROOT, OUT)}\n  3 sheets · a totals row · 2 cached formulas · a blank separator\n`)
