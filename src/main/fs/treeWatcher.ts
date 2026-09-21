import fs from 'fs'
import path from 'path'

/**
 * One file-descriptor watcher for a whole workspace tree.
 *
 * Why this exists (2026-09-16): opening a large folder on a fresh Mac killed the
 * Files surface with `fs:read-dir … EMFILE: too many open files`. Both tree
 * watchers used chokidar 4, which has no FSEvents backend and therefore opens
 * ONE `fs.watch` handle — one kqueue descriptor — per file AND per directory it
 * watches. A home or Documents folder at depth 3 is tens of thousands of
 * entries, the kernel caps a process at `kern.maxfilesperproc` (61,440 on a
 * default Mac), and once the watchers own every descriptor, `readdir` itself
 * has none left. The 2026-07 ignore list only moved the cliff.
 *
 * Node ≥ 20 supports `fs.watch(root, { recursive: true })` on macOS (FSEvents),
 * Windows (ReadDirectoryChangesW) and Linux (inotify tree): a single handle
 * that costs zero descriptors per entry. This module wraps it, applies the
 * same ignore + depth rules the chokidar watchers used, and translates the raw
 * `rename`/`change` pairs into the add / change / unlink events the indexer and
 * the file tree already understand. A platform that refuses the recursive
 * option throws from `watchTree`; callers decide whether to run without live
 * updates (they all can — the initial walk is separate).
 */

export type TreeEvent = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export interface TreeWatcher {
  close: () => void
}

export interface WatchTreeOptions {
  /** How many directory levels below `root` still emit events (chokidar's `depth`). */
  depth: number
  onEvent: (event: TreeEvent, absPath: string) => void
  /** Optional: swallow a watcher-level error instead of throwing later. */
  onError?: (err: Error) => void
}

/** Dot-entries and dependency/build trees: never useful, and the bulk of any
 *  developer folder. Shared by the file tree and the search indexer. */
export const IGNORED_SEGMENT = /^(\.[^/\\]+|node_modules|dist|build|out|release|coverage|target)$/

/** True when any path segment (relative to the watched root) is ignored. */
export function isIgnoredRelative(rel: string): boolean {
  return rel.split(/[/\\]/).some((seg) => IGNORED_SEGMENT.test(seg))
}

/** chokidar semantics: depth 0 = the root's direct children only. */
export function withinDepth(rel: string, depth: number): boolean {
  const segments = rel.split(/[/\\]/).filter(Boolean)
  return segments.length - 1 <= depth
}

export function watchTree(root: string, opts: WatchTreeOptions): TreeWatcher {
  const watcher = fs.watch(root, { recursive: true, persistent: true }, (kind, filename) => {
    if (!filename) return
    const rel = String(filename)
    if (isIgnoredRelative(rel) || !withinDepth(rel, opts.depth)) return
    const abs = path.join(root, rel)
    // `rename` covers create, delete and move; only a stat tells which. `change`
    // is content or metadata on an existing entry.
    if (kind === 'change') {
      opts.onEvent('change', abs)
      return
    }
    fs.stat(abs, (err, st) => {
      if (err) {
        // Gone. We cannot know whether it was a file or a directory; the
        // consumers only need the path (the tree refreshes the parent, the
        // index drops the key), so report the file form.
        opts.onEvent('unlink', abs)
        return
      }
      opts.onEvent(st.isDirectory() ? 'addDir' : 'add', abs)
    })
  })
  watcher.on('error', (err) => {
    if (opts.onError) opts.onError(err)
    else console.warn(`[tree-watcher] ${root}: ${err.message}`)
  })
  return {
    close: () => {
      try {
        watcher.close()
      } catch {
        /* already closed */
      }
    },
  }
}
