import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { LokHost, type OpenResult, type Tile, type TileSpec } from './lokHost'
import { sniffCsvFilterOptions } from './csvSniff'

/**
 * Singleton manager for the LibreOfficeKit sidecar (Phase 3a M2). Resolves the
 * engine + host-binary paths (env-overridable for dev), lazily spawns one host,
 * and proxies open/tile/close. One active document per host for now.
 *
 * Dev defaults point at the validation build on the external SSD and the
 * compiled host; a packaged app will ship a hardened engine under resources.
 */

interface LokPaths {
  install: string
  fundamentalrc: string
  hostBin: string
}

function lokPaths(): LokPaths {
  const res = process.resourcesPath
  const bundledInstall = res ? path.join(res, 'libreoffice/LibreOffice.app/Contents/Frameworks/') : ''
  const bundledFund = res ? path.join(res, 'libreoffice/LibreOffice.app/Contents/Resources/fundamentalrc') : ''
  const bundledHost = res ? path.join(res, 'lok/wos-lok-host') : ''

  const devEngine = '/Volumes/LOBuild/core/instdir/LibreOffice.app/Contents'
  return {
    install: process.env['WOS_LOK_INSTALL'] || (bundledInstall && fs.existsSync(bundledInstall) ? bundledInstall : `${devEngine}/Frameworks/`),
    fundamentalrc: process.env['WOS_LOK_FUND'] || (bundledFund && fs.existsSync(bundledFund) ? bundledFund : `${devEngine}/Resources/fundamentalrc`),
    hostBin: process.env['WOS_LOK_HOST'] || (bundledHost && fs.existsSync(bundledHost) ? bundledHost : path.join(app.getAppPath(), 'scripts/lok/wos-lok-host')),
  }
}

/** The engine's animation preset catalogue (LibreOffice's effects.xml). */
export function lokEffectsPath(): string {
  return path.join(path.dirname(lokPaths().fundamentalrc), 'config/soffice.cfg/simpress/effects.xml')
}

/** True when the host binary and engine are present (so lok rendering can run). */
export function lokAvailable(): boolean {
  const { install, fundamentalrc, hostBin } = lokPaths()
  return (
    fs.existsSync(hostBin) &&
    fs.existsSync(fundamentalrc) &&
    fs.existsSync(path.join(install, 'libsofficeapp.dylib'))
  )
}

let host: LokHost | null = null
let hostStarting: Promise<LokHost> | null = null
let lastOpenPath: string | null = null

// ---- active-document barrier (the multi-doc "formatting applies live but isn't
// saved" fix) --------------------------------------------------------------
// The host keeps several documents resident but has ONE current doc (g_doc). A
// tab switch issues `lok:open`, and mutating commands (uno/key/mouse/save/…)
// operate on whatever g_doc happens to be. Because each is a SEPARATE async IPC
// call, a command issued around a switch can reach the host's stdin BEFORE the
// switch's `open` line — so it lands on the WRONG resident doc. The formatting
// then "applies live" (on some doc) but never reaches the file the user saves.
//
// Fix: funnel every doc-scoped command through one FIFO barrier. `activeBarrier`
// is the promise for the most recent open/new; a mutating call awaits it, then
// re-asserts the intended doc is current (cheap resident-switch) before running.
// This guarantees mutations execute against `lastOpenPath`, never a stale g_doc.
let activeBarrier: Promise<unknown> = Promise.resolve()
// The path the host most recently made current (mirrors g_docPath host-side).
let hostCurrentPath: string | null = null

/** Chains `fn` after the current active-doc barrier and adopts it as the new
 *  barrier so a following mutation can't overtake an in-flight switch. */
function throughBarrier<T>(fn: () => Promise<T>): Promise<T> {
  const run = activeBarrier.then(fn, fn)
  activeBarrier = run.then(() => undefined, () => undefined)
  return run
}

/** Ensures the host's current doc is the intended active doc (`lastOpenPath`)
 *  before a mutating command runs. A resident doc switches instantly; only a
 *  drifted/respawned host pays a reload. No-ops when nothing is open yet. */
async function ensureActive(h: LokHost): Promise<void> {
  if (!lastOpenPath || hostCurrentPath === lastOpenPath) return
  await h.open(lastOpenPath, csvOptionsFor(lastOpenPath))
  hostCurrentPath = lastOpenPath
}

