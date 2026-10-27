import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * Where the engine's private profile lives and where the app and the
 * engine-side Basic macros exchange data files. macOS and Linux keep the
 * historical /tmp locations exactly; Windows has no /tmp, so both go under the
 * user's temp directory. The app passes both to wos-lok-host (WOS_LOK_PROFILE,
 * WOS_LOK_XCHG) so the host never has to guess.
 */

const isWin = (): boolean => process.platform === 'win32'

/** The engine's private LibreOffice user profile. */
export function lokProfileDir(): string {
  return isWin() ? path.join(os.tmpdir(), 'wos-lok-host-profile') : '/tmp/wos-lok-host-profile'
}

/** The directory holding the wos-*.txt exchange files. */
export function lokXchgDir(): string {
  return isWin() ? path.join(os.tmpdir(), 'wos-lok') : '/tmp'
}

/** Absolute path of one exchange file, e.g. lokXchg('wos-asset-out.txt'). */
export function lokXchg(name: string): string {
  return path.join(lokXchgDir(), name)
}

/** Creates the exchange directory (a no-op for /tmp). */
export function ensureLokXchgDir(): void {
  try {
    fs.mkdirSync(lokXchgDir(), { recursive: true })
  } catch {
    /* best effort; the first write reports a real problem */
  }
}

/**
 * The macro module text with its exchange paths pointed at lokXchgDir(). The
 * modules are written with literal "/tmp/wos-…" paths; on macOS and Linux the
 * text is returned unchanged. The result sits inside an XML (.xba) file, so the
 * directory is XML-escaped.
 */
export function macroModuleForPlatform(module: string): string {
  if (!isWin()) return module
  const dir = lokXchgDir().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '')
  return module.split('/tmp/wos-').join(`${dir}\\wos-`)
}
