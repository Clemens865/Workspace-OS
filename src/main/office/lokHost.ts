import { spawn, type ChildProcess } from 'child_process'
import type { Readable } from 'stream'
import { EventEmitter } from 'events'
import { seedEngineProfile, seedMacroLibrary } from './lokMacros'

// Generous enough for a large file open/save, short enough that a genuine wedge
// self-heals quickly. Catches any engine stall the droppable-callback fix misses.
const CMD_TIMEOUT_MS = 20000


/**
 * Main-process bridge to the out-of-process LibreOfficeKit sidecar
 * (`wos-lok-host`). Owns one engine process, frames/deframes the IPC protocol,
 * and exposes async open/size/tile. Phase 3a M1.
 *
 * Wire protocol (see scripts/lok/wos-lok-host.cpp):
 *   request  (stdin) : "<id> <cmd> [args]\n"
 *   response (stdout): [uint32 LE len][type:1][body]
 *     'J' = JSON control, 'T' = [u32 id][u32 cw][u32 ch][BGRA], 'C' = callback,
 *     'B' = [u32 id][u32 n] + n × ([u32 cw][u32 ch][BGRA])  (batched tiles)
 */

export interface LokHostOptions {
  /** Path to the compiled wos-lok-host binary. */
  hostBin: string
  /** Engine install path (…/Contents/Frameworks/, with trailing slash). */
  installPath: string
  /** Path to the engine's fundamentalrc (…/Contents/Resources/fundamentalrc). */
  fundamentalrc: string
}

export interface OpenResult {
  ok: boolean
  /** 0=text, 1=spreadsheet, 2=presentation, 3=drawing. */
  type?: number
  /** Number of parts (Calc sheets / Impress slides). */
  parts?: number
  /** Current part index. */
  cur?: number
  /** Part names (sheet/slide tabs). */
  names?: string[]
  /** Document width/height in twips (1/1440 inch). */
  w?: number
  h?: number
  err?: string
}

export interface Tile {
  cw: number
  ch: number
  /** BGRA pixels, length cw*ch*4. */
  bgra: Buffer
}

/** One tile request in a batched `tiles` call (px output size + twip source rect). */
export interface TileSpec {
  cw: number
  ch: number
  tx: number
  ty: number
  tw: number
  th: number
}

interface Pending {
  res: (msg: unknown) => void
  rej: (err: Error) => void
}

/** Classifies why a pending call was aborted so callers/telemetry can tell a
 *  genuine engine stall (timeout) apart from a sidecar death (EPIPE/exit). */
export class LokHostError extends Error {
  constructor(message: string, readonly reason: 'exit' | 'write' | 'timeout' | 'disposed' | 'not-running' | 'bad-command') {
    super(message)
    this.name = 'LokHostError'
  }
}

// Batched-tile frames carry raw pixel buffers; a corrupt length field could ask
// us to read gigabytes. Cap dims to something no legitimate tile approaches.
const MAX_TILE_PX = 8192
const MAX_TILES_PER_FRAME = 4096

/**
 * Incremental frame parser for ONE pipe. Chunks are kept as a list — NOT one
 * growing Buffer — because concat-per-chunk re-copies the accumulated bytes
 * each time: a multi-MB frame (batched tiles) arrives as ~100 pipe chunks and
 * paid O(N²) memcpy (~45ms per repaint) under the old scheme. Each complete
 * frame is assembled with a single right-sized copy and handed to `dispatch`.
 */
class FrameParser {
  private chunks: Buffer[] = []
  private buffered = 0

  constructor(private dispatch: (type: string, body: Buffer) => void) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk)
    this.buffered += chunk.length
    for (;;) {
      if (this.buffered < 4) break
      // The 4-byte length header must sit in one chunk to read it; tiny concat.
      if (this.chunks[0].length < 4) this.chunks = [Buffer.concat(this.chunks)]
      const len = this.chunks[0].readUInt32LE(0)
      if (this.buffered < 4 + len) break
      const frame = Buffer.allocUnsafe(4 + len)
      let filled = 0
      while (filled < frame.length) {
        const c = this.chunks[0]
        const take = Math.min(c.length, frame.length - filled)
        c.copy(frame, filled, 0, take)
        filled += take
        if (take === c.length) this.chunks.shift()
        else this.chunks[0] = c.subarray(take)
      }
      this.buffered -= frame.length
      this.dispatch(String.fromCharCode(frame[4]), frame.subarray(5))
    }
  }
}

