import { IpcMain } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError, validateFilePath } from '../ipc-validator'
import { getWorkspaceRoot } from '../workspace-root'
import { buildPptxFromImages, type PptxImage } from '../office/pptx-from-images'

/**
 * Canvas → deck bridge (v1): turns ordered PNG buffers from the open-canvas
 * (one per tldraw frame/page) into a real .pptx and writes it, atomically, into
 * the workspace next to the source `.wcanvas`. Image-based + one-way; native
 * shapes and live-sync are DEFERRED.
 *
 * Security: the target path is validated to live under the workspace root (no
 * traversal), the extension must be .pptx, and image count/size are capped so a
 * runaway renderer can't ask us to buffer unbounded data in the main process.
 */

const MAX_SLIDES = 500
const MAX_IMAGE_BYTES = 25 * 1024 * 1024 // 25 MB per slide image
const MAX_TOTAL_BYTES = 500 * 1024 * 1024 // 500 MB across the whole deck

interface ExportPptxArg {
  /** Absolute target path within the workspace; must end in .pptx. */
  targetPath: string
  /** Ordered slide images (PNG bytes + optional title), one per frame/page. */
  images: { png: Uint8Array; title?: string }[]
}

export function registerCanvasHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, 'canvas:export-pptx', async (_event, arg: unknown) => {
    const a = arg as ExportPptxArg
    if (!a || typeof a !== 'object') throw new IpcValidationError('bad export payload')

    const root = getWorkspaceRoot()
    if (!root) throw new IpcValidationError('No workspace folder is open')

    const resolved = validateFilePath(a.targetPath, root)
    if (path.extname(resolved).toLowerCase() !== '.pptx') {
      throw new IpcValidationError('target must be a .pptx path')
    }

    if (!Array.isArray(a.images)) throw new IpcValidationError('images must be an array')
    if (a.images.length > MAX_SLIDES) {
      throw new IpcValidationError(`too many slides (max ${MAX_SLIDES})`)
    }

    let total = 0
    const imgs: PptxImage[] = a.images.map((im) => {
      if (!im || !(im.png instanceof Uint8Array)) {
        throw new IpcValidationError('each image must carry PNG bytes')
      }
      if (im.png.byteLength > MAX_IMAGE_BYTES) {
        throw new IpcValidationError('slide image too large')
      }
      total += im.png.byteLength
      if (total > MAX_TOTAL_BYTES) throw new IpcValidationError('deck too large')
      return { png: Buffer.from(im.png), title: typeof im.title === 'string' ? im.title : undefined }
    })

    const deck = await buildPptxFromImages(imgs)

    // Atomic write: temp in the SAME dir → rename over the target. A crash
    // mid-write can never leave a truncated .pptx.
    const dir = path.dirname(resolved)
    const tmp = path.join(dir, `.${path.basename(resolved)}.wos-${process.pid}-${Date.now()}.tmp`)
    try {
      await fs.writeFile(tmp, deck)
      await fs.rename(tmp, resolved)
    } catch (err) {
      try {
        await fs.rm(tmp, { force: true })
      } catch {
        /* best-effort cleanup */
      }
      throw new Error(`Failed to write deck: ${(err as Error).message}`)
    }

    return { ok: true, path: resolved, slides: imgs.length }
  })
}
