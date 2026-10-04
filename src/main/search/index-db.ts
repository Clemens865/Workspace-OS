import Database from 'better-sqlite3'
import type { SymbolEntry, SymbolKind } from './symbols'
import { scoreRelated, type RelatedNote, type RelatedEdge } from './related'
import { EXTRACT_VERSION, EXTRACTED_TYPES, locate } from './extract'

export type { RelatedNote } from './related'

/**
 * Local full-text search index over document *content*, not just filenames.
 *
 * Uses SQLite FTS5 so the contents of `.docx`, `.pdf`, `.xlsx`, and text files
 * are searchable on-device — no cloud, no telemetry. The index is persistent
 * (survives restarts) and updated incrementally as files change.
 */

export interface IndexedFile {
  path: string
  name: string
  ext: string
  mtimeMs: number
  content: string
}

export interface SearchResult {
  path: string
  name: string
  snippet: string
  matchType: 'filename' | 'content'
}

/** A structural symbol (heading / code entity) located within a file. */
export interface SymbolResult {
  path: string
  name: string
  kind: SymbolKind
  line: number
}

/** One `[[wikilink]]` extracted from a file, ready to store in the link index. */
export interface FileLink {
  /** The referenced note name (as written). */
  targetName: string
  /** Optional `#heading` fragment. */
  heading?: string
  /** Character offset of the link in the source (for ordering / snippets). */
  position: number
  /** The line (trimmed) the link appears on — surfaced as the backlink snippet. */
  snippet: string
}

/** A backlink: a source note that links TO the queried file. */
export interface Backlink {
  /** Absolute path of the linking (source) file. */
  path: string
  /** Basename of the linking file. */
  name: string
  /** The line the link appears on. */
  snippet: string
  /** Optional `#heading` the link targeted. */
  heading?: string
}

/** One outgoing link from a file — resolved to a real path, or a stub (null). */
export interface OutgoingLink {
  targetName: string
  heading?: string
  snippet: string
  /** Resolved destination file, or null when the target note doesn't exist yet. */
  resolvedPath: string | null
  /** True when the name matched >1 file (resolvedPath is the deterministic pick). */
  ambiguous: boolean
}

/** A stub: a referenced note name that no file resolves to (yet). */
export interface Stub {
  targetName: string
  /** How many distinct notes reference this missing name. */
  refCount: number
}

/** One hit for an agent's question: where it is, the words around it, and how well it fits. */
export interface KnowledgeHit {
  path: string
  name: string
  snippet: string
  /** "Page 3", "Slide 2", "Sheet: Budget" — when the file has such marks. */
  location: string | null
  /** Higher is better (negated bm25). */
  score: number
}

export interface IndexStats {
  indexed: number
}

/** One node in the knowledge graph — a real note or a referenced-but-missing stub. */
export interface GraphNode {
  /** Stable id: the file path for notes, `stub:<key>` for stubs. */
  id: string
  /** Display label (basename for notes, the referenced name for stubs). */
  name: string
  kind: 'note' | 'stub'
  /** In + out degree (how connected the node is) — drives node size. */
  degree: number
}

/** One directed edge — a resolved link (or a link to a stub), with its multiplicity. */
export interface GraphEdge {
  /** Source node id (a note path). */
  source: string
  /** Target node id (a note path, or `stub:<key>`). */
  target: string
  /** How many distinct links this edge collapses (parallel [[refs]]). */
  count: number
}

/** The whole-workspace [[wikilink]] graph: nodes (notes + stubs) + resolved edges. */
export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** True when the node/edge cap clipped the result (graph is partial). */
  truncated: boolean
}

/** Note extensions that participate in the graph — mirrors the indexer's LINKABLE. */
const GRAPH_KINDS = new Set(['md', 'markdown', 'txt', 'mdx'])

