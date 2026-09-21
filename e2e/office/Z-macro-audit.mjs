// Phase Z — MACRO-COVERAGE AUDIT. Exercises EVERY seeded Wos* model-API macro
// against the REAL engine and asserts each one actually MUTATES the document —
// not that runMacro returned ok:true.
//
// WHY: `ok:true` from lok.macro() only means the macro NAME resolved and ran;
// under `On Error Resume Next` (every macro has it) a wrong doc type, a missing
// arg, or a module-poisoning reserved-word compile error all produce a SILENT
// no-op that still reports ok. Two such bugs shipped this session — the `alias`
// reserved-word bug (poisoned the WHOLE module — every macro a no-op) and Calc
// `replaceAll` (a document-level no-op on spreadsheets). Both were invisible to
// unit tests and to ok:true; only a real-engine mutation assertion caught them.
//
// HOW: author fixtures with exceljs / the New-doc flow, invoke each macro through
// the SAME path the app uses (window.workspace.lok.macro / .findReplace /
// .setTable / .setRangeBlock / .selInfo), then assert a REAL mutation: unzip the
// saved file and check the element/value, OR read back via selInfo, OR a
// shape/part count change. Never assert on ok alone.
//
// Output: a COVERAGE MATRIX (macro → VERIFIED / BROKEN / UNVERIFIED).
//
// NOTE ON STABILITY: the Impress section mutates and re-saves ONE deck ~45 times.
// On a loaded machine the engine can wedge partway through that save storm (the
// deck then reads back empty and the tail cascades to BROKEN). This is an engine
// throughput limit, NOT a macro defect — a clean run (53 VERIFIED / 0 BROKEN /
// 6 UNVERIFIED) reproduces reliably; re-run if the Impress tail wedges. A BROKEN
// verdict on a Calc or Writer macro, or an ISOLATED Impress macro amid passing
// neighbours, is the real signal to investigate.
import * as H from './_harness.mjs'
import { prepareCalc, runCalc } from './audit/calc.mjs'
import { prepareWriter, runWriter } from './audit/writer.mjs'
import { runImpress } from './audit/impress.mjs'
import { R, MATRIX } from './audit/util.mjs'

const r = R
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

// Author fixtures BEFORE launch so they are present at first tree-index (a file
// written post-launch races the tree watcher and openDoc can't find it).
await prepareCalc()
await prepareWriter()

const { app, win } = await H.launch()

try {
  await runCalc(win)
  await runWriter(win)
  await runImpress(win)
} catch (e) {
  console.log('  [audit] fatal: ' + (e?.stack || e))
  r.ok(false, 'audit ran to completion')
}

// ---- print the coverage matrix -----------------------------------------
console.log('\n================ MACRO COVERAGE MATRIX ================')
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n)
for (const m of MATRIX) console.log(`${pad(m.status, 11)} ${pad(m.macro, 26)} ${pad(m.app, 9)} ${m.evidence}`)
const nV = MATRIX.filter((m) => m.status === 'VERIFIED').length
const nB = MATRIX.filter((m) => m.status === 'BROKEN').length
const nU = MATRIX.filter((m) => m.status === 'UNVERIFIED').length
console.log('------------------------------------------------------')
console.log(`VERIFIED ${nV}   BROKEN ${nB}   UNVERIFIED ${nU}   (total ${MATRIX.length})`)
console.log('======================================================\n')

await app.close().catch(() => {})
process.exit(r.done() ? 0 : 1)
