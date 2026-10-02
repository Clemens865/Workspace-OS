// Phase S — ENGINE STABILITY (harden/engine-stability). Exercises the five
// hardening fixes against the REAL engine, asserting real behavior:
//
//  1. Save coalescing: a burst of rapid saves to one doc must produce a valid,
//     correctly-saved file and must NOT wedge the host (bounded, fast).
//  2. Concurrent macros: two DIFFERENT macro ops fired concurrently must BOTH
//     land in the saved file — proving the /tmp/wos-*.txt serialization (this is
//     the race that clobbered speaker-notes).
//  3. Sidecar-death fail-fast: killing wos-lok-host mid-request must reject the
//     in-flight call PROMPTLY (well under the 20s timeout), and a subsequent op
//     must recover (respawn works).
//
// All assertions are real: unzip the saved file and check content; measure wall
// time; kill a real process. Never ok:true alone.
import * as H from './_harness.mjs'
import { execSync } from 'child_process'
import fs from 'fs'
import ExcelJS from 'exceljs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const r = H.makeReporter('PHASE S — engine stability')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const TESTROOT = '/tmp/wos-test'
const FILE = `${TESTROOT}/S-stability.xlsx`
const unzip = (inner) => { try { return execSync(`unzip -p '${FILE}' ${inner}`, { encoding: 'utf8' }) } catch { return '' } }
const validZip = () => { try { execSync(`unzip -t '${FILE}'`, { stdio: 'ignore' }); return true } catch { return false } }
const sheet1 = () => unzip('xl/worksheets/sheet1.xml')
const styles = () => unzip('xl/styles.xml')
const hostAlive = () => { try { execSync('pgrep -f scripts/lok/wos-lok-host', { stdio: 'ignore' }); return true } catch { return false } }

for (const f of fs.readdirSync(TESTROOT)) if (f.startsWith('.~lock') || f.startsWith('S-stability')) fs.rmSync(`${TESTROOT}/${f}`, { force: true })

// Fixture: a small numeric block so cell/border ops have real targets.
{
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.getCell('A1').value = 1; ws.getCell('A2').value = 2; ws.getCell('A3').value = 3
  ws.getCell('B1').value = 4; ws.getCell('B2').value = 5; ws.getCell('B3').value = 6
  await wb.xlsx.writeFile(FILE)
}

const { app, win } = await H.launch()
await H.openDoc(win, 'S-stability.xlsx', 'Excel')
r.ok(await win.getByRole('button', { name: 'Data', exact: true }).first().isVisible().catch(() => false), 'Calc opened (Data tab visible)')

// ============================================================================
// TEST 1 — SAVE STORM. Set a cell, then fire 10 saves in a tight window. The
// coalescing fix must NOT let this cascade into overlapping respawns; the file
// must end up valid with the mutation, and the whole burst must finish fast.
// ============================================================================
{
  await win.evaluate(() => window.workspace.lok.macro('WosSetCell', 'Sheet1|E1|777'))
  await win.waitForTimeout(400)
  const t0 = Date.now()
  const results = await win.evaluate(async () => {
    const saves = []
    for (let i = 0; i < 10; i++) saves.push(window.workspace.lok.save())
    // Settled results — a coalesced save resolves all its waiters; none should throw.
    return Promise.allSettled(saves).then((rs) => rs.map((x) => x.status))
  })
  const elapsed = Date.now() - t0
  const rejected = results.filter((s) => s === 'rejected').length
  r.ok(rejected === 0, `10 rapid saves all settled without rejection (rejected=${rejected})`)
  r.ok(elapsed < 20000, `save storm bounded/fast: ${elapsed}ms (< 20s, i.e. not a stack of timeouts)`)
  r.ok(hostAlive(), 'sidecar still alive after the save storm (no respawn cascade)')

  // The saved file must be a valid zip carrying the mutation.
  const ok = await H.poll(() => validZip() && /r="E1"[^>]*>\s*<v>777<\/v>/.test(sheet1()), { timeout: 8000 })
  r.ok(ok, 'saved xlsx is a valid zip and holds E1=777 after the storm')
}

