/**
 * Minimal unified-diff parser for the DiffSheet — no external deps.
 * Input is `git diff` output (one string, possibly many files); output is a
 * per-file structure with typed lines the viewer colors directly.
 */

export type DiffLineKind = 'add' | 'del' | 'ctx' | 'hunk'

export interface DiffLine {
  kind: DiffLineKind
  /** Line content without the +/-/space marker (hunk headers keep their text). */
  text: string
}

export interface DiffFile {
  /** New path of the file ("b" side); the old path when the file was deleted. */
  path: string
  adds: number
  dels: number
  /** True when the file is binary (git prints no text hunks for it). */
  binary: boolean
  lines: DiffLine[]
}

/** Strips the a/ or b/ prefix git puts on diff paths. */
const stripPrefix = (p: string): string => p.replace(/^[ab]\//, '')

/** Parses `diff --git a/x b/y` headers; quoted paths (spaces) included. */
function headerPath(header: string): string {
  const m = header.match(/^diff --git (?:"?a\/(.*?)"?) (?:"?b\/(.*?)"?)$/)
  if (m) return m[2] || m[1]
  return header.replace(/^diff --git /, '')
}

export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = []
  let current: DiffFile | null = null
  let inHunk = false

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = { path: headerPath(line), adds: 0, dels: 0, binary: false, lines: [] }
      files.push(current)
      inHunk = false
      continue
    }
    if (!current) continue

    if (line.startsWith('@@')) {
      inHunk = true
      current.lines.push({ kind: 'hunk', text: line })
      continue
    }
    if (!inHunk) {
      // File-header metadata: ---/+++ refine the display path (rename/delete);
      // "Binary files … differ" flags binaries; the rest (index, mode) is noise.
      if (line.startsWith('+++ ') && line !== '+++ /dev/null') {
        current.path = stripPrefix(line.slice(4))
      } else if (line.startsWith('--- ') && line !== '--- /dev/null' && current.path === '') {
        current.path = stripPrefix(line.slice(4))
      } else if (line.startsWith('Binary files ')) {
        current.binary = true
      }
      continue
    }
    if (line.startsWith('+')) {
      current.adds++
      current.lines.push({ kind: 'add', text: line.slice(1) })
    } else if (line.startsWith('-')) {
      current.dels++
      current.lines.push({ kind: 'del', text: line.slice(1) })
    } else if (line.startsWith('\\')) {
      current.lines.push({ kind: 'ctx', text: line }) // "\ No newline at end of file"
    } else if (line.startsWith(' ') || line === '') {
      current.lines.push({ kind: 'ctx', text: line.slice(1) })
    }
  }

  return files
}

/** Overall +/- across all files — the DiffSheet's summary chip. */
export function diffStats(files: DiffFile[]): { files: number; adds: number; dels: number } {
  return files.reduce(
    (acc, f) => ({ files: acc.files + 1, adds: acc.adds + f.adds, dels: acc.dels + f.dels }),
    { files: 0, adds: 0, dels: 0 }
  )
}
