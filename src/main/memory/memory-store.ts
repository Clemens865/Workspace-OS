import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

/**
 * The workspace's OWN memory — the first memory this app writes rather than
 * reads.
 *
 * Until now "memory" was a read-only window onto claude-pulse's database, so the
 * product could show you what Claude Code had done but could never learn
 * anything itself: every agent run started cold. This store is the write side.
 *
 * DESIGN DECISIONS, and why:
 *
 *  SCOPE — memories are WORKSPACE-scoped by default (`.workspace-os/memory.db`,
 *  travelling with the folder, syncable and reviewable alongside the work) with
 *  an opt-in GLOBAL scope for facts that are about the person rather than the
 *  project ("prefers metric units"). Retrofitting scope later means rewriting
 *  every row, so it is decided up front.
 *
 *  PROVENANCE IS MANDATORY. Every memory records where it came from — a file, an
 *  agent run, or the user saying so. A memory you cannot trace is one you can
 *  neither trust nor correct, and an agent confidently repeating an unattributable
 *  "fact" is worse than one that knows nothing.
 *
 *  NO FABRICATED CONFIDENCE. There is no 0-1 score, because nothing here can
 *  honestly produce one — the same reason the cockpit dropped confidence bars.
 *  What IS recorded is real: when it was learned, how often it has been
 *  reinforced, and when it was last used.
 *
 *  CORRECTABLE BY CONSTRUCTION. Memories can be superseded (keeping the history)
 *  or deleted outright. A memory system without a forget button becomes a
 *  liability the moment it learns something wrong.
 *
 *  RETRIEVAL IS HYBRID AND LEXICAL FOR NOW — FTS5 + recency + reinforcement.
 *  Embeddings are a deliberate later step (they need a model decision); the
 *  schema leaves room for a vector column so adding them is additive.
 */

export type MemoryKind =
  /** A durable statement about the world/project ("the Q3 model lives in budget.xlsx"). */
  | 'fact'
  /** How the user likes things done ("always send decks as PDF"). */
  | 'preference'
  /** A choice made, with its reason — the thing people forget first. */
  | 'decision'
  /** A person, client, system or product the work revolves around. */
  | 'entity'

export type MemoryScope = 'workspace' | 'global'

export interface MemoryInput {
  kind: MemoryKind
  /** The memory itself, in plain language. One idea per row. */
  text: string
  /** Where it came from — required. See the provenance note above. */
  source: string
  scope?: MemoryScope
  /** Optional free tags/entities for filtering. */
  tags?: string[]
}

export interface Memory {
  id: string
  kind: MemoryKind
  text: string
  source: string
  scope: MemoryScope
  tags: string[]
  createdAt: number
  updatedAt: number
  /** How many times this has been re-observed. Real signal, not a guess. */
  reinforced: number
  /** Last time it was retrieved into an agent's context. */
  lastUsedAt: number | null
  /** Set when a newer memory replaced this one; kept for history. */
  supersededBy: string | null
}

/** Tag separator. A visible, unlikely character rather than a comma, so a tag
 *  containing a comma cannot split itself in two. */
const TAG_SEP = '\u0001'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    source TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'workspace',
    tags TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    reinforced INTEGER NOT NULL DEFAULT 1,
    last_used_at INTEGER,
    superseded_by TEXT,
    -- Reserved for embeddings. Declared now so adding semantic retrieval later
    -- is an additive migration rather than a table rewrite.
    embedding BLOB
  );
  CREATE INDEX IF NOT EXISTS idx_mem_kind ON memories(kind);
  CREATE INDEX IF NOT EXISTS idx_mem_active ON memories(superseded_by);
  -- NOT contentless: a content='' FTS5 table stores no column values, so the id
  -- could not be read back and every search returned nothing.
  CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    id UNINDEXED, text, tags
  );
