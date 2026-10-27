import { execFile } from 'child_process'
import { pathToFileURL } from 'url'
import { promisify } from 'util'
import fs from 'fs'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'

const execFileAsync = promisify(execFile)

/**
 * LibreOffice as a Docker-free conversion engine. Phase 1 of the native-office
 * effort: `soffice --headless --convert-to` replaces the OnlyOffice/Docker
 * conversion path. Phase 4 will bundle the binary; for now we resolve a local
 * install and degrade gracefully when it's absent.
 */

let cachedBinary: string | null | undefined

/** Paths to a LibreOffice bundled inside the packaged app's resources. */
function bundledCandidates(): string[] {
  const res = process.resourcesPath
  if (!res) return []
  return [
    path.join(res, 'libreoffice/LibreOffice.app/Contents/MacOS/soffice'), // macOS
    path.join(res, 'libreoffice/program/soffice'), // Linux
    path.join(res, 'libreoffice/program/soffice.exe'), // Windows
  ]
}

/**
 * Ordered soffice candidate paths. An explicit override wins, then the bundled
 * engine (Phase 4 — no install needed), then a system install for development.
 */
export function sofficeCandidates(): string[] {
  return [
    process.env['SOFFICE_BIN'],
    ...bundledCandidates(),
    '/Applications/LibreOffice.app/Contents/MacOS/soffice', // macOS system
    '/usr/bin/soffice',
    '/usr/local/bin/soffice',
    '/opt/homebrew/bin/soffice',
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'LibreOffice', 'program', 'soffice.exe'), // Windows system
  ].filter(Boolean) as string[]
}

/** Resolves the soffice binary, or null if unavailable. */
export function resolveSoffice(): string | null {
  if (cachedBinary !== undefined) return cachedBinary
  cachedBinary = sofficeCandidates().find((c) => fs.existsSync(c)) ?? null
  return cachedBinary
}

export function isLibreOfficeAvailable(): boolean {
  return resolveSoffice() !== null
}

/**
 * Converts a document to the target format in a temp dir and returns the path
 * to the produced file. Uses a per-call profile dir so concurrent conversions
 * don't collide on LibreOffice's single-instance lock. Pass the result to
 * discardConverted when done with it; a failed conversion cleans up itself.
 */
export async function convertTo(srcPath: string, format: 'pdf' | 'html' | 'docx' | 'xlsx'): Promise<string> {
  const soffice = resolveSoffice()
  if (!soffice) throw new Error('LibreOffice is not installed')

  const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wos-lo-'))
  const profileDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wos-lo-profile-'))
  let ok = false
  try {
    await execFileAsync(
      soffice,
      [
        '--headless', '--norestore', '--nolockcheck',
        // A real file URL: file:///C:/... on Windows (file://C:\... is rejected as a corrupt bootstrap.ini).
        `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
        '--convert-to', format,
        '--outdir', outDir,
        srcPath,
      ],
      { timeout: 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }
    )

    const base = path.basename(srcPath, path.extname(srcPath))
    const produced = path.join(outDir, `${base}.${format}`)
    await fsp.access(produced)
    ok = true
    return produced
  } finally {
    fsp.rm(profileDir, { recursive: true, force: true }).catch(() => {})
    if (!ok) fsp.rm(outDir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Removes a convertTo result together with the temp folder it was produced in. */
export async function discardConverted(produced: string): Promise<void> {
  const dir = path.dirname(produced)
  // Only ever a convertTo output folder, never a caller-supplied location.
  if (path.dirname(dir) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('wos-lo-')) return
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
}
