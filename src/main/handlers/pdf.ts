import { app, IpcMain, shell } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError, validateFilePath } from '../ipc-validator'
import { getWorkspaceRoot } from '../workspace-root'
import { trash } from '../trash'
import {
  writeAnnotations, reorderPages, rotatePage, readFormFields, fillFormFields, stampImage,
  type WriteAnnotation,
} from '../pdf/annotation-writer'

/**
 * PDF annotation + page-operation IPC.
 *
 * Two safety rules shape this file:
 *
 *  1. Every path is validated against the workspace root, so a renderer bug or a
 *     tampered sidecar cannot read or rewrite a file outside the open folder.
 *  2. Any operation that REWRITES a PDF trashes the previous version first, via
 *     the same trash layer every other destructive op uses. Page deletion and
 *     form filling are irreversible edits to a document that may be the only
 *     copy — PRD MVP #11 exists precisely for this, and a PDF editor without undo
 *     is exactly the tool a non-technical user should not be handed.
 *
 * Annotations live in a sidecar (`.workspace-os/annotations/<file>.json`) while
 * being edited, and are burned into the PDF on export. That split is deliberate:
 * editing stays instant and non-destructive, and the original file is untouched
 * until the user asks for it.
 */

function resolveInWorkspace(filePath: unknown): string {
  const root = getWorkspaceRoot()
  if (!root) throw new IpcValidationError('No workspace folder is open')
  if (typeof filePath !== 'string' || !filePath.trim()) throw new IpcValidationError('A file path is required')
  return validateFilePath(filePath, root)
}

/** Where a file's annotation sidecar lives. Keyed by path so two same-named
 *  files in different folders never share markup. */
function sidecarPath(root: string, pdfPath: string): string {
  const rel = path.relative(root, pdfPath).replace(/[/\\]/g, '__')
  return path.join(root, '.workspace-os', 'annotations', `${rel}.json`)
}

function assertAnnotations(value: unknown): WriteAnnotation[] {
  if (!Array.isArray(value)) throw new IpcValidationError('Annotations must be a list')
  if (value.length > 5000) throw new IpcValidationError('Too many annotations')
  return value as WriteAnnotation[]
}

/** Rewrite a PDF in place, trashing the prior version first (undo path). */
async function rewrite(absPath: string, bytes: Uint8Array): Promise<{ ok: true }> {
  // 'overwrite' + removeOriginal:false — snapshot a COPY of the current version
  // into trash and leave the file in place, then write over it. The prior version
  // stays restorable from the Files panel like every other destructive op.
  await trash.moveToTrash(absPath, 'overwrite', false, false)
  await fs.writeFile(absPath, bytes)
  return { ok: true }
}

