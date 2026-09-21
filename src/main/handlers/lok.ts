import { IpcMain, BrowserWindow, shell, app, dialog, clipboard } from 'electron'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'node:url'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError, validateFilePath, validateOpenPath } from '../ipc-validator'
import { getWorkspaceRoot } from '../workspace-root'
import { coerceGrid, encodeGridPayload, encodeTablePayload } from '../ranges'
import { isValidA1 } from '../transclusions'
import { sendToWindow, setMainWindow } from '../main-window'
import {
  lokAvailable,
  lokOpen,
  lokNew,
  lokTile,
  lokTiles,
  lokPartTile,
  lokClose,
  lokKey,
  lokMouse,
  lokUno,
  lokSetBorder,
  lokCommandValues,
  lokSetSize,
  lokRunMacro,
  lokSave,
  lokExport,
  lokExportToPath,
  lokSlidesSvg,
  lokCurrentPath,
  lokSetPart,
  lokParts,
  withMacroLock,
  lokWindowPaint,
  lokWindowMouse,
  lokWindowKey,
  lokDialogEvent,
  lokWindowClose,
  onLokCallback,
  lokGetSelection,
  lokPasteBuffer,
  lokEffectsPath,
} from '../office/lokEngine'
import { createOfficeClipboard, type OfficeClipboard } from '../office/officeClipboard'

const EXPORT_FORMATS = new Set(['pdf', 'docx', 'odt', 'rtf', 'txt', 'html', 'epub', 'xlsx', 'ods', 'csv', 'pptx', 'odp', 'png', 'svg'])

const FACTORY = { docx: 'swriter', xlsx: 'scalc', pptx: 'simpress' } as const

// WOS-009. Built lazily and kept for the process lifetime because it remembers
// what was last mirrored out of a document — that memory is what lets paste tell
// "the user copied this here" from "the user copied this in another app".
// `electron.clipboard` is required here rather than at module load so the unit
// tests can import this file's siblings without an Electron runtime.
let _officeClipboard: OfficeClipboard | null = null
function officeClipboard(): OfficeClipboard {
  if (!_officeClipboard) {
    _officeClipboard = createOfficeClipboard({
      getSelection: lokGetSelection,
      pasteBuffer: lokPasteBuffer,
      postUno: lokUno,
      readSystem: () => ({ text: clipboard.readText(), html: clipboard.readHTML() }),
      writeSystem: (v) => clipboard.write(v),
    })
  }
  return _officeClipboard
}
type Ext = keyof typeof FACTORY

/**
 * The blank master for a new document, or '' when it isn't on disk.
 *
 * Packaged, the templates ship in the app's resources; in a dev tree they live
 * in the repo. Regenerate them with scripts/gen-templates.mjs — they're plain
 * engine-produced files, so a new one can be dropped in to change what every
 * new document starts from (theme, 16:9, fonts) without touching code.
 */
function templatePath(ext: Ext): string {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'templates', `blank.${ext}`) : '',
    path.join(app.getAppPath(), 'resources', 'templates', `blank.${ext}`),
  ].filter(Boolean)
  for (const c of candidates) if (fs.existsSync(c)) return c
  return ''
}

interface TileArgs {
  cw: number
  ch: number
  tx: number
  ty: number
  tw: number
  th: number
}

/**
 * Native office rendering via the LibreOfficeKit sidecar (Phase 3a M2). The
 * renderer drives open → tile → close; tiles come back as BGRA buffers.
 */
