import { IpcMain } from 'electron'
import { IPC } from '../ipc-channels'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError } from '../ipc-validator'
import { assertMainFrame } from '../security'
import { brandStore } from '../brand'
import type { BrandPatch } from '../brand/brand-store'

/**
 * IPC surface for the Brand kit.
 *
 * NOT secret — plain application data (palette/fonts/logo/voice), stored in
 * userData like metrics/snapshots (never the encrypted vault). Every renderer
 * value is validated/coerced by the store on the way in (colour strings, sane
 * lengths, logo path forced inside userData/brand/), so a hostile patch cannot
 * corrupt the brand nor escape the app-data folder.
 */

const NAME_MAX = 120
const TAGLINE_MAX = 200
const VOICE_MAX = 4000
const FONT_MAX = 300
const MAX_LOGO_BYTES = 4 * 1024 * 1024

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' ? v.slice(0, max) : undefined
}

/** Coerce a renderer patch into a bounded BrandPatch (the store re-validates). */
function toPatch(raw: unknown): BrandPatch {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const patch: BrandPatch = {}
  if ('name' in o) patch.name = str(o.name, NAME_MAX)
  if ('tagline' in o) patch.tagline = str(o.tagline, TAGLINE_MAX)
  if ('voice' in o) patch.voice = str(o.voice, VOICE_MAX)
  const p = (o.palette && typeof o.palette === 'object' ? o.palette : null) as Record<string, unknown> | null
  if (p) {
    patch.palette = {}
    for (const k of ['primary', 'accent', 'background', 'text', 'muted'] as const) {
      const c = str(p[k], 64)
      if (c !== undefined) patch.palette[k] = c
    }
  }
  const f = (o.fonts && typeof o.fonts === 'object' ? o.fonts : null) as Record<string, unknown> | null
  if (f) {
    patch.fonts = {}
    for (const k of ['heading', 'body'] as const) {
      const v = str(f[k], FONT_MAX)
      if (v !== undefined) patch.fonts[k] = v
    }
  }
  if ('logoPath' in o) patch.logoPath = o.logoPath == null ? null : str(o.logoPath, 1024) ?? null
  return patch
}

export function registerBrandHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, IPC.BRAND_GET, (event) => {
    assertMainFrame(event)
    return brandStore().get()
  })

  ipcHandle(ipcMain, IPC.BRAND_SET, (event, patch: unknown) => {
    assertMainFrame(event)
    return brandStore().set(toPatch(patch))
  })

  // Logo bytes arrive base64-encoded (like mail attachments) with a filename we
  // read the extension from. The store copies them INTO userData/brand/ and the
  // returned brand points at the copy — the renderer never dictates a real path.
  ipcHandle(ipcMain, IPC.BRAND_SET_LOGO, (event, payload: unknown) => {
    assertMainFrame(event)
    const o = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
    const b64 = typeof o.content === 'string' ? o.content : ''
    if (!b64) throw new IpcValidationError('No logo data provided')
    let bytes: Buffer
    try {
      bytes = Buffer.from(b64, 'base64')
    } catch {
      throw new IpcValidationError('Logo data is not valid base64')
    }
    if (bytes.length === 0) throw new IpcValidationError('The logo file is empty')
    if (bytes.length > MAX_LOGO_BYTES) throw new IpcValidationError('The logo is too large (max 4 MB)')
    const ext = str(o.filename, 255) ? '.' + String(o.filename).split('.').pop() : undefined
    return brandStore().setLogo({ bytes, ext })
  })
}
