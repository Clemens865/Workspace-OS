// Shared helpers + coverage-matrix accumulator for the Z macro audit.
import * as H from '../_harness.mjs'
import { execSync } from 'child_process'
import fs from 'fs'

export const TESTROOT = '/tmp/wos-test'
export const R = H.makeReporter('PHASE Z — macro-coverage audit')

// ---- coverage matrix ----------------------------------------------------
export const MATRIX = []
export function VERIFIED(m, app, ev) { MATRIX.push({ macro: m, app, status: 'VERIFIED', evidence: ev }); R.ok(true, `${m} [${app}] — ${ev}`) }
export function BROKEN(m, app, ev) { MATRIX.push({ macro: m, app, status: 'BROKEN', evidence: ev }); R.ok(false, `${m} [${app}] — BROKEN: ${ev}`) }
export function UNVERIFIED(m, app, ev) { MATRIX.push({ macro: m, app, status: 'UNVERIFIED', evidence: ev }); console.log(`  ~ ${m} [${app}] — UNVERIFIED: ${ev}`) }
/** pass → VERIFIED, fail → BROKEN. */
export function assertMut(m, app, cond, evPass, evFail) { if (cond) VERIFIED(m, app, evPass); else BROKEN(m, app, evFail || evPass) }

// ---- engine plumbing ----------------------------------------------------
export const macro = (win, name, args) => win.evaluate(({ n, a }) => window.workspace.lok.macro(n, a), { n: name, a: args })
export const saveDoc = (win) => win.evaluate(() => window.workspace.lok.save())
export const selInfo = (win) => win.evaluate(() => window.workspace.lok.selInfo())
export const parts = (win) => win.evaluate(() => window.workspace.lok.parts())
export const uno = (win, cmd) => win.evaluate((c) => window.workspace.lok.uno(c), cmd)
export const goToCell = (win, addr, sheet = 'Sheet1') =>
  win.evaluate(({ a, s }) => window.workspace.lok.uno(`.uno:GoToCell {"ToPoint":{"type":"string","value":"$${s}.${a}"}}`), { a: addr, s: sheet })
export const selectRange = (win, ref, sheet = 'Sheet1') =>
  win.evaluate(({ a, s }) => window.workspace.lok.uno(`.uno:GoToCell {"ToPoint":{"type":"string","value":"$${s}.${a}"}}`), { a: ref, s: sheet })

export const unzip = (file, inner) => { try { return execSync(`unzip -p '${file}' ${inner}`, { encoding: 'utf8' }) } catch { return '' } }
export const zipList = (file) => { try { return execSync(`unzip -l '${file}'`, { encoding: 'utf8' }) } catch { return '' } }
export const validZip = (file) => { try { execSync(`unzip -t '${file}'`, { stdio: 'ignore' }); return true } catch { return false } }
export const cleanOut = () => { try { fs.rmSync('/tmp/wos-asset-out.txt', { force: true }) } catch { /* */ } }

/** Poll a fresh selInfo read-back until `pred(sel)` is truthy (robust to the
 * engine applying a shape change a beat after the macro returns). */
export async function pollSel(win, pred, opts) {
  return H.poll(async () => { const s = await selInfo(win); return s && pred(s) ? s : false }, opts)
}

/** Save once (awaiting the lok.save() promise, which resolves when the write is
 * done — not fire-and-forget), settle, then check the unzipped part; retry a few
 * times with a real gap between saves (overlapping saves on a heavily-mutated
 * deck corrupt the zip). A transiently-invalid zip (a save caught mid-write) is
 * NOT treated as a failed predicate — we settle longer and re-read rather than
 * report a phantom BROKEN. Returns the matching xml or ''. */
export async function saveUntilXml(win, file, inner, pred, { tries = 5 } = {}) {
  for (let i = 0; i < tries; i++) {
    await saveDoc(win) // awaited → the IPC save() resolves after the engine writes
    await new Promise((r) => setTimeout(r, 400))
    if (!validZip(file)) { await new Promise((r) => setTimeout(r, 700)); continue } // mid-write; don't judge yet
    const x = unzip(file, inner)
    if (pred(x)) return x
    await new Promise((r) => setTimeout(r, 350))
  }
  return ''
}

export function rmFixtures(prefix) {
  for (const f of fs.readdirSync(TESTROOT)) if (f.startsWith(prefix) || f.startsWith('.~lock')) { try { fs.rmSync(`${TESTROOT}/${f}`, { force: true }) } catch { /* */ } }
}