`

/** Normalised form used to detect "we already know this". */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Turn a user query into an FTS5 MATCH expression.
 *
 * Raw input cannot go in: an apostrophe or a bare `AND` is a syntax error that
 * would surface as "search is broken". Terms are quoted and OR-ed so a
 * multi-word query behaves like a search box rather than requiring every word.
 */
export function toMatchQuery(raw: string): string | null {
  const terms = raw.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const useful = terms.filter((t) => t.length > 1).slice(0, 12)
  if (useful.length === 0) return null
  return useful.map((t) => `"${t}"*`).join(' OR ')
}

/**
 * Rank a candidate for retrieval.
 *
 * Deliberately simple and explainable: lexical relevance, plus a nudge for
 * memories that have been reinforced, plus mild recency. A memory the user has
 * restated three times should outrank one mentioned once — that repetition is
 * the closest thing to a real confidence signal we have, and unlike a model
 * score it is something they can see and reason about.
 */
export function score(m: Pick<Memory, 'reinforced' | 'updatedAt'>, lexical: number, now: number): number {
  const ageDays = Math.max(0, (now - m.updatedAt) / 86_400_000)
  const recency = 1 / (1 + ageDays / 30) // half-ish weight after a month
  return lexical + Math.log2(1 + m.reinforced) * 0.5 + recency * 0.5
}

export class MemoryStore {
  private db: Database.Database

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(SCHEMA)
  }

  close(): void {
    try { this.db.close() } catch { /* already closed */ }
  }

  private row2mem(r: Record<string, unknown>): Memory {
    return {
      id: r.id as string,
      kind: r.kind as MemoryKind,
      text: r.text as string,
      source: r.source as string,
      scope: (r.scope as MemoryScope) ?? 'workspace',
      tags: r.tags ? String(r.tags).split(TAG_SEP).filter(Boolean) : [],
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
      reinforced: r.reinforced as number,
      lastUsedAt: (r.last_used_at as number) ?? null,
      supersededBy: (r.superseded_by as string) ?? null,
    }
  }

  /**
   * Record a memory.
   *
   * An identical memory (same kind, same normalised text) is REINFORCED rather
   * than duplicated: agents re-observe the same fact constantly, and without
   * this the store fills with near-identical rows that crowd out everything else
   * at retrieval time. Reinforcement is also the honest signal — it says "seen
   * again" instead of inventing a confidence number.
   */
  remember(input: MemoryInput): Memory {
    const text = input.text.trim()
    if (!text) throw new Error('A memory needs text')
    if (!input.source?.trim()) throw new Error('A memory needs a source — an unattributable fact cannot be trusted or corrected')
    const scope: MemoryScope = input.scope === 'global' ? 'global' : 'workspace'
    const norm = normalize(text)
    const now = Date.now()

    const existing = this.db
      .prepare(`SELECT * FROM memories WHERE kind = ? AND superseded_by IS NULL`)
      .all(input.kind) as Record<string, unknown>[]
    const dup = existing.find((r) => normalize(String(r.text)) === norm)
    if (dup) {
      this.db.prepare(`UPDATE memories SET reinforced = reinforced + 1, updated_at = ?, source = ? WHERE id = ?`)
        .run(now, input.source, dup.id)
      return this.get(dup.id as string)!
    }

    const id = crypto.randomUUID()
    const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean).join(TAG_SEP)
    this.db.prepare(
      `INSERT INTO memories (id, kind, text, source, scope, tags, created_at, updated_at, reinforced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    ).run(id, input.kind, text, input.source, scope, tags, now, now)
    this.db.prepare(`INSERT INTO memory_fts (id, text, tags) VALUES (?, ?, ?)`).run(id, text, tags.split(TAG_SEP).join(' '))
    return this.get(id)!
  }

  get(id: string): Memory | null {
    const r = this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as Record<string, unknown> | undefined
    return r ? this.row2mem(r) : null
  }

  /** Every live memory, newest first. Superseded ones are excluded. */
  list(opts: { kind?: MemoryKind; limit?: number } = {}): Memory[] {
    const rows = this.db.prepare(
      `SELECT * FROM memories WHERE superseded_by IS NULL ${opts.kind ? 'AND kind = ?' : ''}
       ORDER BY updated_at DESC LIMIT ?`,
    ).all(...(opts.kind ? [opts.kind, opts.limit ?? 200] : [opts.limit ?? 200])) as Record<string, unknown>[]
    return rows.map((r) => this.row2mem(r))
  }

  /**
   * Retrieve the memories most relevant to a query.
   *
   * Lexical for now (FTS5), ranked by {@link score}. A query with no usable
   * terms returns the most reinforced recent memories rather than nothing —
   * "what do you know?" is a fair question and deserves an answer.
   */
  search(query: string, limit = 10): Memory[] {
    const match = toMatchQuery(query)
    const now = Date.now()
    if (!match) {
      return this.list({ limit }).sort((a, b) => score(b, 0, now) - score(a, 0, now)).slice(0, limit)
    }
    let hits: { id: string; rank: number }[]
    try {
      hits = this.db.prepare(
        `SELECT id, bm25(memory_fts) AS rank FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?`,
      ).all(match, limit * 4) as { id: string; rank: number }[]
    } catch {
      // A malformed MATCH must degrade to "no lexical hits", never crash the
      // surface that asked.
      return this.list({ limit }).slice(0, limit)
    }
    const out: { m: Memory; s: number }[] = []
    for (const h of hits) {
      const m = this.get(h.id)
      if (!m || m.supersededBy) continue
      // bm25 returns NEGATIVE numbers, better = more negative.
      out.push({ m, s: score(m, -h.rank, now) })
    }
    return out.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.m)
  }

  /** Mark memories as used — feeds recency without inventing a score. */
  markUsed(ids: readonly string[]): void {
    if (ids.length === 0) return
    const now = Date.now()
    const stmt = this.db.prepare(`UPDATE memories SET last_used_at = ? WHERE id = ?`)
    const tx = this.db.transaction((list: readonly string[]) => { for (const id of list) stmt.run(now, id) })
    tx(ids)
  }

  /**
   * Replace a memory with a corrected one, keeping the old row as history.
   * Correction is the common case — facts change — and losing the trail makes it
   * impossible to see why the agent believed something.
   */
  supersede(id: string, next: MemoryInput): Memory | null {
    const old = this.get(id)
    if (!old) return null
    const created = this.remember(next)
    this.db.prepare(`UPDATE memories SET superseded_by = ?, updated_at = ? WHERE id = ?`).run(created.id, Date.now(), id)
    return created
  }

  /** Delete outright. The forget button — deliberately real, not a soft flag. */
  forget(id: string): boolean {
    const info = this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id)
    this.db.prepare(`DELETE FROM memory_fts WHERE id = ?`).run(id)
    return info.changes > 0
  }

  stats(): { total: number; byKind: Record<string, number> } {
    const rows = this.db.prepare(
      `SELECT kind, COUNT(*) AS n FROM memories WHERE superseded_by IS NULL GROUP BY kind`,
    ).all() as { kind: string; n: number }[]
    const byKind: Record<string, number> = {}
    let total = 0
    for (const r of rows) { byKind[r.kind] = r.n; total += r.n }
    return { total, byKind }
  }
}