/** Runs a doc-mutating engine call bound to the intended active document. */
function withActiveDoc<T>(fn: (h: LokHost) => Promise<T>): Promise<T> {
  return throughBarrier(async () => {
    const h = await getHost()
    await ensureActive(h)
    return fn(h)
  })
}

/** LOKit callback payload forwarded to the renderer (cursor/selection/invalidate). */
export interface LokCallback {
  type: number
  payload: string
}
let callbackSink: ((cb: LokCallback) => void) | null = null

/** Registers a sink for the engine's callback stream (one consumer). */
export function onLokCallback(fn: (cb: LokCallback) => void): void {
  callbackSink = fn
}

async function getHost(): Promise<LokHost> {
  if (host) return host
  // Single-flight: concurrent callers (open + tile + geometry on doc load) must
  // share one spawn. Spawning twice makes two engines share the profile dir, and
  // LibreOffice's single-instance lock has them dispose each other — the engine
  // dies and the renderer hangs on "Rendering…".
  if (hostStarting) return hostStarting
  hostStarting = (async () => {
    const { install, fundamentalrc, hostBin } = lokPaths()
    const h = new LokHost({ hostBin, installPath: install, fundamentalrc })
    h.on('exit', () => {
      if (host === h) host = null
      // Drop this dead host's listeners so a respawn never accumulates stale
      // EventEmitter handlers (each LokHost is single-use; getHost makes a new one).
      h.removeAllListeners()
    })
    h.on('callback', (cb: LokCallback) => callbackSink?.(cb))
    await h.ready()
    host = h
    // Transparent crash recovery: a freshly spawned host re-opens the last doc.
    if (lastOpenPath) { await h.open(lastOpenPath, csvOptionsFor(lastOpenPath)); hostCurrentPath = lastOpenPath }
    return h
  })()
  try {
    return await hostStarting
  } finally {
    hostStarting = null
  }
}

export async function lokKey(type: number, charCode: number, keyCode: number): Promise<void> {
  await withActiveDoc((h) => h.key(type, charCode, keyCode))
}

export async function lokMouse(type: number, x: number, y: number, count: number, buttons: number, modifier: number): Promise<void> {
  await withActiveDoc((h) => h.mouse(type, x, y, count, buttons, modifier))
}

export async function lokUno(command: string): Promise<void> {
  await withActiveDoc((h) => h.uno(command))
}

/** WOS-009: current selection as `mime`, or '' when it has no such form. */
export async function lokGetSelection(mime?: string): Promise<string> {
  return withActiveDoc((h) => h.getSelection(mime))
}

/** WOS-009: insert `data` (as `mime`) at the cursor. */
export async function lokPasteBuffer(data: string, mime?: string): Promise<boolean> {
  return withActiveDoc((h) => h.pasteBuffer(data, mime))
}

export async function lokSetBorder(preset: string, color: number, width: number): Promise<boolean> {
  return withActiveDoc((h) => h.setBorder(preset, color, width))
}

export async function lokCommandValues(command: string): Promise<unknown> {
  return withActiveDoc((h) => h.commandValues(command))
}

export async function lokSetSize(kind: 'col' | 'row', index: number, size: number): Promise<boolean> {
  return withActiveDoc((h) => h.setSize(kind, index, size))
}

export async function lokRunMacro(name: string, args: string): Promise<boolean> {
  return withActiveDoc((h) => h.runMacro(name, args))
}

export async function lokSetPart(n: number): Promise<{ ok: boolean; cur: number; w: number; h: number }> {
  return withActiveDoc((h) => h.setPart(n))
}

export async function lokParts(): Promise<{ parts: number; cur: number; names: string[] }> {
  return (await getHost()).parts()
}

// ---- dialog windows (Phase F) ----
export async function lokWindowPaint(winId: number, w: number, h: number): Promise<Tile> {
  return (await getHost()).windowPaint(winId, w, h)
}
export async function lokWindowMouse(winId: number, type: number, x: number, y: number, count: number, buttons: number, modifier: number): Promise<void> {
  await (await getHost()).windowMouse(winId, type, x, y, count, buttons, modifier)
}
export async function lokWindowKey(winId: number, type: number, charCode: number, keyCode: number): Promise<void> {
  await (await getHost()).windowKey(winId, type, charCode, keyCode)
}
export async function lokDialogEvent(winId: number, json: string): Promise<void> {
  await (await getHost()).dialogEvent(winId, json)
}
export async function lokWindowClose(winId: number): Promise<void> {
  await (await getHost()).windowClose(winId)
}

