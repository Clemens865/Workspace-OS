import path from 'path'
import fs from 'fs'

export class IpcValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IpcValidationError'
  }
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new IpcValidationError(`${field} must be a non-empty string`)
  }
  return value
}

function assertNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !isFinite(value)) {
    throw new IpcValidationError(`${field} must be a finite number`)
  }
  return value
}

/**
 * Ensures a path stays within the allowed workspace root.
 *
 * Guards against two escape vectors:
 *  1. Lexical traversal (`../`) — resolved before comparison.
 *  2. Symlink escape — a link inside the workspace pointing outside it. We
 *     compare the *real* (symlink-resolved) path of both the target and the
 *     root. For not-yet-existing targets (create/write) we resolve the nearest
 *     existing ancestor, since realpath needs the path to exist.
 */
export function validateFilePath(filePath: unknown, workspaceRoot: string): string {
  const p = assertString(filePath, 'filePath')
  // Control characters never belong in a path; a newline in one can inject a
  // line into the LOK host protocol (see validateOpenPath). Reject up front.
  if (/[\x00-\x1f]/.test(p)) throw new IpcValidationError('Path contains a control character')
  const base = path.resolve(workspaceRoot)
  const root = realPathSafe(base)
  /*
   * A relative path is relative to the WORKSPACE, not to the process.
   *
   * `path.resolve('report.pdf')` resolves against process.cwd(), which for a
   * packaged app is `/` — so every workspace-relative path became `/report.pdf`
   * and was rejected as escaping the root. The message pointed at security; the
   * fault was arithmetic.
   *
   * The app hands relative paths around by design — a case artifact is stored
   * workspace-relative precisely so the case file survives being moved — so the
   * validator has to speak the same language as the rest of the app.
   *
   * Traversal is still caught: `../../etc/passwd` resolves against the root and
   * then fails the prefix check below, which is the check that was always doing
   * the actual work.
   */
  const resolved = path.isAbsolute(p) ? path.resolve(p) : path.resolve(base, p)
  const real = realPathSafe(resolved)

  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new IpcValidationError('Path escapes workspace root')
  }
  return resolved
}

/** Office document extensions the user may open from anywhere on disk. */
const OPENABLE_EXT = new Set([
  '.docx', '.doc', '.odt', '.rtf', '.txt',
  '.xlsx', '.xls', '.ods', '.csv', '.tsv',
  '.pptx', '.ppt', '.odp',
])

/**
 * Validates a path for *opening* an office document the user explicitly picked.
 *
 * Unlike {@link validateFilePath}, this does NOT require the file to live under
 * the workspace root: a desktop office app legitimately opens files from
 * anywhere (Recent, a different folder, Finder). It is still safe — the renderer
 * is trusted app code, the user chose the file, and we require that:
 *  - the path resolves to an existing regular file (no traversal to a phantom
 *    path, no directories), and
 *  - it carries a known office extension (so this can't be repurposed to slurp
 *    arbitrary secrets like `~/.ssh/id_rsa`).
 */
export function validateOpenPath(filePath: unknown): string {
  const p = assertString(filePath, 'filePath')
  // A control character in a path is never legitimate and is dangerous: statSync
  // treats a newline as an ordinary filename byte, so a file inside a folder
  // named "x\n<command>" would pass every check here and then inject a second
  // line into the newline-framed LOK host protocol (see lokHost.send). Reject
  // the whole class up front.
  if (/[\x00-\x1f]/.test(p)) throw new IpcValidationError('Path contains a control character')
  const resolved = path.resolve(p)
  const ext = path.extname(resolved).toLowerCase()
  if (!OPENABLE_EXT.has(ext)) {
    throw new IpcValidationError(`Unsupported file type: ${ext || '(none)'}`)
  }
  let stat: fs.Stats
  try {
    stat = fs.statSync(realPathSafe(resolved))
  } catch {
    throw new IpcValidationError('File does not exist')
  }
  if (!stat.isFile()) {
    throw new IpcValidationError('Not a file')
  }
  return resolved
}

/**
 * Resolves symlinks for the deepest existing portion of a path. When the leaf
 * doesn't exist yet, the not-yet-created suffix is appended back to the
 * resolved ancestor so new files can still be validated.
 */
function realPathSafe(target: string): string {
  let current = target
  const suffix: string[] = []
  // Walk up until we hit an existing path we can realpath.
  for (;;) {
    try {
      const real = fs.realpathSync(current)
      return suffix.length ? path.join(real, ...suffix.reverse()) : real
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return target // reached filesystem root
      suffix.push(path.basename(current))
      current = parent
    }
  }
}

export function validateShellInput(input: unknown): string {
  // Raw terminal keystrokes — must allow whitespace-only data like Enter ("\r")
  // and Space, which assertString would reject (it trims to empty). Only the
  // type matters here; the PTY interprets the bytes.
  if (typeof input !== 'string') {
    throw new IpcValidationError('input must be a string')
  }
  return input
}

export function validateShellResize(cols: unknown, rows: unknown): { cols: number; rows: number } {
  return {
    cols: assertNumber(cols, 'cols'),
    rows: assertNumber(rows, 'rows'),
  }
}

export function validateSearchQuery(query: unknown): string {
  const q = assertString(query, 'query')
  if (q.length > 500) throw new IpcValidationError('Search query too long (max 500 chars)')
  return q
}

export function validateFileName(name: unknown): string {
  const n = assertString(name, 'name')
  // Reject names with path separators or null bytes
  if (/[/\\\0]/.test(n)) throw new IpcValidationError('Invalid characters in file name')
  return n
}