/** Emits `ready`, `callback` (LOKit callback {type,payload}), and `exit`. */
export class LokHost extends EventEmitter {
  private proc: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private readyPromise: Promise<void>
  private disposed = false
  /** Set once stdin errors (EPIPE) or the process exits — every subsequent
   *  send() fails fast instead of writing into a dead pipe and waiting 20s. */
  private dead = false

  constructor(opts: LokHostOptions) {
    super()
    let resolveReady!: () => void
    this.readyPromise = new Promise((r) => (resolveReady = r))
    this.readyPromise.then(seedMacroLibrary) // seed model-API macros once init can't clobber them
    seedEngineProfile() // disable doc locking before the engine boots
    // fd0=stdin (requests), fd1=ignore (engine stdout noise discarded),
    // fd2=inherit (logs), fd3=pipe (JSON responses + callbacks),
    // fd4=pipe (tile frames — bulk pixels off the latency-sensitive pipe).
    const proc = spawn(opts.hostBin, [opts.installPath, opts.fundamentalrc], {
      stdio: ['pipe', 'ignore', 'inherit', 'pipe', 'pipe'],
    })
    const jsonParser = new FrameParser((type, body) => this.dispatchFrame(type, body, resolveReady))
    const tileParser = new FrameParser((type, body) => this.dispatchFrame(type, body, resolveReady))
    ;(proc.stdio[3] as Readable).on('data', (chunk: Buffer) => jsonParser.push(chunk))
    ;(proc.stdio[4] as Readable).on('data', (chunk: Buffer) => tileParser.push(chunk))
    // A dying sidecar makes stdin emit EPIPE/ECONNRESET; without this handler
    // the write in send() would throw asynchronously and the pending promise
    // would sit until the 20s timeout. Catch it and fail everything at once.
    proc.stdin?.on('error', (err) => this.abortAll('write', new LokHostError(`engine stdin error: ${err.message}`, 'write')))
    proc.on('error', (err) => this.abortAll('exit', new LokHostError(`engine process error: ${err.message}`, 'exit')))
    proc.on('exit', (code) => {
      // Fail any in-flight calls so the renderer never hangs on a dead engine.
      this.abortAll('exit', new LokHostError(`engine exited (code ${code})`, 'exit'))
      this.emit('exit', code)
    })
    this.proc = proc
  }

  /** Marks the host dead and rejects EVERY in-flight call at once with a
   *  classified error. Idempotent — the exit + stdin-error paths can both fire. */
  private abortAll(_why: 'exit' | 'write', err: LokHostError): void {
    this.dead = true
    if (this.proc) this.proc = null
    const inflight = [...this.pending.values()]
    this.pending.clear()
    for (const { rej } of inflight) rej(err)
  }

  /** Resolves once the engine has initialized. */
  ready(): Promise<void> {
    return this.readyPromise
  }