export function registerLokHandlers(ipcMain: IpcMain, win: BrowserWindow): void {
  setMainWindow(win)
  // Forward the engine's callback stream (cursor/selection/invalidate) to the renderer.
  onLokCallback((cb) => {
    sendToWindow('lok:callback', cb)
  })

  ipcHandle(ipcMain, 'lok:available', () => lokAvailable())

  ipcHandle(ipcMain, 'lok:open', async (_event, filePath: unknown) => {
    // Opening a document the user explicitly picked is allowed from anywhere on
    // disk (Recent / a different folder / outside the open workspace) — see
    // validateOpenPath. This is independent of whether a workspace is open.
    const resolved = validateOpenPath(filePath)
    return lokOpen(resolved)
  })

  // Create a new blank office document by extension, in the workspace root.
  ipcHandle(ipcMain, 'lok:new', async (_event, ext: unknown, fileName: unknown) => {
    const root = getWorkspaceRoot()
    if (!root) throw new IpcValidationError('No workspace folder is open')
    if (typeof ext !== 'string' || !(ext in FACTORY)) throw new IpcValidationError('Unsupported format')
    if (typeof fileName !== 'string' || !fileName || /[/\\]|\.\./.test(fileName)) {
      throw new IpcValidationError('Invalid file name')
    }
    const resolved = validateFilePath(path.join(root, fileName), root)

    // Create by COPYING a blank master, not by driving the engine.
    //
    // The old path asked LibreOffice to synthesize `private:factory/<app>` and
    // immediately saveAs() it, which puts the single-threaded engine on the
    // critical path of file creation — and it proved flaky exactly there: the
    // file would land but the canvas sat on "Rendering…". A copy is a few
    // milliseconds, byte-identical every time, involves no engine at all, and
    // makes the starting document something we control (see resources/templates)
    // rather than whatever the LO factory happens to produce. The engine's only
    // job is now what it's good at: opening an existing file.
    const template = templatePath(ext as Ext)
    if (template) {
      try {
        await fs.promises.copyFile(template, resolved)
        const opened = await lokOpen(resolved)
        return { ...opened, path: resolved }
      } catch {
        // Template missing/unreadable (e.g. a dev tree without resources) — fall
        // through to the engine factory rather than failing the user's action.
      }
    }
    const result = await lokNew(FACTORY[ext as Ext], resolved)
    return { ...result, path: resolved }
  })

  ipcHandle(ipcMain, 'lok:tile', async (_event, args: unknown) => {
    const a = args as TileArgs
    const ints = [a?.cw, a?.ch, a?.tx, a?.ty, a?.tw, a?.th]
    if (ints.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
      throw new IpcValidationError('Invalid tile arguments')
    }
    const tile = await lokTile(a.cw, a.ch, a.tx, a.ty, a.tw, a.th)
    return { cw: tile.cw, ch: tile.ch, bgra: tile.bgra }
  })

  // Batched tiles — one IPC + one engine round-trip for a whole repaint,
  // instead of one per tile. Mirrors lok:tile's per-tile validation.
  ipcHandle(ipcMain, 'lok:tiles', async (_event, args: unknown) => {
    if (!Array.isArray(args) || args.length === 0 || args.length > 256) {
      throw new IpcValidationError('Invalid tiles arguments')
    }
    for (const t of args as TileArgs[]) {
      const ints = [t?.cw, t?.ch, t?.tx, t?.ty, t?.tw, t?.th]
      if (ints.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
        throw new IpcValidationError('Invalid tiles arguments')
      }
    }
    const tiles = await lokTiles(args as TileArgs[])
    return tiles.map((t) => ({ cw: t.cw, ch: t.ch, bgra: t.bgra }))
  })

  ipcHandle(ipcMain, 'lok:parttile', async (_event, args: unknown) => {
    const a = args as TileArgs & { part?: number }
    const ints = [a?.part, a?.cw, a?.ch, a?.tx, a?.ty, a?.tw, a?.th]
    if (ints.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
      throw new IpcValidationError('Invalid parttile arguments')
    }
    const tile = await lokPartTile(a.part!, a.cw, a.ch, a.tx, a.ty, a.tw, a.th)
    return { cw: tile.cw, ch: tile.ch, bgra: tile.bgra }
  })

  ipcHandle(ipcMain, 'lok:key', async (_event, type: unknown, charCode: unknown, keyCode: unknown) => {
    if ([type, charCode, keyCode].some((n) => typeof n !== 'number')) {
      throw new IpcValidationError('Invalid key event')
    }
    // lokKey funnels through the SAME active-doc barrier as lok:uno / lok:mouse
    // (withActiveDoc in lokEngine): it awaits any in-flight open/switch, then
    // re-asserts the intended doc is current before the keystroke lands. Without
    // this a keystroke typed right after a fast slide/tab switch could reach the
    // host's stdin before the switch's `open` line and mutate the WRONG doc.
    await lokKey(type as number, charCode as number, keyCode as number)
    return true
  })

  ipcHandle(ipcMain, 'lok:mouse', async (_event, args: unknown) => {
    const a = args as { type: number; x: number; y: number; count: number; buttons: number; modifier: number }
    const nums = [a?.type, a?.x, a?.y, a?.count, a?.buttons, a?.modifier]
    if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
      throw new IpcValidationError('Invalid mouse event')
    }
    await lokMouse(a.type, a.x, a.y, a.count, a.buttons, a.modifier)
    return true
  })

  ipcHandle(ipcMain, 'lok:uno', async (_event, command: unknown) => {
    if (typeof command !== 'string' || !command.startsWith('.uno:')) {
      throw new IpcValidationError('Invalid UNO command')
    }
    // "<.uno:Command> [json-args]": the host splits at the first space and hands
    // the rest to the engine as JSON. Malformed JSON used to throw inside the
    // engine and kill the host (a query-form URL with a space did exactly that);
    // the host now reports it, and the door is closed here as well.
    const sp = command.indexOf(' ')
    if (sp > 0) {
      try { JSON.parse(command.slice(sp + 1)) } catch { throw new IpcValidationError('UNO arguments must be JSON') }
    }
    // WOS-009: Copy/Cut/Paste are intercepted here rather than in the renderer,
    // because every clipboard path — keyboard, Edit menu, Calc's context menu —
    // funnels through this one channel. Everything else passes straight through.
    if ((await officeClipboard().handle(command)) !== 'not-clipboard') return true
    await lokUno(command)
    return true
  })

  // Apply cell borders to the current selection (model-API via Basic macro).
  ipcHandle(ipcMain, 'lok:setborder', async (_event, preset: unknown, color: unknown, width: unknown) => {
    const presets = new Set(['all', 'outer', 'inner', 'none', 'top', 'bottom', 'left', 'right'])
    if (typeof preset !== 'string' || !presets.has(preset)) throw new IpcValidationError('Invalid border preset')
    const c = typeof color === 'number' && Number.isFinite(color) ? Math.max(0, Math.min(0xffffff, Math.round(color))) : 0
    const w = typeof width === 'number' && Number.isFinite(width) ? Math.max(1, Math.min(500, Math.round(width))) : 26
    return withMacroLock(() => lokSetBorder(preset, c, w))
  })

  // The last macro-inserted shape's bounds (1/100 mm) — see WosShapeInsert.
  ipcHandle(ipcMain, 'lok:lastshape', async () => {
    let raw = ''
    try { raw = fs.readFileSync('/tmp/wos-asset-out.txt', 'utf8').trim() } catch { return null }
    const n = raw.split('|').map((x) => Number(x))
    if (n.length < 4 || n.some((x) => Number.isNaN(x))) return null
    return { x: n[0], y: n[1], w: n[2], h: n[3] }
  })

  // Writer status line: page / pages / words / characters from the model.
  ipcHandle(ipcMain, 'lok:docstatus', async () => withMacroLock(async () => {
    await lokRunMacro('WosDocStatus', '')
    let raw = ''
    try { raw = fs.readFileSync('/tmp/wos-asset-out.txt', 'utf8').trim() } catch { return null }
    const n = raw.split('|').map((x) => Number(x))
    if (n.length < 4 || n.some((x) => Number.isNaN(x))) return null
    return { page: n[0], pages: n[1], words: n[2], chars: n[3] }
  }))

  // Engine state queries the review panel needs: comments, tracked changes,
  // their authors. Allowlisted; the payload is parsed here so the renderer
  // never sees a raw engine string it has to trust.
  ipcHandle(ipcMain, 'lok:cmdvalues', async (_event, command: unknown) => {
    const allowed = new Set(['.uno:ViewAnnotations', '.uno:AcceptTrackedChanges', '.uno:TrackedChangeAuthors'])
    if (typeof command !== 'string' || !allowed.has(command)) throw new IpcValidationError('Command values not allowed')
    const raw = await lokCommandValues(command)
    if (typeof raw === 'string') { try { return JSON.parse(raw) } catch { return null } }
    return raw ?? null
  })

  // Spreadsheet column/row geometry for drawing headers (.uno:SheetGeometryData).
  ipcHandle(ipcMain, 'lok:sheetgeometry', async () => {
    const v = await lokCommandValues('.uno:SheetGeometryData')
    return v ?? null
  })

  // Resize a column/row (model-API via Basic macro). size is 1/100 mm; 0 = autofit.
  ipcHandle(ipcMain, 'lok:setsize', async (_event, kind: unknown, index: unknown, size: unknown) => {
    if (kind !== 'col' && kind !== 'row') throw new IpcValidationError('Invalid resize kind')
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) throw new IpcValidationError('Invalid index')
    const s = typeof size === 'number' && Number.isFinite(size) ? Math.max(0, Math.min(200000, Math.round(size))) : 0
    return withMacroLock(() => lokSetSize(kind, index, s))
  })

  // Run a seeded model-API macro (sheet/table ops). Name restricted to Wos*;
  // args are a single sanitized line ('|'-delimited, no control chars).
  ipcHandle(ipcMain, 'lok:macro', async (_event, name: unknown, args: unknown) => {
    if (typeof name !== 'string' || !/^Wos[A-Za-z0-9]+$/.test(name)) throw new IpcValidationError('Invalid macro name')
    const a = typeof args === 'string' ? args.replace(/[\r\n]/g, ' ').slice(0, 1000) : ''
    return withMacroLock(() => lokRunMacro(name, a))
  })

  // Find & Replace (Writer + Calc) via the model search API (WosFindReplace).
  // The find/replace strings travel on their OWN lines in /tmp/wos-fr-in.txt so a
  // literal '|' in the text can never collide with the flags delimiter. Returns
  // the match/replace count the macro writes back (>=0 on Writer/Calc; -1 when the
  // doc type is unsupported, e.g. Impress).
  ipcHandle(ipcMain, 'lok:findReplace', async (_event, input: unknown) => {
    const i = (input ?? {}) as {
      mode?: unknown; find?: unknown; replace?: unknown
      caseSensitive?: unknown; wholeWord?: unknown; regex?: unknown
    }
    const mode = i.mode === 'replaceall' || i.mode === 'findnext' || i.mode === 'findprev' ? i.mode : null
    if (!mode) throw new IpcValidationError('Invalid find/replace mode')
    if (typeof i.find !== 'string' || i.find.length === 0 || i.find.length > 4000) throw new IpcValidationError('Invalid find text')
    const repl = typeof i.replace === 'string' ? i.replace.slice(0, 4000) : ''
    // Newlines would break the line-delimited payload — strip them from both.
    const findLine = i.find.replace(/[\r\n]/g, ' ')
    const replLine = repl.replace(/[\r\n]/g, ' ')
    const flag = (v: unknown): string => (v === true ? '1' : '0')
    const header = `${mode}|${flag(i.caseSensitive)}|${flag(i.wholeWord)}|${flag(i.regex)}`
    // Serialize the whole write→run→read: the shared /tmp/wos-*.txt files must
    // not interleave with a concurrent macro op (that clobbered notes before).
    return withMacroLock(async () => {
      fs.writeFileSync('/tmp/wos-fr-in.txt', `${header}\n${findLine}\n${replLine}\n`, 'utf8')
      // Remove any prior result first: if the macro aborts mid-way (e.g. a real
      // Calc-replace fault, now no longer masked), we must NOT read a stale count
      // from a previous run and report a phantom success.
      try { fs.rmSync('/tmp/wos-asset-out.txt', { force: true }) } catch { /* best effort */ }
      const ok = await lokRunMacro('WosFindReplace', '')
      if (!ok) return { ok: false, count: -1 }
      let raw = ''
      try { raw = fs.readFileSync('/tmp/wos-asset-out.txt', 'utf8').trim() } catch { return { ok: false, count: -1 } }
      const count = Number.parseInt(raw, 10)
      return { ok: true, count: Number.isFinite(count) ? count : 0 }
    })
  })

  // Live ranges: stamp a grid into the OPEN Calc doc as a block anchored at its
  // top-left cell (model-API macro). The grid travels via a payload file — a
  // grid is too big/rich for the single sanitized macro-arg line.
  ipcHandle(ipcMain, 'lok:setRangeBlock', async (_event, input: unknown) => {
    const i = (input ?? {}) as { sheet?: unknown; cell?: unknown; values?: unknown }
    const grid = coerceGrid(i.values)
    if (!grid) throw new IpcValidationError('Invalid range grid')
    if (typeof i.cell !== 'string' || !isValidA1(i.cell)) throw new IpcValidationError('Invalid anchor cell')
    const sheet = typeof i.sheet === 'string' ? i.sheet : ''
    return withMacroLock(() => {
      fs.writeFileSync('/tmp/wos-range-in.txt', encodeGridPayload(sheet, i.cell, grid), 'utf8')
      return lokRunMacro('WosSetRangeBlock', '')
    })
  })

  // Live tables: insert/update a whole range grid as a real TABLE in the OPEN
  // Writer/Impress doc (model-API macro). The grid travels via a payload file —
  // too big/rich for the single sanitized macro-arg line. `macro` is one of the
  // four table macros; the tag (wos-range-<id>) is the round-tripping anchor.
  ipcHandle(ipcMain, 'lok:setTable', async (_event, input: unknown) => {
    const i = (input ?? {}) as { macro?: unknown; tag?: unknown; values?: unknown }
    const allowed = new Set(['WosInsertDocTable', 'WosSetDocTable', 'WosInsertSlideTable', 'WosSetSlideTable'])
    if (typeof i.macro !== 'string' || !allowed.has(i.macro)) throw new IpcValidationError('Invalid table macro')
    if (typeof i.tag !== 'string' || !/^wos-range-[\w-]+$/.test(i.tag)) throw new IpcValidationError('Invalid table tag')
    const grid = coerceGrid(i.values)
    if (!grid) throw new IpcValidationError('Invalid range grid')
    const macroName = i.macro
    const tag = i.tag
    return withMacroLock(() => {
      fs.writeFileSync('/tmp/wos-table-in.txt', encodeTablePayload(tag, grid), 'utf8')
      return lokRunMacro(macroName, '')
    })
  })

  // Components (capture): serialize the current selection into element lines.
  ipcHandle(ipcMain, 'lok:capture', async () => withMacroLock(async () => {
    await lokRunMacro('WosCapture', '')
    let raw = ''
    try { raw = fs.readFileSync('/tmp/wos-asset-out.txt', 'utf8') } catch { return null }
    const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
    if (lines.length < 2) return null
    const head = lines[0].split('|')
    return { w: Number(head[0]) || 0, h: Number(head[1]) || 0, elements: lines.slice(1, 60) }
  }))

  // Components (build): write captured element lines + rebuild them as a group.
  ipcHandle(ipcMain, 'lok:buildCaptured', async (_event, elements: unknown) => {
    if (!Array.isArray(elements) || elements.length === 0) return false
    const safe = elements.filter((e): e is string => typeof e === 'string').slice(0, 60).map((e) => e.replace(/[\r\n]/g, ' '))
    return withMacroLock(() => {
      fs.writeFileSync('/tmp/wos-build-in.txt', 'header\n' + safe.join('\n') + '\n', 'utf8')
      return lokRunMacro('WosBuildCaptured', '')
    })
  })

  // Component support: read back the selected shape's info (name|w|h|fill|text)
  // — the macro writes a temp file the main process reads (renderer fs is sandboxed).
  ipcHandle(ipcMain, 'lok:selinfo', async () => withMacroLock(async () => {
    await lokRunMacro('WosSelInfo', '')
    let raw = ''
    try { raw = fs.readFileSync('/tmp/wos-asset-out.txt', 'utf8').trim() } catch { return null }
    if (!raw) return null
    const parts = raw.split('|')
    return { name: parts[0] ?? '', w: Number(parts[1]) || 0, h: Number(parts[2]) || 0, fill: Number(parts[3]) || -1, text: parts.slice(4).join('|') }
  }))

  // Sheet / slide visibility for the tab strip and the slide rail: one
  // "name|visible" line per part from the model (hidden parts still count as
  // LOK parts, so the renderer needs this to draw them hidden).
  ipcHandle(ipcMain, 'lok:partinfo', async () => withMacroLock(async () => {
    await lokRunMacro('WosPartInfo', '')
    let raw = ''
    try { raw = fs.readFileSync('/tmp/wos-asset-out.txt', 'utf8') } catch { return { visible: [] as boolean[] } }
    const visible = raw.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 500).map((l) => l.split('|').pop() === '1')
    return { visible }
  }))

  // Impress slide transitions (WosTransition) and shape animations (WosAnim):
  // both write one line per slide / effect to the asset-out file; the renderer's
  // animationModel parses it. Args are a '|'-joined op string; a bare
  // 'add|preset|nodeType' gets the engine's effects.xml path appended here (the
  // renderer never sees engine paths).
  const macroText = async (name: string, args: string): Promise<string> => {
    try { fs.unlinkSync('/tmp/wos-asset-out.txt') } catch { /* fresh */ }
    await lokRunMacro(name, args)
    try { return fs.readFileSync('/tmp/wos-asset-out.txt', 'utf8').slice(0, 20000) } catch { return '' }
  }
  const safeOp = (args: unknown): string => {
    const a = typeof args === 'string' ? args : ''
    if (!/^[A-Za-z0-9|:,.\- ]{0,400}$/.test(a)) throw new IpcValidationError('Invalid office op')
    return a
  }
  // Read-mostly office macros the renderer drives directly (B6c/B8): outline
  // groups, sibling shape rects, Writer table geometry, slide text, ruler info,
  // paragraph indents / tabs, page margins. Allowlisted by name; args are
  // sanitised like the ops above. Returns the macro's asset-out text.
  const OFFICE_MACROS = new Set(['WosOutline', 'WosShapeRects', 'WosTableGeom', 'WosSlideText', 'WosRulerInfo', 'WosParaFmt', 'WosPageMargins', 'WosInsertToc', 'WosUpdateIndexes', 'WosWatermark', 'WosViewInfo', 'WosSort'])
  ipcHandle(ipcMain, 'lok:officeMacro', async (_event, name: unknown, args: unknown) => {
    if (typeof name !== 'string' || !OFFICE_MACROS.has(name)) throw new IpcValidationError('Unknown office macro')
    const a = typeof args === 'string' ? args : ''
    // Slide text carries tabs and free text; everything else is a compact op string.
    if (name === 'WosSlideText' ? /[\r\n]/.test(a) || a.length > 8000 : !/^[A-Za-z0-9|:,.$\- ]{0,400}$/.test(a)) throw new IpcValidationError('Invalid office macro args')
    return withMacroLock(async () => ({ raw: await macroText(name, a) }))
  })

  ipcHandle(ipcMain, 'lok:transition', async (_event, args: unknown) => {
    const a = safeOp(args)
    return withMacroLock(async () => ({ raw: await macroText('WosTransition', a || 'info') }))
  })
  ipcHandle(ipcMain, 'lok:animate', async (_event, args: unknown) => {
    let a = safeOp(args) || 'info'
    if (/^add\|[a-z0-9-]+\|[123]$/.test(a)) a += '|' + lokEffectsPath()
    else if (a.startsWith('add|')) throw new IpcValidationError('Invalid animation op')
    return withMacroLock(async () => ({ raw: await macroText('WosAnim', a) }))
  })

  // Impress speaker notes: read the current (or indexed) slide's presenter notes.
  // The macro writes the text to a temp file the main process reads (renderer fs
  // is sandboxed). `index` -1 (default) = current slide.
  ipcHandle(ipcMain, 'lok:getNotes', async (_event, input: unknown) => {
    const i = (input ?? {}) as { index?: unknown }
    const idx = Number.isInteger(i.index) ? (i.index as number) : -1
    return withMacroLock(async () => {
      try { fs.rmSync('/tmp/wos-asset-out.txt', { force: true }) } catch { /* best effort */ }
      // Pass the slide index as the macro arg (the host writes it to the generic
      // file). Empty arg = current slide. WosGetNotes writes the notes text out.
      const ok = await lokRunMacro('WosGetNotes', idx >= 0 ? String(idx) : '')
      if (!ok) return null
      let raw = ''
      try { raw = fs.readFileSync('/tmp/wos-asset-out.txt', 'utf8') } catch { return null }
      // The macro's Print appends a trailing newline; drop exactly one.
      return { text: raw.replace(/\n$/, '') }
    })
  })

  // Impress speaker notes: set the current (or indexed) slide's presenter notes.
  // Newlines within the note would break the line-delimited payload, so they are
  // collapsed to spaces. `index` -1 = current slide.
  ipcHandle(ipcMain, 'lok:setNotes', async (_event, input: unknown) => {
    const i = (input ?? {}) as { index?: unknown; text?: unknown }
    if (typeof i.text !== 'string' || i.text.length > 20000) throw new IpcValidationError('Invalid notes text')
    const idx = Number.isInteger(i.index) ? (i.index as number) : -1
    const line = i.text.replace(/[\r\n]/g, ' ')
    // Pass "idx|text" as the macro arg — the host writes it to the generic file
    // WosSetNotes reads. Doing it this way (vs. a direct write) avoids the host's
    // own generic-file write for this `macro` command clobbering our payload.
    return withMacroLock(() => lokRunMacro('WosSetNotes', `${idx}|${line}`))
  })

  // Insert an image: native picker → embed via .uno:InsertGraphic. The chosen
  // file is user-selected (outside the workspace is fine — InsertGraphic copies
  // the image into the document) and embedded, not linked.
  ipcHandle(ipcMain, 'lok:insertImage', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Insert image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'svg'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return false
    const url = pathToFileURL(result.filePaths[0]).href
    const args = JSON.stringify({ FileName: { type: 'string', value: url } })
    await lokUno(`.uno:InsertGraphic ${args}`)
    return true
  })

  // Insert an image as a slide shape (Impress) via the model-API macro — the
  // dispatch path above doesn't place a graphic on a slide headlessly.
  ipcHandle(ipcMain, 'lok:imageShape', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Insert image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'svg'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return false
    return withMacroLock(() => lokRunMacro('WosInsertImage', result.filePaths[0]))
  })

  // Frame → live slide bridge v1 (canvas → NATIVE slide). The renderer maps a
  // tldraw frame to a SlideSpec (frameToShapes.ts) and hands us the encoded
  // payload (line 1 = "slideW|slideH"; then one line per native shape) plus any
  // image-fallback PNGs. We APPEND a new slide with real, editable com.sun.star
  // shapes (WosBuildSlide), then drop each fallback PNG onto that same slide
  // (WosInsertImage) so nothing on the frame is lost. Requires an OPEN Impress
  // deck (.pptx/.odp). Returns { ok, slide, native, images } — proof of what went
  // native vs image. ONE-WAY v1: live re-sync (frame as source-of-truth) is v2.
  ipcHandle(ipcMain, 'canvas:frame-to-slide', async (_event, input: unknown) => {
    const i = (input ?? {}) as { payload?: unknown; fallbackImages?: unknown }
    if (typeof i.payload !== 'string' || i.payload.length === 0) {
      throw new IpcValidationError('Missing slide payload')
    }
    if (i.payload.length > 2_000_000) throw new IpcValidationError('Slide payload too large')
    const payload = i.payload
    const fallbacks = Array.isArray(i.fallbackImages) ? i.fallbackImages : []
    if (fallbacks.length > 100) throw new IpcValidationError('Too many fallback images')
    // Count native shape lines (all lines after the size header) for the report.
    const native = payload.split('\n').filter((l) => l.trim().length > 0).length - 1

    return withMacroLock(async () => {
      fs.writeFileSync('/tmp/wos-slide-in.txt', payload, 'utf8')
      try { fs.rmSync('/tmp/wos-asset-out.txt', { force: true }) } catch { /* best effort */ }
      const ok = await lokRunMacro('WosBuildSlide', '')
      if (!ok) return { ok: false, slide: -1, native: 0, images: 0 }
      let slide = -1
      try { slide = parseInt(fs.readFileSync('/tmp/wos-asset-out.txt', 'utf8').trim(), 10) } catch { /* */ }

      // Drop each unsupported shape as a picture onto the SAME (now-current) slide.
      let images = 0
      for (const im of fallbacks) {
        const png = (im as { png?: unknown }).png
        if (!(png instanceof Uint8Array) || png.byteLength === 0 || png.byteLength > 25 * 1024 * 1024) continue
        const tmp = path.join(app.getPath('temp'), `wos-frame-fb-${Date.now()}-${images}.png`)
        try {
          fs.writeFileSync(tmp, Buffer.from(png))
          if (await lokRunMacro('WosInsertImage', tmp)) images++
        } finally {
          try { fs.rmSync(tmp, { force: true }) } catch { /* */ }
        }
      }
      return { ok: true, slide: Number.isFinite(slide) ? slide : -1, native: Math.max(0, native), images }
    })
  })

  // Pick an image file and return its path (no insert) — for component authoring.
  ipcHandle(ipcMain, 'lok:pickImage', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'svg'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Print: render a temp PDF and open it in the system viewer (which prints).
  ipcHandle(ipcMain, 'lok:print', async (_event, filePath) => {
    if (lokCurrentPath() !== validateOpenPath(filePath)) {
      throw new Error('The requested document is not active in the office editor')
    }
    const tmp = path.join(app.getPath('temp'), `wos-print-${Date.now()}.pdf`)
    const ok = await lokExportToPath('pdf', tmp)
    if (ok) {
      const error = await shell.openPath(tmp)
      if (error) throw new Error(error)
    }
    return ok
  })

  // Document properties for the open file.
  ipcHandle(ipcMain, 'lok:fileinfo', async () => {
    const p = lokCurrentPath()
    if (!p) return null
    try {
      const st = fs.statSync(p)
      return { name: path.basename(p), bytes: st.size, modified: st.mtimeMs }
    } catch {
      return null
    }
  })

  ipcHandle(ipcMain, 'lok:setpart', async (_event, n: unknown) => {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
      throw new IpcValidationError('Invalid part index')
    }
    return lokSetPart(n)
  })

  ipcHandle(ipcMain, 'lok:parts', async () => lokParts())

  ipcHandle(ipcMain, 'lok:save', async () => lokSave())

  ipcHandle(ipcMain, 'lok:export', async (_event, format: unknown) => {
    if (typeof format !== 'string' || !EXPORT_FORMATS.has(format)) {
      throw new IpcValidationError('Unsupported export format')
    }
    return lokExport(format)
  })

  // Vector export of the loaded deck as one SVG (Impress only; null otherwise).
  ipcHandle(ipcMain, 'lok:slidessvg', () => lokSlidesSvg())

  // ---- dialog windows (Phase F) ----
  ipcHandle(ipcMain, 'lok:wpaint', async (_event, args: unknown) => {
    const a = args as { id: number; w: number; h: number }
    if ([a?.id, a?.w, a?.h].some((n) => typeof n !== 'number')) throw new IpcValidationError('Invalid window paint')
    const t = await lokWindowPaint(a.id, a.w, a.h)
    return { cw: t.cw, ch: t.ch, bgra: t.bgra }
  })

  ipcHandle(ipcMain, 'lok:wmouse', async (_event, args: unknown) => {
    const a = args as { id: number; type: number; x: number; y: number; count: number; buttons: number; modifier: number }
    const nums = [a?.id, a?.type, a?.x, a?.y, a?.count, a?.buttons, a?.modifier]
    if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) throw new IpcValidationError('Invalid window mouse')
    await lokWindowMouse(a.id, a.type, a.x, a.y, a.count, a.buttons, a.modifier)
    return true
  })

  ipcHandle(ipcMain, 'lok:wkey', async (_event, args: unknown) => {
    const a = args as { id: number; type: number; charCode: number; keyCode: number }
    if ([a?.id, a?.type, a?.charCode, a?.keyCode].some((n) => typeof n !== 'number')) throw new IpcValidationError('Invalid window key')
    await lokWindowKey(a.id, a.type, a.charCode, a.keyCode)
    return true
  })

  // JSDialog widget event → the engine's welded dialog (sendDialogEvent).
  // The event is re-serialised here from a validated shape: one line, no
  // newlines (the host protocol is line-framed), bounded size.
  ipcHandle(ipcMain, 'lok:dlgevent', async (_event, args: unknown) => {
    const a = args as { id: number; control: string; cmd: string; type: string; data?: string }
    if (typeof a?.id !== 'number' || !Number.isFinite(a.id)) throw new IpcValidationError('Invalid dialog id')
    for (const [k, v] of [['control', a?.control], ['cmd', a?.cmd], ['type', a?.type]] as const) {
      if (typeof v !== 'string' || !v || v.length > 200) throw new IpcValidationError(`Invalid dialog event ${k}`)
    }
    if (a.data !== undefined && (typeof a.data !== 'string' || a.data.length > 20000)) throw new IpcValidationError('Invalid dialog event data')
    const ev: Record<string, string> = { id: a.control, cmd: a.cmd, type: a.type }
    if (a.data !== undefined) ev.data = a.data
    await lokDialogEvent(a.id, JSON.stringify(ev).replace(/[\r\n]/g, ' '))
    return true
  })

  ipcHandle(ipcMain, 'lok:wclose', async (_event, id: unknown) => {
    if (typeof id !== 'number') throw new IpcValidationError('Invalid window id')
    await lokWindowClose(id)
    return true
  })

  ipcHandle(ipcMain, 'lok:close', async () => {
    await lokClose()
    return true
  })
}