// ---- save coalescing + circuit breaker (the Impress-wedge fix) ------------
// A burst of rapid saves to one doc must NOT cascade into overlapping engine
// calls (each of which, on a stall, kills+respawns the sidecar — the classic
// exponential wedge). Single-flight the save: while one is running, additional
// requests coalesce into exactly ONE trailing save that runs after the current
// one settles. All callers waiting on the same in-flight/trailing save share
// its result. A circuit breaker trips after N consecutive save timeouts so we
// stop repeatedly killing the engine and reject briefly with a clear error.
let saveInFlight: Promise<boolean> | null = null
let saveTrailing = false
let saveTrailingWaiters: { res: (b: boolean) => void; rej: (e: Error) => void }[] = []
let saveTimeoutStreak = 0
let saveCircuitOpenUntil = 0
const SAVE_TIMEOUT_STREAK_LIMIT = 3
const SAVE_CIRCUIT_COOLDOWN_MS = 5000

function isTimeout(err: unknown): boolean {
  return err instanceof Error && /timed out/i.test(err.message)
}

async function runOneSave(): Promise<boolean> {
  // Save the INTENDED active doc, not whatever g_doc happens to be: bind through
  // the active-doc barrier + ensureActive so a save fired around a tab switch
  // can't serialize a stale resident doc (the "applies live but isn't saved" bug).
  const ok = await withActiveDoc((h) => h.save())
  saveTimeoutStreak = 0 // any completed save (even ok:false) clears the streak
  return ok
}

export async function lokSave(): Promise<boolean> {
  // Circuit breaker: after repeated save timeouts, fail fast instead of killing
  // the sidecar again — give the engine a cooldown to recover.
  if (Date.now() < saveCircuitOpenUntil) {
    throw new Error('save temporarily unavailable — engine is recovering from repeated save timeouts')
  }

  if (saveInFlight) {
    // A save is already running. Coalesce this request into a single trailing
    // save that fires once the current one finishes — no parallel engine call.
    saveTrailing = true
    return new Promise<boolean>((res, rej) => { saveTrailingWaiters.push({ res, rej }) })
  }

  const run = (async (): Promise<boolean> => {
    try {
      return await runOneSave()
    } finally {
      // Drain a trailing save (if any request coalesced while we ran) as the
      // NEXT in-flight save, so its waiters get a fresh, post-mutation write.
      saveInFlight = null
      if (saveTrailing) {
        saveTrailing = false
        const waiters = saveTrailingWaiters
        saveTrailingWaiters = []
        saveInFlight = (async () => {
          try {
            const r = await runOneSave()
            for (const w of waiters) w.res(r)
            return r
          } catch (e) {
            if (isTimeout(e) && ++saveTimeoutStreak >= SAVE_TIMEOUT_STREAK_LIMIT) {
              saveCircuitOpenUntil = Date.now() + SAVE_CIRCUIT_COOLDOWN_MS
            }
            for (const w of waiters) w.rej(e as Error)
            throw e
          } finally {
            saveInFlight = null
          }
        })()
        // Let the trailing chain settle on its own; swallow here so an unhandled
        // rejection can't crash the process (waiters already got the error).
        saveInFlight.catch(() => {})
      }
    }
  })().catch((e) => {
    if (isTimeout(e) && ++saveTimeoutStreak >= SAVE_TIMEOUT_STREAK_LIMIT) {
      saveCircuitOpenUntil = Date.now() + SAVE_CIRCUIT_COOLDOWN_MS
    }
    throw e
  })

  saveInFlight = run
  return run
}

// ---- macro serialization (the /tmp/wos-*.txt race fix) --------------------
// Every macro op is a write→runMacro→read against SHARED /tmp/wos-*.txt files
// (the IPC handler writes wos-*-in.txt, the host writes wos-macro-generic.txt,
// the macro writes wos-asset-out.txt). Two concurrent ops interleave those
// writes and clobber each other (this class caused the speaker-notes clobber).
// Serialize the WHOLE handler body — tmp write + runMacro + tmp read — through
// one async queue so each op is atomic. Tiles/paint go through LokHost.send()
// directly and are NEVER routed here, so rendering keeps its parallelism.
let macroTail: Promise<unknown> = Promise.resolve()

export function withMacroLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = macroTail.then(fn, fn) // run after the prior op regardless of its outcome
  // Keep the chain alive but don't let a rejection poison later ops.
  macroTail = run.then(() => undefined, () => undefined)
  return run
}

/** Path of the currently open document, if any. */
export function lokCurrentPath(): string | null {
  return lastOpenPath
}

