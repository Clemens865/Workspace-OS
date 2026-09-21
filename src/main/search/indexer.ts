import fs from 'fs/promises'
import path from 'path'
import { watchTree, type TreeWatcher } from '../fs/treeWatcher'
import { SearchIndex } from './index-db'
import { ExtractPool } from './extract-pool'
import { extractSymbols, hasSymbolSupport } from './symbols'
import { parseWikilinks, lineText } from './wikilinks'

/**
 * Keeps the search index in sync with the workspace. On start it watches the
 * tree (skipping dependency/build trees), and indexes file *content* — but the
 * heavy parsing (PDF/docx/xlsx) runs in a worker pool (extract-pool.ts) so it
 * never stalls the Electron main process. Indexing is incremental (mtime-skip)
 * and bounded (size cap + skip list + concurrency limit).
 */

const INDEXABLE = new Set([
  'txt', 'md', 'csv', 'tsv', 'json', 'yaml', 'yml', 'toml', 'xml', 'html',
  'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h',
  'css', 'scss', 'sh', 'bash', 'sql', 'ini', 'env',
  'docx', 'xlsx', 'xls', 'ods', 'pdf',
])

// Files we never read content from — large/generated/low-signal. They're still
// indexed by *name* so the file is findable, just not by content.
const SKIP_CONTENT = /(^|[/\\])(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|.*\.min\.(js|css)|.*\.map)$/i

// Extensions we scan for [[wikilink]]s — prose/note formats where wikilinks are
// meaningful. Code files carry `[[` as syntax (bash test, etc.), never links.
const LINKABLE = new Set(['md', 'markdown', 'txt', 'mdx'])

// Don't read content from files larger than this (still name-indexed).
const MAX_FILE_BYTES = 5 * 1024 * 1024
// How many files to parse in parallel (matches the worker pool size).
const CONCURRENCY = 3
// Hard cap on files indexed per run — beyond this a workspace is so large that
// full content indexing isn't worth freezing on; the rest stays name-searchable
// via the file tree. Generous, but bounded.
const MAX_FILES = 30_000
// Above this, setting up a live chokidar watch over every dir is impractical
// (fd cost + setup time), so we index once via the walk and skip live updates.
const WATCH_LIMIT = 8_000
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'release', 'coverage', 'target', '.git'])

export interface IndexerStatus {
  running: boolean
  indexed: number
  queued: number
  /** files processed this run / total enqueued this run (for a progress count). */
  done: number
  total: number
}

export class Indexer {
  private watcher: TreeWatcher | null = null
  private pool: ExtractPool | null = null
  // FIFO queue with a head pointer (O(1) dequeue) + a Set for O(1) dedup. The
  // old Array.includes() dedup was O(n) → O(n²) on a large tree's initial scan,
  // which froze the main process. Never reintroduce includes() here.
  private queue: string[] = []
  private head = 0
  private inQueue = new Set<string>()
  // Priority tier — drained ahead of the normal queue. The open file / on-demand
  // requests land here so what you're looking at is searchable within seconds,
  // even while a huge tree's deep tail is still indexing behind it.
  private prioQueue: string[] = []
  private prioHead = 0
  private capped = false
  private scanning = false
  private inFlight = 0
  private running = false
  private done = 0
  private total = 0

  constructor(private index: SearchIndex) {}

  /** Index a specific file ahead of the queue (called when a file is opened, so
   *  its content is searchable almost immediately). Cheap if already current. */
  prioritize(filePath: string): void {
    const ext = path.extname(filePath).slice(1).toLowerCase()
    if (!INDEXABLE.has(ext)) return
    this.prioQueue.push(filePath)
    this.pump()
  }

  status(): IndexerStatus {
    const queued = (this.queue.length - this.head) + (this.prioQueue.length - this.prioHead)
    return {
      running: this.scanning || this.running || queued > 0 || this.inFlight > 0,
      indexed: this.index.stats().indexed,
      queued,
      done: this.done,
      total: this.total,
    }
  }

  async start(root: string): Promise<void> {
    await this.stop()
    this.pool = new ExtractPool(CONCURRENCY)
    this.queue = []
    this.head = 0
    this.inQueue.clear()
    this.prioQueue = []
    this.prioHead = 0
    this.capped = false
    this.done = 0
    this.total = 0

    // Initial enumeration is a manual, yielding, bounded, BREADTH-FIRST walk —
    // not chokidar (which would freeze the main process on a 100k+ file tree),
    // and breadth-first so shallow workspace files index before the deep tail.
    this.scanning = true
    await this.walk(root)
    this.scanning = false

    // Live re-index on change — only for trees small enough that watching every
    // directory is cheap. Huge workspaces index once via the walk; reopening the
    // folder refreshes them. (The file-tree's own watcher is separate.)
    //
    // ALWAYS close + null any prior watcher before deciding whether to create a
    // new one. `stop()` above already does this, but a workspace switch or a
    // re-`start()` that then crosses the WATCH_LIMIT (no new watcher created)
    // must never leave an open FSWatcher dangling → fd exhaustion (a class we've
    // hit). Belt-and-suspenders, cheap, and idempotent.
    this.watcher?.close()
    this.watcher = null
    if (this.total < WATCH_LIMIT) {
      // One recursive handle for the whole tree (see fs/treeWatcher.ts). The
      // old per-entry watcher owned one descriptor per file and starved
      // readdir on big folders.
      try {
        this.watcher = watchTree(root, {
          depth: 8,
          onEvent: (event, p) => {
            if (event === 'add' || event === 'change') this.enqueue(p)
            else if (event === 'unlink') this.index.remove(p)
          },
        })
      } catch (err) {
        console.warn(`[indexer] live re-index watcher unavailable: ${(err as Error).message}`)
      }
    } else {
      console.warn(`[indexer] ${this.total}+ files — live re-index watcher disabled for this large workspace`)
    }
  }