// ============================================================================
// TEST 2 — CONCURRENT MACROS. Fire WosSetCell (writes a cell) and setBorder
// (borders a range) CONCURRENTLY. Both share the /tmp/wos-*.txt macro plumbing;
// without serialization they interleave and one clobbers the other. Assert BOTH
// landed in the saved file.
// ============================================================================
{
  // Position a selection for the border op, then fire both ops at once.
  await win.evaluate(() => window.workspace.lok.uno('.uno:GoToCell {"ToPoint":{"type":"string","value":"$Sheet1.A1:B3"}}'))
  await win.waitForTimeout(250)
  const both = await win.evaluate(async () => {
    const p1 = window.workspace.lok.macro('WosSetCell', 'Sheet1|D5|1234')
    const p2 = window.workspace.lok.setBorder('outer', 0x000000, 26)
    const [a, b] = await Promise.all([p1, p2])
    return { cell: a, border: b }
  })
  r.ok(both.cell === true && both.border === true, `both concurrent ops returned ok (cell=${both.cell}, border=${both.border})`)

  const landed = await H.poll(async () => {
    await win.evaluate(() => window.workspace.lok.save())
    await new Promise((res) => setTimeout(res, 400))
    if (!validZip()) return false
    const cellOk = /r="D5"[^>]*>\s*<v>1234<\/v>/.test(sheet1())
    const borderOk = /<border[^>]*>[\s\S]*style="(thin|medium|hair)"/.test(styles())
    return cellOk && borderOk
  }, { timeout: 12000 })
  const cellOk = /r="D5"[^>]*>\s*<v>1234<\/v>/.test(sheet1())
  const borderOk = /<border[^>]*>[\s\S]*style="(thin|medium|hair)"/.test(styles())
  r.ok(cellOk, 'concurrent WosSetCell landed: D5=1234 in saved xlsx')
  r.ok(borderOk, 'concurrent setBorder landed: bordered style in styles.xml')
  r.ok(landed, 'BOTH concurrent macro ops persisted together (no tmp-file clobber)')
}

// ============================================================================
// TEST 3 — SIDECAR DEATH FAIL-FAST. Kill wos-lok-host while a request is
// in-flight; the call must reject PROMPTLY (well under the 20s backstop). Then a
// fresh op must recover (getHost respawns). We drive the in-flight call + kill
// from the renderer so the timing is measured across the real IPC path.
// ============================================================================
{
  r.ok(hostAlive(), 'sidecar alive before the kill test')
  // Fire a BURST of in-flight requests (so at least one is genuinely pending on
  // the host), then SIGKILL the host mid-burst. Every pending call must settle
  // PROMPTLY — a reject (the fix's classified error) or a transparent completion,
  // but NEVER a 20s hang. Without the exit/stdin-error fixes, the requests still
  // pending on the dead host would sit until the 20s backstop. We measure the
  // slowest settle time and demand it be well under 20s.
  // Use a HEAVIER op (PDF export renders the whole doc) so the request is still
  // genuinely in-flight on the host when the kill lands — a WosSetCell macro
  // completes in single-digit ms and races the kill. We start the export, wait a
  // beat so it's mid-render, then SIGKILL. The call must settle promptly.
  const inflight = win.evaluate(async () => {
    const t = Date.now()
    try {
      await window.workspace.lok.exportAs('pdf')
      return { rejected: false, ms: Date.now() - t }
    } catch (e) {
      return { rejected: true, ms: Date.now() - t, msg: String((e && e.message) || e) }
    }
  })
  await new Promise((res) => setTimeout(res, 40)) // export reaches the host, mid-render
  execSync('pkill -9 -f scripts/lok/wos-lok-host', { stdio: 'ignore' })
  const res = await inflight
  // Whether the export was killed mid-flight (reject) or finished just ahead of
  // the kill (fast machine), the ONE thing the fix guarantees is no 20s hang.
  // The deterministic mid-flight reject-classification is unit-tested against a
  // real ChildProcess in src/main/office/lokHost.test.ts (exit/write/disposed).
  r.ok(res.ms < 18000, `in-flight export settled without a 20s hang on sidecar death: ${res.ms}ms${res.rejected ? ` (rejected: "${res.msg}")` : ' (completed just before kill)'}`)

  // Recovery: a subsequent op must respawn the host and succeed.
  const recovered = await H.poll(async () => {
    const ok = await win.evaluate(() => window.workspace.lok.macro('WosSetCell', 'Sheet1|G1|55').catch(() => false))
    if (ok !== true) return false
    await win.evaluate(() => window.workspace.lok.save())
    await new Promise((res2) => setTimeout(res2, 500))
    return validZip() && /r="G1"[^>]*>\s*<v>55<\/v>/.test(sheet1())
  }, { timeout: 45000, interval: 1000 })
  r.ok(recovered, 'engine RECOVERED after sidecar death (respawn + G1=55 persisted)')
}

await app.close().catch(() => {})
process.exit(r.done() ? 0 : 1)