/** Exports the open doc to an explicit path (used for print → temp PDF). */
export async function lokExportToPath(format: string, absPath: string): Promise<boolean> {
  return withActiveDoc((h) => h.exportAs(format, absPath))
}

/**
 * Vector export of the CURRENT presentation — the whole deck as one SVG, rendered
 * in-process on the loaded model (~26ms; see spike/vector-rendering). Impress/Draw
 * only (Writer/Calc have no SVG filter → returns null). The Impress SVG export is
 * ~98% embedded slideshow JavaScript; we strip that `<script>` here so the
 * renderer receives just the ~KBs of slide geometry, not ~500KB of player code.
 */
export async function lokSlidesSvg(): Promise<string | null> {
  const tmp = path.join(app.getPath('userData'), `wos-slides-${Date.now()}.svg`)
  try {
    const ok = await withActiveDoc((h) => h.exportAs('svg', tmp))
    if (!ok || !fs.existsSync(tmp)) return null
    const raw = fs.readFileSync(tmp, 'utf8')
    // Drop the slideshow player script — we drive slide visibility ourselves.
    return raw.replace(/<script[\s\S]*?<\/script>/gi, '')
  } catch {
    return null
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* already gone */ }
  }
}

/** Exports the open doc to `format` next to the original (non-clobbering). */
export async function lokExport(format: string): Promise<{ ok: boolean; path?: string }> {
  if (!lastOpenPath) return { ok: false }
  const dir = path.dirname(lastOpenPath)
  const stem = path.basename(lastOpenPath, path.extname(lastOpenPath))
  let target = path.join(dir, `${stem}.${format}`)
  // Never overwrite the original document; bump the name if it collides.
  for (let i = 2; target === lastOpenPath; i++) {
    target = path.join(dir, `${stem} (${i}).${format}`)
  }
  const ok = await withActiveDoc((h) => h.exportAs(format, target))
  return { ok, path: ok ? target : undefined }
}

/**
 * The CSV import options for a path, or undefined for everything else.
 *
 * Sniffed from the file head on EVERY open (including the transparent respawn
 * re-opens), so a semicolon/decimal-comma German-locale csv always reaches the
 * engine with an explicit delimiter token instead of LOK's silent comma guess.
 */
function csvOptionsFor(absPath: string): string | undefined {
  const ext = absPath.split('.').pop()?.toLowerCase() ?? ''
  if (ext !== 'csv' && ext !== 'tsv') return undefined
  try {
    const fd = fs.openSync(absPath, 'r')
    const buf = Buffer.alloc(65536)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    fs.closeSync(fd)
    return sniffCsvFilterOptions(buf.subarray(0, n).toString('utf8'), ext) ?? undefined
  } catch {
    return undefined
  }
}

export async function lokOpen(absPath: string): Promise<OpenResult> {
  // Route through the active-doc barrier so a mutating command issued right
  // after this switch can't overtake it and land on the previous g_doc.
  return throughBarrier(async () => {
    // getHost() (on a respawn) re-opens the previous lastOpenPath; set the new
    // one only after this open so the first-ever open doesn't double-open.
    const h = await getHost()
    const r = await h.open(absPath, csvOptionsFor(absPath))
    lastOpenPath = absPath
    hostCurrentPath = absPath
    return r
  })
}

export async function lokNew(
  factory: 'swriter' | 'scalc' | 'simpress',
  absPath: string,
): Promise<OpenResult> {
  return throughBarrier(async () => {
    const h = await getHost()
    const r = await h.newDoc(factory, absPath)
    if (r.ok) { lastOpenPath = absPath; hostCurrentPath = absPath }
    return r
  })
}

export async function lokTile(
  cw: number,
  ch: number,
  tx: number,
  ty: number,
  tw: number,
  th: number,
): Promise<Tile> {
  return (await getHost()).tile(cw, ch, tx, ty, tw, th)
}

/** Batched tiles: one engine round-trip for a whole repaint. */
export async function lokTiles(specs: TileSpec[]): Promise<Tile[]> {
  return (await getHost()).tiles(specs)
}

export async function lokPartTile(
  part: number,
  cw: number,
  ch: number,
  tx: number,
  ty: number,
  tw: number,
  th: number,
): Promise<Tile> {
  return (await getHost()).partTile(part, cw, ch, tx, ty, tw, th)
}

export async function lokClose(): Promise<void> {
  if (host) await host.close()
}

export function lokDispose(): void {
  host?.dispose()
  host = null
}
