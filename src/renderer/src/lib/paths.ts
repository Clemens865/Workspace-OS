/**
 * Path helpers for the renderer, which has no Node `path` module. The main process
 * hands over native paths: `/Users/me/ws/a.md` on macOS and Linux, `D:\vault\a.md`
 * on Windows. Splitting on '/' alone breaks the Windows form: lastIndexOf('/') is
 * -1, so `p.slice(0, p.lastIndexOf('/'))` drops the last character and turns the
 * workspace root `D:\vault` into `D:\vaul`, which the main process rejects as
 * outside the workspace. Every helper here accepts both separators.
 */

const lastSep = (p: string): number => Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
const trimSeps = (p: string): string => p.replace(/[\\/]+$/, '') || p

/** The separator a path uses: '\' for a Windows path, otherwise '/'. */
export function sepOf(p: string): '/' | '\\' {
  return /^[A-Za-z]:\\|^\\\\/.test(p) || (p.includes('\\') && !p.includes('/')) ? '\\' : '/'
}

/** Last segment: the file or folder name. */
export function basename(p: string): string {
  const t = trimSeps(p)
  return t.slice(lastSep(t) + 1) || t
}

/** Everything before the last segment; '' when there is no separator. */
export function dirname(p: string): string {
  const t = trimSeps(p)
  const i = lastSep(t)
  if (i < 0) return ''
  if (i === 0) return t[0]
  // Keep the root of a drive path: dirname('D:\a') is 'D:\'.
  return /^[A-Za-z]:$/.test(t.slice(0, i)) ? t.slice(0, i + 1) : t.slice(0, i)
}

/** Joins a folder and relative parts with the folder's own separator. */
export function joinPath(dir: string, ...parts: string[]): string {
  const sep = sepOf(dir)
  const rest = parts.flatMap(segments)
  return rest.length ? [dir.replace(/[\\/]+$/, ''), ...rest].join(sep) : dir
}

/** The non-empty segments of a path, split on either separator. */
export function segments(p: string): string[] {
  return p.split(/[\\/]/).filter(Boolean)
}

const sameCase = (root: string): boolean => sepOf(root) === '/'
const norm = (p: string, root: string): string => (sameCase(root) ? p : p.replace(/\//g, '\\').toLowerCase())

/** True when `p` is `root` or inside it. Windows paths compare without regard to case or separator. */
export function isInside(root: string, p: string): boolean {
  const r = norm(trimSeps(root), root)
  const q = norm(p, root)
  const sep = sameCase(root) ? '/' : '\\'
  return q === r || q.startsWith(r + sep)
}

/** `p` relative to `root`, always with '/', or `p` unchanged when it is outside. */
export function relPath(p: string, root: string | null | undefined): string {
  if (!root || !isInside(root, p)) return p
  return segments(trimSeps(p).slice(trimSeps(root).length)).join('/')
}