  /** Bounded, yielding, breadth-first directory walk that enqueues indexable
   *  files shallow-first (so the workspace's top-level docs index before the deep
   *  tail). Uses a dir queue with a head pointer; yields to keep the UI free. */
  private async walk(root: string): Promise<void> {
    const dirs: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
    let dh = 0
    let n = 0
    while (dh < dirs.length && this.total < MAX_FILES) {
      const { dir, depth } = dirs[dh++]
      let entries: import('fs').Dirent[]
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        if (this.total >= MAX_FILES) break
        const name = e.name
        if (name.startsWith('.')) continue
        const full = path.join(dir, name)
        if (e.isDirectory()) {
          if (depth < 8 && !IGNORE_DIRS.has(name)) dirs.push({ dir: full, depth: depth + 1 })
        } else if (e.isFile()) {
          this.enqueue(full)
        }
        // Yield finely — every ~64 ENTRIES, counted across directories — so a
        // single huge directory can't stall the main thread between yields (the
        // old per-batch cadence let one 10k-entry dir run uninterrupted).
        if (++n % 64 === 0) await new Promise((r) => setImmediate(r)) // keep the UI responsive
      }
      if (dh > 4096 && dh * 2 > dirs.length) { dirs.splice(0, dh); dh = 0 }
    }
  }

  async stop(): Promise<void> {
    this.watcher?.close()
    this.watcher = null
    await this.pool?.terminate()
    this.pool = null
    this.queue = []
    this.head = 0
    this.inQueue.clear()
    this.prioQueue = []
    this.prioHead = 0
    this.scanning = false
    this.inFlight = 0
    this.running = false
  }

  private enqueue(filePath: string): void {
    const ext = path.extname(filePath).slice(1).toLowerCase()
    if (!INDEXABLE.has(ext)) return
    if (this.inQueue.has(filePath)) return // O(1) dedup (NOT Array.includes)
    if (this.total >= MAX_FILES) {
      if (!this.capped) { this.capped = true; console.warn(`[indexer] reached ${MAX_FILES}-file content-index cap; further files stay name-only searchable`) }
      return
    }
    this.inQueue.add(filePath)
    this.queue.push(filePath)
    this.total++
    this.pump()
  }

  /** Dispatches up to CONCURRENCY files at once — priority tier first, then the
   *  normal queue. Parsing happens in the worker pool. */
  private pump(): void {
    if (!this.pool) return // mid start/stop — items wait in the queues
    this.running = true
    while (this.inFlight < CONCURRENCY) {
      let filePath: string | undefined
      if (this.prioHead < this.prioQueue.length) {
        filePath = this.prioQueue[this.prioHead++]
      } else if (this.head < this.queue.length) {
        filePath = this.queue[this.head++]
        this.inQueue.delete(filePath)
      } else {
        break
      }
      this.inFlight++
      void this.indexOne(filePath).finally(() => {
        this.inFlight--
        this.done++
        // Reclaim consumed heads so the arrays don't grow unbounded.
        if (this.head > 8192 && this.head * 2 > this.queue.length) { this.queue = this.queue.slice(this.head); this.head = 0 }
        if (this.prioHead > 256 && this.prioHead * 2 > this.prioQueue.length) { this.prioQueue = this.prioQueue.slice(this.prioHead); this.prioHead = 0 }
        if (this.prioHead < this.prioQueue.length || this.head < this.queue.length) this.pump()
        else if (this.inFlight === 0) this.running = false
      })
    }
  }

  private async indexOne(filePath: string): Promise<void> {
    try {
      const stat = await fs.stat(filePath)
      // Skip files already current in the index.
      if (this.index.getMtime(filePath) === stat.mtimeMs) return

      // Oversized or generated files: index by name only (content = '').
      const nameOnly = stat.size > MAX_FILE_BYTES || SKIP_CONTENT.test(filePath)
      let content = ''
      if (!nameOnly) {
        // If the pool was torn down (start/stop transition), skip rather than
        // index empty content — an empty upsert would set the mtime and the
        // mtime-skip would then block the real re-index ("poisoning" the file).
        if (!this.pool) return
        content = (await this.pool.extract(filePath)) ?? ''
      }

      const ext = path.extname(filePath).slice(1).toLowerCase()
      this.index.upsert({
        path: filePath,
        name: path.basename(filePath),
        ext,
        mtimeMs: stat.mtimeMs,
        content,
      })

      // Structural symbol pass — a cheap regex over the content we already have
      // in memory (no extra IO/worker). Only for text/code types that carry an
      // outline; office/pdf raw text yields none. setSymbols() clears stale rows
      // even when nothing is extracted, so re-index stays consistent.
      if (content && hasSymbolSupport(ext)) {
        this.index.setSymbols(filePath, extractSymbols(ext, content))
      } else {
        this.index.setSymbols(filePath, [])
      }

      // [[wikilink]] pass — same in-memory content, prose/note formats only.
      // setLinks clears stale rows even when none are found, so the link graph
      // stays consistent on re-index (and stubs re-resolve when files appear).
      if (content && LINKABLE.has(ext)) {
        const links = parseWikilinks(content).map((l) => ({
          targetName: l.target,
          heading: l.heading,
          position: l.index,
          snippet: lineText(content, l.index),
        }))
        this.index.setLinks(filePath, links)
      } else {
        this.index.setLinks(filePath, [])
      }
    } catch {
      // File vanished or unreadable mid-scan — ignore.
    }
  }
}