/** Normalises a note name / basename to its case-insensitive resolution key. */
function nameKey(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Basename without its extension (the key a `[[target]]` resolves against). */
function baseNoExt(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? filePath
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/** Escapes a user query into a safe FTS5 prefix-match expression. */
// Words that carry no meaning in a question, English and German (the person writes both).
const STOP = new Set(
  (
    'a an and are as at be but by can could did do does for from had has have how i if in into is it its me my no not of on or our so than that the their them then there these they this to was we were what when where which who why will with would you your ' +
    'about after all also any been before being both each few more most other over same some such only own very just should now ' +
    'der die das den dem des ein eine einen einem einer eines und oder aber ist sind war waren wird werden wurde hat haben hatte mit von zu zur zum im in am an auf aus bei für fur über uber unter nach vor wie was wer wo wann warum welche welcher welches ich du er sie es wir ihr mein meine dein sein ihre unser nicht kein keine auch noch nur schon so dass als wenn ob bitte'
  ).split(' '),
)

/** The meaningful words of a question, for an any-word ranked search (at most 12). */
export function askTerms(raw: string): string[] {
  const words = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w.length >= 2 && !STOP.has(w))
  return [...new Set(words)].slice(0, 12)
}

function toFtsQuery(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .replace(/["()*]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (tokens.length === 0) return ''
  // Quote each token and add a prefix wildcard for as-you-type matching.
  return tokens.map((t) => `"${t}"*`).join(' AND ')
}

/**
 * SQL that keeps rows whose `col` path lies under one of `under` (the open
 * workspace, as written and as its real path). The index is shared by every
 * workspace, so a LIMIT must apply after this cut, not before it.
 */
function underClause(col: string, under?: string[]): { sql: string; params: string[] } {
  if (!under?.length) return { sql: '', params: [] }
  const esc = (p: string): string => p.replace(/[%_\\]/g, '\\$&')
  return {
    sql: ` AND (${under.map(() => `${col} LIKE ? ESCAPE '\\'`).join(' OR ')})`,
    params: under.map((r) => `${esc(r.replace(/\/+$/, ''))}/%`),
  }
}

export class SearchIndex {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path     TEXT PRIMARY KEY,
        name     TEXT NOT NULL,
        ext      TEXT NOT NULL,
        mtime_ms REAL NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS file_fts USING fts5(
        path UNINDEXED,
        name,
        content,
        tokenize = 'porter unicode61'
      );
      CREATE TABLE IF NOT EXISTS symbols (
        path       TEXT NOT NULL,
        name       TEXT NOT NULL,
        name_lower TEXT NOT NULL,
        kind       TEXT NOT NULL,
        line       INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_symbols_path ON symbols(path);
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name_lower);

      -- One row per [[wikilink]] found in a source file. resolved_path is the
      -- file the target_key currently maps to (basename-without-ext, lowercased),
      -- or NULL for a stub (the referenced note doesn't exist yet).
      CREATE TABLE IF NOT EXISTS links (
        source_path   TEXT NOT NULL,
        target_name   TEXT NOT NULL,
        target_key    TEXT NOT NULL,
        heading       TEXT,
        resolved_path TEXT,
        position      INTEGER NOT NULL,
        snippet       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_links_source   ON links(source_path);
      CREATE INDEX IF NOT EXISTS idx_links_resolved ON links(resolved_path);
      CREATE INDEX IF NOT EXISTS idx_links_key      ON links(target_key);
    `)
    // Add a resolution key to `files` (basename-without-ext, lowercased). Added
    // via migration so existing indexes upgrade in place; backfilled below.
    const cols = this.db.prepare('PRAGMA table_info(files)').all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'name_key')) {
      this.db.exec('ALTER TABLE files ADD COLUMN name_key TEXT')
      const rows = this.db.prepare('SELECT path FROM files').all() as Array<{ path: string }>
      const upd = this.db.prepare('UPDATE files SET name_key = ? WHERE path = ?')
      const tx = this.db.transaction(() => {
        for (const r of rows) upd.run(nameKey(baseNoExt(r.path)), r.path)
      })
      tx()
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_files_name_key ON files(name_key)')
    // Office files indexed by an older extractor are read again (their mtime no longer matches).
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const v = Number((this.db.prepare("SELECT value FROM meta WHERE key = 'extract_version'").get() as { value: string } | undefined)?.value ?? 0)
    if (v < EXTRACT_VERSION) {
      this.db.prepare(`UPDATE files SET mtime_ms = -1 WHERE ext IN (${EXTRACTED_TYPES.map(() => '?').join(',')})`).run(...EXTRACTED_TYPES)
      this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('extract_version', ?)").run(String(EXTRACT_VERSION))
    }
  }

  /** Returns the stored mtime for a path, or null if not indexed. */
  getMtime(filePath: string): number | null {
    const row = this.db.prepare('SELECT mtime_ms FROM files WHERE path = ?').get(filePath) as
      | { mtime_ms: number }
      | undefined
    return row?.mtime_ms ?? null
  }

  upsert(file: IndexedFile): void {
    const key = nameKey(baseNoExt(file.path))
    const tx = this.db.transaction((f: IndexedFile) => {
      this.db.prepare('DELETE FROM file_fts WHERE path = ?').run(f.path)
      this.db
        .prepare('INSERT OR REPLACE INTO files (path, name, ext, mtime_ms, name_key) VALUES (?, ?, ?, ?, ?)')
        .run(f.path, f.name, f.ext, f.mtimeMs, key)
      this.db
        .prepare('INSERT INTO file_fts (path, name, content) VALUES (?, ?, ?)')
        .run(f.path, f.name, f.content)
      // A newly-indexed file may satisfy stubs that reference its name — attach
      // any so-far-unresolved links whose target_key matches to this path.
      this.db
        .prepare('UPDATE links SET resolved_path = ? WHERE resolved_path IS NULL AND target_key = ?')
        .run(f.path, key)
    })
    tx(file)
  }

  remove(filePath: string): void {
    const key = nameKey(baseNoExt(filePath))
    const tx = this.db.transaction((p: string) => {
      this.db.prepare('DELETE FROM files WHERE path = ?').run(p)
      this.db.prepare('DELETE FROM file_fts WHERE path = ?').run(p)
      this.db.prepare('DELETE FROM symbols WHERE path = ?').run(p)
      // Drop this file's outgoing links, and demote any links that resolved TO
      // it back to a stub (or re-point them at another file with the same name).
      this.db.prepare('DELETE FROM links WHERE source_path = ?').run(p)
      const fallback = (this.db
        .prepare('SELECT path FROM files WHERE name_key = ? ORDER BY path LIMIT 1')
        .get(key) as { path: string } | undefined)?.path ?? null
      this.db
        .prepare('UPDATE links SET resolved_path = ? WHERE resolved_path = ?')
        .run(fallback, p)
    })
    tx(filePath)
  }

  /** Replaces all stored symbols for a file (old rows are cleared first). Passing
   *  an empty list just clears them — keeps the table consistent on re-index. */
  setSymbols(filePath: string, symbols: SymbolEntry[]): void {
    const tx = this.db.transaction((p: string, syms: SymbolEntry[]) => {
      this.db.prepare('DELETE FROM symbols WHERE path = ?').run(p)
      const ins = this.db.prepare(
        'INSERT INTO symbols (path, name, name_lower, kind, line) VALUES (?, ?, ?, ?, ?)'
      )
      for (const s of syms) ins.run(p, s.name, s.name.toLowerCase(), s.kind, s.line)
    })
    tx(filePath, symbols)
  }

  /** Resolves a note name to a file path (case-insensitive, basename-without-ext).
   *  Deterministic on collisions: the alphabetically-first path wins. Returns
   *  null when no file matches (i.e. the name is a stub). */
  resolveName(name: string): string | null {
    const key = nameKey(name)
    if (!key) return null
    const row = this.db
      .prepare('SELECT path FROM files WHERE name_key = ? ORDER BY path LIMIT 1')
      .get(key) as { path: string } | undefined
    return row?.path ?? null
  }

  /** True when >1 indexed file shares this name's resolution key (ambiguous). */
  private isAmbiguous(key: string): boolean {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM files WHERE name_key = ?')
      .get(key) as { n: number }
    return row.n > 1
  }

  /** Replaces all outgoing links for a file. Each link is resolved against the
   *  current file set; unmatched targets are stored as stubs (resolved_path
   *  NULL). Passing an empty list just clears the file's links. */
  setLinks(sourcePath: string, links: FileLink[]): void {
    const tx = this.db.transaction((p: string, ls: FileLink[]) => {
      this.db.prepare('DELETE FROM links WHERE source_path = ?').run(p)
      const ins = this.db.prepare(
        `INSERT INTO links (source_path, target_name, target_key, heading, resolved_path, position, snippet)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      for (const l of ls) {
        const key = nameKey(l.targetName)
        if (!key) continue
        const resolved = this.resolveName(l.targetName)
        ins.run(p, l.targetName, key, l.heading ?? null, resolved, l.position, l.snippet)
      }
    })
    tx(sourcePath, links)
  }

  /** Notes that link TO `filePath` (its backlinks), with the linking line. */
  backlinksFor(filePath: string): Backlink[] {
    const rows = this.db
      .prepare(
        `SELECT l.source_path AS path, f.name AS name, l.snippet AS snippet, l.heading AS heading
         FROM links l JOIN files f ON f.path = l.source_path
         WHERE l.resolved_path = ?
         ORDER BY f.name, l.position`
      )
      .all(filePath) as Array<{ path: string; name: string; snippet: string; heading: string | null }>
    return rows.map((r) => ({
      path: r.path,
      name: r.name,
      snippet: r.snippet,
      ...(r.heading ? { heading: r.heading } : {}),
    }))
  }

  /** This file's outgoing links, each flagged resolved / stub / ambiguous. */
  outgoingLinks(filePath: string): OutgoingLink[] {
    const rows = this.db
      .prepare(
        `SELECT target_name, target_key, heading, resolved_path, snippet
         FROM links WHERE source_path = ? ORDER BY position`
      )
      .all(filePath) as Array<{
      target_name: string
      target_key: string
      heading: string | null
      resolved_path: string | null
      snippet: string
    }>
    return rows.map((r) => ({
      targetName: r.target_name,
      ...(r.heading ? { heading: r.heading } : {}),
      snippet: r.snippet,
      resolvedPath: r.resolved_path,
      ambiguous: r.resolved_path !== null && this.isAmbiguous(r.target_key),
    }))
  }

  /** Distinct unresolved target names + how many notes reference each ("notes
   *  people reference that don't exist yet"), most-referenced first. */
  stubs(): Stub[] {
    const rows = this.db
      .prepare(
        `SELECT MIN(target_name) AS target_name, target_key,
                COUNT(DISTINCT source_path) AS ref_count
         FROM links
         WHERE resolved_path IS NULL
         GROUP BY target_key
         ORDER BY ref_count DESC, target_name`
      )
      .all() as Array<{ target_name: string; ref_count: number }>
    return rows.map((r) => ({ targetName: r.target_name, refCount: r.ref_count }))
  }

  /**
   * The whole-workspace [[wikilink]] graph, for the Obsidian-style graph view.
   *
   * Nodes are every note (markdown/txt kind) plus every distinct unresolved
   * target (a "stub"). Edges are distinct resolved links (source → resolved
   * file) and links to stubs (source → `stub:<key>`), collapsed with a count of
   * the parallel refs. Node `degree` is its in+out edge count.
   *
   * Bounded: notes are capped at `maxNodes` (alphabetical), edges at `maxEdges`;
   * either overflow flips `truncated`. Edges only connect surviving nodes.
   */
  graph(maxNodes = 2000, maxEdges = 2000, under?: string[]): Graph {
    // 1. Note nodes — every linkable file, capped alphabetically for determinism.
    const kinds = [...GRAPH_KINDS]
    const placeholders = kinds.map(() => '?').join(', ')
    const scope = underClause('path', under)
    const fileRows = this.db
      .prepare(
        `SELECT path, name FROM files
         WHERE LOWER(ext) IN (${placeholders})${scope.sql}
         ORDER BY path
         LIMIT ?`
      )
      .all(...kinds, ...scope.params, maxNodes + 1) as Array<{ path: string; name: string }>
    let truncated = fileRows.length > maxNodes
    const notes = fileRows.slice(0, maxNodes)
    const noteIds = new Set(notes.map((r) => r.path))

    // 2. Stub nodes — distinct unresolved target keys, with a display name.
    const stubRows = this.db
      .prepare(
        `SELECT target_key AS key, MIN(target_name) AS name
         FROM links WHERE resolved_path IS NULL
         GROUP BY target_key`
      )
      .all() as Array<{ key: string; name: string }>
    const stubId = (key: string): string => `stub:${key}`

    // 3. Edges — resolved links (source → resolved file) collapsed with a count.
    //    Only edges whose source is a surviving note are kept (targets are either
    //    surviving notes or stubs). Distinct-count of source rows = multiplicity.
    const resolvedRows = this.db
      .prepare(
        `SELECT source_path AS source, resolved_path AS target, COUNT(*) AS count
         FROM links WHERE resolved_path IS NOT NULL
         GROUP BY source_path, resolved_path`
      )
      .all() as Array<{ source: string; target: string; count: number }>
    const stubEdgeRows = this.db
      .prepare(
        `SELECT source_path AS source, target_key AS key, COUNT(*) AS count
         FROM links WHERE resolved_path IS NULL
         GROUP BY source_path, target_key`
      )
      .all() as Array<{ source: string; key: string; count: number }>

    // Which stub keys are actually referenced by a surviving note (prune orphans).
    const usedStubs = new Set<string>()
    const degree = new Map<string, number>()
    const bump = (id: string): void => degree.set(id, (degree.get(id) ?? 0) + 1)

    const edges: GraphEdge[] = []
    const pushEdge = (source: string, target: string, count: number): boolean => {
      if (edges.length >= maxEdges) {
        truncated = true
        return false
      }
      edges.push({ source, target, count })
      bump(source)
      bump(target)
      return true
    }

    for (const r of resolvedRows) {
      if (!noteIds.has(r.source) || !noteIds.has(r.target)) continue
      if (!pushEdge(r.source, r.target, r.count)) break
    }
    for (const r of stubEdgeRows) {
      if (!noteIds.has(r.source)) continue
      const target = stubId(r.key)
      if (!pushEdge(r.source, target, r.count)) break
      usedStubs.add(r.key)
    }

    const nodes: GraphNode[] = notes.map((r) => ({
      id: r.path,
      name: r.name,
      kind: 'note' as const,
      degree: degree.get(r.path) ?? 0,
    }))
    for (const s of stubRows) {
      if (!usedStubs.has(s.key)) continue
      const id = stubId(s.key)
      nodes.push({ id, name: s.name, kind: 'stub', degree: degree.get(id) ?? 0 })
    }

    return { nodes, edges, truncated }
  }

  /**
   * The notes most related to `filePath` by pure link-graph proximity — direct
   * links, bibliographic coupling (shared outgoing targets), and co-citation
   * (shared incoming citers). Engine-free, deterministic (see `scoreRelated`).
   *
   * Pulls the whole resolved note→note edge set and scores it in JS. The edge
   * set is bounded (distinct resolved links) so this stays cheap; the candidate
   * cap in `scoreRelated` guards pathological hubs.
   */
  relatedNotes(filePath: string, limit = 10): RelatedNote[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT source_path AS source, resolved_path AS target
         FROM links WHERE resolved_path IS NOT NULL`
      )
      .all() as Array<{ source: string; target: string }>
    const edges: RelatedEdge[] = rows
    // Display names come from the files table (basename), matching the panel.
    const nameRows = this.db.prepare('SELECT path, name FROM files').all() as Array<{
      path: string
      name: string
    }>
    const names = new Map(nameRows.map((r) => [r.path, r.name]))
    return scoreRelated(edges, filePath, limit, (p) => names.get(p) ?? p)
  }

  /** Go-to-symbol query: substring match on symbol name, prefix hits ranked
   *  first, then shorter names. Powers a "Symbols" results section. */
  searchSymbols(raw: string, limit = 50, under?: string[]): SymbolResult[] {
    const q = raw.trim().toLowerCase()
    if (!q) return []
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`
    const scope = underClause('path', under)
    const rows = this.db
      .prepare(
        `SELECT path, name, kind, line
         FROM symbols
         WHERE name_lower LIKE ? ESCAPE '\\'${scope.sql}
         ORDER BY (name_lower LIKE ? ESCAPE '\\') DESC, LENGTH(name), name
         LIMIT ?`
      )
      .all(like, ...scope.params, `${q.replace(/[%_\\]/g, '\\$&')}%`, limit) as Array<{
      path: string
      name: string
      kind: SymbolKind
      line: number
    }>
    return rows.map((r) => ({ path: r.path, name: r.name, kind: r.kind, line: r.line }))
  }

  query(raw: string, limit = 50, under?: string[]): SearchResult[] {
    const fts = toFtsQuery(raw)
    if (!fts) return []
    const scope = underClause('path', under)

    const rows = this.db
      .prepare(
        `SELECT path, name,
                snippet(file_fts, 2, '«', '»', '…', 12) AS snippet,
                bm25(file_fts) AS rank
         FROM file_fts
         WHERE file_fts MATCH ?${scope.sql}
         ORDER BY rank
         LIMIT ?`
      )
      .all(`name : ${fts} OR content : ${fts}`, ...scope.params, limit) as Array<{
      path: string
      name: string
      snippet: string
    }>

    const q = raw.toLowerCase()
    return rows.map((r) => ({
      path: r.path,
      name: r.name,
      snippet: r.snippet,
      matchType: r.name.toLowerCase().includes(q) ? 'filename' : 'content',
    }))
  }

  /**
   * An agent's question against the workspace: any of its meaningful words,
   * ranked by bm25 (a name match counts more), each hit with the words around
   * it and where in the file it is. Scoped like query().
   */
  ask(raw: string, limit = 8, under?: string[]): KnowledgeHit[] {
    const terms = askTerms(raw)
    if (!terms.length) return []
    const scope = underClause('path', under)
    const rows = this.db
      .prepare(
        `SELECT path, name,
                snippet(file_fts, 2, '«', '»', '…', 24) AS snippet,
                bm25(file_fts, 0.0, 4.0, 1.0) AS rank,
                content
         FROM file_fts
         WHERE file_fts MATCH ?${scope.sql}
         ORDER BY rank
         LIMIT ?`,
      )
      .all(terms.map((t) => `"${t}"*`).join(' OR '), ...scope.params, limit) as Array<{ path: string; name: string; snippet: string; rank: number; content: string }>
    return rows.map((r) => ({
      path: r.path,
      name: r.name,
      snippet: r.snippet,
      location: locate(r.content, terms),
      score: Math.round(-r.rank * 100) / 100,
    }))
  }

  /** The indexed text of one file, and the mtime it was read at (null: not indexed). */
  text(filePath: string): { content: string; mtimeMs: number } | null {
    const row = this.db
      .prepare('SELECT t.content AS content, f.mtime_ms AS mtime FROM file_fts t JOIN files f ON f.path = t.path WHERE t.path = ?')
      .get(filePath) as { content: string; mtime: number } | undefined
    return row ? { content: row.content, mtimeMs: row.mtime } : null
  }

  stats(): IndexStats {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number }
    return { indexed: row.n }
  }

  /** Paths currently in the index — used to prune deleted files. */
  allPaths(): string[] {
    const rows = this.db.prepare('SELECT path FROM files').all() as Array<{ path: string }>
    return rows.map((r) => r.path)
  }

  close(): void {
    this.db.close()
  }
}