export function registerPdfHandlers(ipcMain: IpcMain): void {
  // Like Office printing, hand the complete PDF to the system viewer. Include
  // current markup in a temporary copy without modifying the source document.
  ipcHandle(ipcMain, 'pdf:print', async (_e, filePath, annotations) => {
    const abs = resolveInWorkspace(filePath)
    const annots = assertAnnotations(annotations)
    if (path.extname(abs).toLowerCase() !== '.pdf') throw new IpcValidationError('A PDF file is required')
    if (annots.length === 0) {
      const error = await shell.openPath(abs)
      if (error) throw new Error(error)
      return
    }
    const dir = await fs.mkdtemp(path.join(app.getPath('temp'), 'wos-print-'))
    const target = path.join(dir, path.basename(abs))
    const bytes = await writeAnnotations(new Uint8Array(await fs.readFile(abs)), annots)
    await fs.writeFile(target, bytes)
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
  })

  // ── Sidecar (non-destructive, while editing) ───────────────────────────────
  ipcHandle(ipcMain, 'pdf:annotations:read', async (_e, filePath: unknown) => {
    const root = getWorkspaceRoot()
    if (!root) throw new IpcValidationError('No workspace folder is open')
    const abs = resolveInWorkspace(filePath)
    try {
      return JSON.parse(await fs.readFile(sidecarPath(root, abs), 'utf-8'))
    } catch {
      // Missing (never annotated) or corrupt — an empty doc, so the surface opens
      // rather than erroring on a file the user just wants to read.
      return { version: 1, file: path.basename(abs), annotations: [] }
    }
  })

  ipcHandle(ipcMain, 'pdf:annotations:write', async (_e, filePath: unknown, doc: unknown) => {
    const root = getWorkspaceRoot()
    if (!root) throw new IpcValidationError('No workspace folder is open')
    const abs = resolveInWorkspace(filePath)
    if (!doc || typeof doc !== 'object') throw new IpcValidationError('Invalid annotation document')
    const target = sidecarPath(root, abs)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, JSON.stringify(doc, null, 2), 'utf-8')
    return { ok: true }
  })

  // ── Burn into the PDF ──────────────────────────────────────────────────────
  /**
   * Export the annotated PDF. Writing to a NEW file by default keeps the
   * original pristine; `inPlace` rewrites it (trashing the prior version first)
   * for the user who wants the marked-up copy to be the copy.
   */
  ipcHandle(ipcMain, 'pdf:export', async (_e, filePath: unknown, annotations: unknown, inPlace: unknown) => {
    const abs = resolveInWorkspace(filePath)
    const annots = assertAnnotations(annotations)
    const bytes = new Uint8Array(await fs.readFile(abs))
    const out = await writeAnnotations(bytes, annots)
    if (inPlace === true) {
      await rewrite(abs, out)
      return { ok: true, path: abs }
    }
    const dir = path.dirname(abs)
    const base = path.basename(abs, path.extname(abs))
    const dest = path.join(dir, `${base} (annotated).pdf`)
    await fs.writeFile(dest, out)
    return { ok: true, path: dest }
  })

  // ── Page operations (destructive → trash first) ────────────────────────────
  ipcHandle(ipcMain, 'pdf:pages:reorder', async (_e, filePath: unknown, order: unknown) => {
    const abs = resolveInWorkspace(filePath)
    if (!Array.isArray(order)) throw new IpcValidationError('A page order is required')
    const bytes = new Uint8Array(await fs.readFile(abs))
    return rewrite(abs, await reorderPages(bytes, order as number[]))
  })

  ipcHandle(ipcMain, 'pdf:pages:rotate', async (_e, filePath: unknown, page: unknown, delta: unknown) => {
    const abs = resolveInWorkspace(filePath)
    if (typeof page !== 'number' || typeof delta !== 'number') throw new IpcValidationError('Page and rotation are required')
    const bytes = new Uint8Array(await fs.readFile(abs))
    return rewrite(abs, await rotatePage(bytes, page, delta))
  })

  // ── Forms ─────────────────────────────────────────────────────────────────
  ipcHandle(ipcMain, 'pdf:form:read', async (_e, filePath: unknown) => {
    const abs = resolveInWorkspace(filePath)
    return readFormFields(new Uint8Array(await fs.readFile(abs)))
  })

  ipcHandle(ipcMain, 'pdf:form:fill', async (_e, filePath: unknown, values: unknown) => {
    const abs = resolveInWorkspace(filePath)
    if (!values || typeof values !== 'object') throw new IpcValidationError('Field values are required')
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
      if (typeof k === 'string' && typeof v === 'string' && k.length < 500) clean[k] = v.slice(0, 5000)
    }
    const bytes = new Uint8Array(await fs.readFile(abs))
    return rewrite(abs, await fillFormFields(bytes, clean))
  })

  // ── Signature stamp ───────────────────────────────────────────────────────
  /**
   * Stamp a PNG signature. This is an APPEARANCE, not a cryptographic signature —
   * no certificate, no trust chain, no timestamp — and the UI says so.
   */
  ipcHandle(ipcMain, 'pdf:sign', async (_e, filePath: unknown, pngBase64: unknown, page: unknown, rect: unknown) => {
    const abs = resolveInWorkspace(filePath)
    if (typeof pngBase64 !== 'string' || pngBase64.length > 8_000_000) throw new IpcValidationError('Invalid signature image')
    const r = rect as { x: number; y: number; w: number; h: number }
    if (typeof page !== 'number' || !r || [r.x, r.y, r.w, r.h].some((n) => typeof n !== 'number')) {
      throw new IpcValidationError('Invalid signature placement')
    }
    const png = new Uint8Array(Buffer.from(pngBase64.replace(/^data:image\/png;base64,/, ''), 'base64'))
    const bytes = new Uint8Array(await fs.readFile(abs))
    return rewrite(abs, await stampImage(bytes, png, page, r))
  })
}