  private dispatchFrame(type: string, body: Buffer, resolveReady: () => void): void {
    if (type === 'J') {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(body.toString('utf8')) as Record<string, unknown>
      } catch {
        return // never let a malformed frame crash the main process
      }
      if (msg.event === 'ready') resolveReady()
      else if (msg.cb !== undefined) this.emit('callback', { type: msg.cb, payload: msg.payload })
      else if (typeof msg.id === 'number') this.resolve(msg.id, msg)
    } else if (type === 'T') {
      if (body.length < 12) return // truncated header — drop rather than read garbage
      const id = body.readUInt32LE(0)
      const cw = body.readUInt32LE(4)
      const ch = body.readUInt32LE(8)
      // No copy: the frame buffer is per-frame, so the slice doesn't pin
      // unrelated data; the IPC structured-clone is the single copy paid.
      const bgra = body.subarray(12)
      this.resolve(id, { tile: true, cw, ch, bgra })
    } else if (type === 'B') {
      // Batched tiles: one frame carrying every tile of a repaint. Slices,
      // not copies — same reasoning as 'T'. Every offset is bounds-checked
      // before the read: a corrupt length field must never make us read past
      // the frame or ask for a gigabyte-sized slice.
      if (body.length < 8) return // truncated header (id + count)
      const id = body.readUInt32LE(0)
      const n = body.readUInt32LE(4)
      if (n > MAX_TILES_PER_FRAME) return // absurd count → corrupt frame, drop it
      const tiles: Tile[] = []
      let off = 8
      for (let i = 0; i < n; i++) {
        if (off + 8 > body.length) break // no room for the next tile header
        const cw = body.readUInt32LE(off)
        const ch = body.readUInt32LE(off + 4)
        if (cw > MAX_TILE_PX || ch > MAX_TILE_PX) break // insane dims → truncated/corrupt, stop
        const bytes = cw * ch * 4
        if (off + 8 + bytes > body.length) break // truncated frame — never throw on wire data
        tiles.push({ cw, ch, bgra: body.subarray(off + 8, off + 8 + bytes) })
        off += 8 + bytes
      }
      this.resolve(id, { tiles })
    }
  }

  private resolve(id: number, msg: unknown): void {
    const p = this.pending.get(id)
    if (p) {
      this.pending.delete(id)
      p.res(msg)
    }
  }

  private send(cmd: string): Promise<Record<string, unknown>> {
    // The sidecar protocol is newline-framed and read with std::getline, so a
    // newline (or NUL) INSIDE a command — e.g. a file path containing "\n" —
    // would inject a second, fully attacker-controlled command line. A crafted
    // folder name ("x\n0 new scalc /path") in a document the user opens is
    // enough to reach cmdNew/saveAs and write an arbitrary file. Refuse the
    // FRAME-BREAKERS here, at the one place every command is written — the tab
    // that `openopts` uses as a field separator is deliberately allowed. Paths
    // themselves are separately barred from ANY control char in the validators.
    if (/[\n\r\x00]/.test(cmd)) {
      return Promise.reject(new LokHostError('command contains a newline or null', 'bad-command'))
    }
    // Fail fast on a host we already know is dead — don't register a pending
    // promise that could only ever be cleared by the 20s timeout backstop.
    if (this.dead || !this.proc) return Promise.reject(new LokHostError('host not running', 'not-running'))
    const proc = this.proc
    const id = this.nextId++
    const p = new Promise<Record<string, unknown>>((res, rej) => {
      // Self-heal backstop: in realistic use no single command takes anywhere
      // near this, so it only trips on a genuine stall — fail the call and kill
      // the engine so the next call respawns a fresh one (renderer retries).
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        rej(new LokHostError('engine command timed out', 'timeout'))
        try { proc.kill('SIGKILL') } catch { /* respawn on next call */ }
      }, CMD_TIMEOUT_MS)
      this.pending.set(id, {
        res: (m: unknown) => { clearTimeout(timer); (res as (m: unknown) => void)(m) },
        rej: (e: Error) => { clearTimeout(timer); rej(e) },
      })
    })
    // If the sidecar died between the guard above and here, the write throws
    // synchronously (EPIPE) or returns after the stream is destroyed. Either
    // way, reject the just-registered pending immediately rather than waiting
    // for the timeout. (The stdin 'error' handler covers the async EPIPE too.)
    try {
      const stdin = proc.stdin
      if (!stdin || stdin.destroyed) throw new Error('stdin not writable')
      stdin.write(`${id} ${cmd}\n`)
    } catch (err) {
      const e = new LokHostError(`engine stdin write failed: ${(err as Error).message}`, 'write')
      this.resolveReject(id, e)
      this.abortAll('write', e)
    }
    return p
  }

  /** Rejects one pending call by id (used when its own write fails). */
  private resolveReject(id: number, err: Error): void {
    const pnd = this.pending.get(id)
    if (pnd) { this.pending.delete(id); pnd.rej(err) }
  }

  async ping(): Promise<boolean> {
    const r = await this.send('ping')
    return r.ok === true && r.pong === true
  }

  /**
   * Loads a document; returns its size in twips and metadata.
   *
   * `filterOptions` (CSV import token — delimiter/charset/locale) rides the
   * `openopts` command, tab-separated because paths contain spaces and a
   * filter token never contains a tab. The host remembers it per doc and
   * reuses it on save, so a semicolon csv saves back as a semicolon csv.
   */
  async open(absPath: string, filterOptions?: string): Promise<OpenResult> {
    const cmd = filterOptions ? `openopts ${filterOptions}\t${absPath}` : `open ${absPath}`
    return (await this.send(cmd)) as unknown as OpenResult
  }

  /** Creates a blank document (swriter/scalc/simpress) at absPath and opens it. */
  async newDoc(factory: 'swriter' | 'scalc' | 'simpress', absPath: string): Promise<OpenResult> {
    return (await this.send(`new ${factory} ${absPath}`)) as unknown as OpenResult
  }

  async size(): Promise<{ w: number; h: number }> {
    const r = await this.send('size')
    return { w: Number(r.w), h: Number(r.h) }
  }

  /** Switches the active part (sheet/slide); returns the new part's size. */
  async setPart(n: number): Promise<{ ok: boolean; cur: number; w: number; h: number }> {
    const r = await this.send(`setpart ${n}`)
    return { ok: r.ok === true, cur: Number(r.cur), w: Number(r.w), h: Number(r.h) }
  }

  /** Re-queries the part list (after a structural change like insert/delete slide). */
  async parts(): Promise<{ parts: number; cur: number; names: string[] }> {
    const r = await this.send('parts')
    return { parts: Number(r.parts), cur: Number(r.cur), names: (r.names as string[]) ?? [] }
  }

  /** Paints a tile of `tw`×`th` twips into a `cw`×`ch` px BGRA buffer. */
  async tile(cw: number, ch: number, tx: number, ty: number, tw: number, th: number): Promise<Tile> {
    const r = (await this.send(`tile ${cw} ${ch} ${tx} ${ty} ${tw} ${th}`)) as unknown as Tile
    return r
  }

  /** Paints many tiles in ONE round-trip ('B' frame) — a full-viewport repaint
   *  costs one command + one response instead of N. Returns [] on engine error
   *  (no document / bad args), mirroring the single-tile error looseness. */
  async tiles(specs: TileSpec[]): Promise<Tile[]> {
    if (specs.length === 0) return []
    const args = specs.map((s) => `${s.cw} ${s.ch} ${s.tx} ${s.ty} ${s.tw} ${s.th}`).join(' ')
    const r = (await this.send(`tiles ${specs.length} ${args}`)) as unknown as { tiles?: Tile[] }
    return r.tiles ?? []
  }

  /** Paints a tile of a specific part (slide/sheet) without switching the view. */
  async partTile(part: number, cw: number, ch: number, tx: number, ty: number, tw: number, th: number): Promise<Tile> {
    const r = (await this.send(`parttile ${part} ${cw} ${ch} ${tx} ${ty} ${tw} ${th}`)) as unknown as Tile
    return r
  }

  /** Posts a key event. type: 0=input, 1=up. */
  async key(type: number, charCode: number, keyCode: number): Promise<void> {
    await this.send(`key ${type} ${charCode} ${keyCode}`)
  }

  /** Posts a mouse event in document twips. type: 0=down, 1=up, 2=move. */
  async mouse(type: number, x: number, y: number, count: number, buttons: number, modifier: number): Promise<void> {
    await this.send(`mouse ${type} ${x} ${y} ${count} ${buttons} ${modifier}`)
  }

  /** Executes a UNO command, e.g. ".uno:Bold". */
  async uno(command: string): Promise<void> {
    await this.send(`uno ${command}`)
  }

  /**
   * WOS-009: reads the current selection OUT of the engine, so it can be put on
   * the macOS pasteboard. `.uno:Copy` alone only fills the engine's own
   * in-process clipboard, which nothing outside this document can see.
   *
   * Returns '' for a selection that has no representation in `mime` (a shape or
   * image under a text mime type) — that is a real answer, not a failure, and
   * callers use it to decide to leave the pasteboard untouched.
   */
  async getSelection(mime = 'text/plain;charset=utf-8'): Promise<string> {
    const r = await this.send(`getsel ${mime}`)
    if (r.ok !== true || typeof r.b64 !== 'string') return ''
    return Buffer.from(r.b64, 'base64').toString('utf8')
  }

  /** WOS-009: inserts `data` (interpreted as `mime`) at the cursor. */
  async pasteBuffer(data: string, mime = 'text/plain;charset=utf-8'): Promise<boolean> {
    const b64 = Buffer.from(data, 'utf8').toString('base64')
    const r = await this.send(`pastebuf ${mime} ${b64}`)
    return r.ok === true
  }

  /** Applies cell borders to the current selection (via the seeded Basic macro). */
  async setBorder(preset: string, color: number, width: number): Promise<boolean> {
    const r = await this.send(`setborder ${preset} ${Math.round(color)} ${Math.round(width)}`)
    return r.ok === true
  }

  /** Raw getCommandValues(command) JSON, e.g. ".uno:SheetGeometryData". */
  async commandValues(command: string): Promise<unknown> {
    const r = await this.send(`cmdvals ${command}`)
    return r.value ?? null
  }

  /** Resizes a column ('col') or row ('row') at `index` to `size` (1/100 mm)
   *  via the seeded Basic macro. size 0 = optimal (autofit). */
  async setSize(kind: 'col' | 'row', index: number, size: number): Promise<boolean> {
    const r = await this.send(`setsize ${kind} ${Math.round(index)} ${Math.round(size)}`)
    return r.ok === true
  }

  /** Runs a seeded model-API Basic macro (Wos*) with `|`-delimited args. */
  async runMacro(name: string, args: string): Promise<boolean> {
    const r = await this.send(`macro ${name} ${args}`)
    return r.ok === true
  }

  /** Saves the open document back to its original file. */
  async save(): Promise<boolean> {
    const r = await this.send('save')
    return r.ok === true
  }

  /** Exports a copy of the open document to absPath in the given format. */
  async exportAs(format: string, absPath: string): Promise<boolean> {
    const r = await this.send(`export ${format} ${absPath}`)
    return r.ok === true
  }

  // ---- dialog windows (Phase F) ----
  /** Paints a dialog window to a BGRA bitmap. */
  async windowPaint(winId: number, w: number, h: number): Promise<Tile> {
    return (await this.send(`wpaint ${winId} ${w} ${h}`)) as unknown as Tile
  }
  async windowMouse(winId: number, type: number, x: number, y: number, count: number, buttons: number, modifier: number): Promise<void> {
    await this.send(`wmouse ${winId} ${type} ${x} ${y} ${count} ${buttons} ${modifier}`)
  }
  async windowKey(winId: number, type: number, charCode: number, keyCode: number): Promise<void> {
    await this.send(`wkey ${winId} ${type} ${charCode} ${keyCode}`)
  }
  async dialogEvent(winId: number, json: string): Promise<void> {
    await this.send(`dlgevent ${winId} ${json}`)
  }
  async windowClose(winId: number): Promise<void> {
    await this.send(`wclose ${winId}`)
  }

  async close(): Promise<void> {
    await this.send('close')
  }

  dispose(): void {
    if (this.disposed) return // idempotent — a double dispose must not double-kill
    this.disposed = true
    this.dead = true
    const proc = this.proc
    this.proc = null
    if (proc) {
      // Drop our listeners BEFORE kill so the imminent 'exit' can't fire late
      // handlers on a host we're discarding, and stdio 'data' can't push into a
      // stale parser after respawn.
      proc.removeAllListeners()
      proc.stdin?.removeAllListeners()
      proc.stdio[3]?.removeAllListeners?.()
      proc.stdio[4]?.removeAllListeners?.()
      try {
        proc.stdin?.end()
        proc.kill()
      } catch {
        /* ignore */
      }
    }
    const inflight = [...this.pending.values()]
    this.pending.clear()
    for (const { rej } of inflight) rej(new LokHostError('engine disposed', 'disposed'))
  }
}
