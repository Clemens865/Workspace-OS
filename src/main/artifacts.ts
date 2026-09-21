import fs from 'fs'
import path from 'path'

/**
 * Artifact pipeline: turn the files an agent run produced or touched into
 * classified, openable records the renderer can surface as cards. The classifier
 * (classifyArtifact) is pure and path-based so it's trivially unit-testable; the
 * fs-touching helpers (snapshotArtifacts / changedArtifacts) build on it.
 *
 * Adapted from Chrome_Buddy's artifact extraction (fenced-block → card) and
 * City-AI's tool-output classification (classify, don't require an explicit
 * artifact flag), applied here to the agent run's real workspace files.
 */

export type ArtifactType = 'office' | 'page' | 'image' | 'code' | 'data' | 'diff' | 'other'

export interface Artifact {
  /** Absolute path to the file on disk. */
  path: string
  /** Basename, for the card label. */
  name: string
  /** Coarse type — drives the card icon and which Canvas renderer opens it. */
  type: ArtifactType
}

// Extension → type. Order of the checks in classifyArtifact resolves overlaps
// (e.g. a .patch is a diff, never data). Documents that open in a rich Canvas
// view (office suite + pdf) are grouped as 'office'.
const OFFICE = new Set(['.docx', '.doc', '.odt', '.xlsx', '.xls', '.ods', '.pptx', '.ppt', '.odp', '.pdf'])
// A built web PAGE is a deliverable, not source code: the canvas renders it with
// a live Preview/Code toggle, and the cockpit shows it as a real preview. It is
// classified apart from '.css'/'.js' so an agent's finished page auto-opens the
// way a generated deck does, instead of being filed as a code file nobody opens.
const PAGE = new Set(['.html', '.htm'])
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.tiff', '.ico'])
const DATA = new Set(['.csv', '.tsv', '.json', '.yaml', '.yml', '.xml', '.sql'])
const CODE = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.cpp', '.c', '.h',
  '.rb', '.php', '.sh', '.bash', '.zsh', '.css', '.scss', '.md',
  '.txt', '.toml', '.ini',
])
const DIFF = new Set(['.diff', '.patch'])

/** Every extension worth surfacing — the walker only tracks these. */
const TRACKED = new Set<string>([...OFFICE, ...PAGE, ...IMAGE, ...DATA, ...CODE, ...DIFF])

// Heavy/generated directories a workspace-relative walk should never descend
// into (dotdirs are skipped separately). Keeps the post-run scan cheap and the
// results signal-not-noise.
const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', '.next', 'target', 'vendor', '__pycache__',
])

/**
 * Classify one path by its extension. Pure — no fs access — so it's safe to call
 * on paths that may no longer exist and is unit-tested in isolation.
 */
export function classifyArtifact(filePath: string): Artifact {
  const name = path.basename(filePath)
  const ext = path.extname(name).toLowerCase()
  let type: ArtifactType = 'other'
  if (DIFF.has(ext)) type = 'diff'
  else if (OFFICE.has(ext)) type = 'office'
  else if (PAGE.has(ext)) type = 'page'
  else if (IMAGE.has(ext)) type = 'image'
  else if (DATA.has(ext)) type = 'data'
  else if (CODE.has(ext)) type = 'code'
  return { path: filePath, name, type }
}

/** True if the extension is one we track as a potential artifact. */
export function isTrackedArtifact(filePath: string): boolean {
  return TRACKED.has(path.extname(filePath).toLowerCase())
}

/**
 * Map every tracked file under `root` (depth-limited, heavy dirs skipped) to its
 * mtime. Snapshot before a run, diff after — that's how changedArtifacts detects
 * what the agent produced without a manifest.
 */
export function snapshotArtifacts(root: string, depth = 4): Map<string, number> {
  const out = new Map<string, number>()
  const walk = (dir: string, d: number): void => {
    if (d < 0) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue // skip dotdirs (incl. the checkpoint store)
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name)) walk(full, d - 1)
      } else if (isTrackedArtifact(e.name)) {
        try { out.set(full, fs.statSync(full).mtimeMs) } catch { /* raced away */ }
      }
    }
  }
  walk(root, depth)
  return out
}

/**
 * The tracked files created or modified since `before`, newest first, classified
 * and capped. Reuses one workspace walk — the caller derives both the card list
 * and the office auto-open target from a single scan.
 */
export function changedArtifacts(root: string, before: Map<string, number>, limit = 12): Artifact[] {
  const after = snapshotArtifacts(root)
  const changed: { path: string; mtime: number }[] = []
  for (const [file, mtime] of after) {
    const prev = before.get(file)
    if (prev === undefined || mtime > prev) changed.push({ path: file, mtime })
  }
  changed.sort((a, b) => b.mtime - a.mtime)
  return changed.slice(0, limit).map((c) => classifyArtifact(c.path))
}
