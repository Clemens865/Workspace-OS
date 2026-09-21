import fs from 'fs'
import path from 'path'

/**
 * Read-allowlist for case artifacts.
 *
 * `fs:read-file` confines reads to the active workspace root — the right default
 * for arbitrary paths a renderer might request. But a case artifact is a file
 * the user (or their agent) EXPLICITLY attached to a case, and a case can live
 * in a different workspace than the one currently open (a global "everywhere"
 * case, or simply viewing a case whose workspace isn't active). Opening such an
 * artifact is a deliberate act, not path-traversal — the same trust model that
 * lets `validateOpenPath` open a user-picked office document from anywhere.
 *
 * A path lands here ONLY after `cases:authorize-artifact` has vetted it:
 * confirmed it is listed in a real case's artifacts, resolved it against that
 * case's own root, and (for relative paths) checked it does not escape that
 * root. So this set is exactly "files a case legitimately references", never an
 * arbitrary path a compromised renderer could name.
 */
const allow = new Set<string>()

function real(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

/** Mark an absolute artifact path as readable (by its canonical/real path). */
export function authorizeArtifactPath(abs: string): void {
  allow.add(real(abs))
}

/** Has this path been authorized as a case artifact? Compared by real path. */
export function isAuthorizedArtifact(p: string): boolean {
  return allow.has(real(p))
}
