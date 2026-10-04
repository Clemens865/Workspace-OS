import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { askTerms, stem } from '../search/terms'

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
  /**
   * Who wrote it. The person's own memories count as confirmed; an agent's wait
   * for the person to keep, correct or forget them (they are still recalled,
   * marked as unconfirmed). Defaults to 'agent', the cautious side.
   */
  author?: MemoryAuthor
}

export type MemoryAuthor = 'you' | 'agent'

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
  /** Who wrote it. */
  author: MemoryAuthor
  /** The person wrote it, or kept it when an agent proposed it. */
  confirmed: boolean
  /** When it stopped being true (a correction replaced it); null while current. */
  endedAt: number | null
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
 * would surface as "search is broken". Only the meaningful words count (a
 * question's "what" and "the" would otherwise match every memory), each as a
 * quoted stem prefix, OR-ed so a question behaves like a search box rather than
 * requiring every word.
 */
export function toMatchQuery(raw: string): string | null {
  const useful = askTerms(raw)
  if (useful.length === 0) return null
  // A two-letter word ("wi" of Wi-Fi) as a prefix would match half the language.
  return [...new Set(useful.map(stem))].map((t) => (t.length < 3 ? `"${t}"` : `"${t}"*`)).join(' OR ')
}

/**
 * How close to the best match a hit must come to be recalled at all. A memory
 * sharing one passing word with the question is noise in an agent's
 * instructions, not help.
 */
export const RELEVANCE_CUTOFF = 0.15

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
    this.migrate()
  }

  /** Who wrote a memory, whether the person confirmed it, and when it was replaced. */
  private migrate(): void {
    const cols = new Set((this.db.prepare('PRAGMA table_info(memories)').all() as { name: string }[]).map((c) => c.name))
    if (!cols.has('author')) {
      this.db.exec(`ALTER TABLE memories ADD COLUMN author TEXT NOT NULL DEFAULT 'agent'`)
      this.db.exec(`UPDATE memories SET author = 'you' WHERE source = 'you told me'`)
    }
    // Memories from before confirmation existed stay as they were: in use, nobody asked.
    if (!cols.has('confirmed')) this.db.exec(`ALTER TABLE memories ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 1`)
    if (!cols.has('ended_at')) this.db.exec(`ALTER TABLE memories ADD COLUMN ended_at INTEGER`)
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
      author: r.author === 'you' ? 'you' : 'agent',
      confirmed: r.confirmed !== 0,
      endedAt: (r.ended_at as number) ?? null,
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
    const author: MemoryAuthor = input.author === 'you' ? 'you' : 'agent'
    if (dup) {
      // The person saying it again is the person confirming it.
      this.db.prepare(`UPDATE memories SET reinforced = reinforced + 1, updated_at = ?, source = ?, confirmed = MAX(confirmed, ?) WHERE id = ?`)
        .run(now, input.source, author === 'you' ? 1 : 0, dup.id)
      return this.get(dup.id as string)!
    }

    const id = crypto.randomUUID()
    const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean).join(TAG_SEP)
    this.insert({ id, kind: input.kind, text, source: input.source, scope, tags, author, now })
    return this.get(id)!
  }

  private insert(r: { id: string; kind: MemoryKind; text: string; source: string; scope: MemoryScope; tags: string; author: MemoryAuthor; now: number }): void {
    this.db.prepare(
      `INSERT INTO memories (id, kind, text, source, scope, tags, created_at, updated_at, reinforced, author, confirmed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(r.id, r.kind, r.text, r.source, r.scope, r.tags, r.now, r.now, r.author, r.author === 'you' ? 1 : 0)
    this.db.prepare(`INSERT INTO memory_fts (id, text, tags) VALUES (?, ?, ?)`).run(r.id, r.text, r.tags.split(TAG_SEP).join(' '))
  }

  get(id: string): Memory | null {
    const r = this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as Record<string, unknown> | undefined
    return r ? this.row2mem(r) : null
  }

  /** Every live memory, newest first. Superseded ones are excluded. */
  list(opts: { kind?: MemoryKind; limit?: number; unconfirmed?: boolean } = {}): Memory[] {
    const rows = this.db.prepare(
      `SELECT * FROM memories WHERE superseded_by IS NULL ${opts.kind ? 'AND kind = ?' : ''} ${opts.unconfirmed ? 'AND confirmed = 0' : ''}
       ORDER BY updated_at DESC LIMIT ?`,
    ).all(...(opts.kind ? [opts.kind, opts.limit ?? 200] : [opts.limit ?? 200])) as Record<string, unknown>[]
    return rows.map((r) => this.row2mem(r))
  }

  /**
   * The person's standing preferences: the ones they wrote or kept, most
   * repeated first. These go into every run, whatever its words.
   */
  preferences(limit = 8): Memory[] {
    const rows = this.db.prepare(
      `SELECT * FROM memories WHERE superseded_by IS NULL AND kind = 'preference' AND confirmed = 1
       ORDER BY reinforced DESC, updated_at DESC LIMIT ?`,
    ).all(limit) as Record<string, unknown>[]
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
    if (!toMatchQuery(query)) {
      const now = Date.now()
      return this.list({ limit }).sort((a, b) => score(b, 0, now) - score(a, 0, now)).slice(0, limit)
    }
    return this.scored(query, limit).map((x) => x.m)
  }

  /**
   * Only the memories that match the query, each with its score, so results
   * from two stores can be merged by how well they fit. Nothing matching means
   * nothing: an unrelated task gets no memories pushed at it.
   */
  scored(query: string, limit = 10): { m: Memory; s: number }[] {
    const match = toMatchQuery(query)
    if (!match) return []
    const now = Date.now()
    let hits: { id: string; rank: number }[]
    try {
      hits = this.db.prepare(
        `SELECT id, bm25(memory_fts) AS rank FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?`,
      ).all(match, limit * 4) as { id: string; rank: number }[]
    } catch {
      // A malformed MATCH must degrade to "no lexical hits", never crash the
      // surface that asked.
      return []
    }
    const out: { m: Memory; s: number }[] = []
    const best = hits.length ? -hits[0].rank : 0
    for (const h of hits) {
      if (-h.rank < best * RELEVANCE_CUTOFF) break
      const m = this.get(h.id)
      if (!m || m.supersededBy) continue
      // bm25 returns NEGATIVE numbers, better = more negative.
      out.push({ m, s: score(m, -h.rank, now) })
    }
    return out.sort((a, b) => b.s - a.s).slice(0, limit)
  }

  /**
   * Live memories that say nearly the same thing (most of their words shared),
   * so a writer can see what is already known before adding to it.
   */
  similar(text: string, limit = 3): Memory[] {
    const words = (t: string): Set<string> => new Set(normalize(t).split(' ').filter((w) => w.length > 2))
    const mine = words(text)
    if (!mine.size) return []
    const norm = normalize(text)
    return this.scored(text, 20)
      .map(({ m }) => {
        const theirs = words(m.text)
        const shared = [...mine].filter((w) => theirs.has(w)).length
        return { m, j: shared / (mine.size + theirs.size - shared) }
      })
      .filter((x) => x.j >= 0.4 && normalize(x.m.text) !== norm)
      .sort((a, b) => b.j - a.j)
      .slice(0, limit)
      .map((x) => x.m)
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
   * Correct a memory: the new text becomes the memory, the old one is kept as
   * history with the time it stopped being true. Correction is the common case —
   * facts change — and losing the trail makes it impossible to see why the agent
   * believed something. The person's correction is confirmed; an agent's waits
   * for the person, like anything an agent writes. The same text again is no
   * correction (the person saying it confirms it).
   */
  correct(id: string, text: string, author: MemoryAuthor = 'you', source?: string): Memory | null {
    const old = this.get(id)
    if (!old || old.supersededBy) return null
    const next = text.trim()
    if (!next) throw new Error('A memory needs text')
    if (normalize(next) === normalize(old.text)) {
      if (author === 'you') this.confirm(id)
      return this.get(id)
    }
    const now = Date.now()
    // Already known as said now (two old memories corrected to the same fact):
    // the old one folds into it rather than making a twin.
    const same = (this.db.prepare(`SELECT * FROM memories WHERE kind = ? AND superseded_by IS NULL AND id != ?`).all(old.kind, id) as Record<string, unknown>[])
      .find((r) => normalize(String(r.text)) === normalize(next))
    if (same) {
      const tx = this.db.transaction(() => {
        this.db.prepare(`UPDATE memories SET superseded_by = ?, ended_at = ?, updated_at = ? WHERE id = ?`).run(same.id, now, now, id)
        this.db.prepare(`DELETE FROM memory_fts WHERE id = ?`).run(id)
        this.db.prepare(`UPDATE memories SET reinforced = reinforced + 1, updated_at = ?, confirmed = MAX(confirmed, ?) WHERE id = ?`).run(now, author === 'you' ? 1 : 0, same.id)
      })
      tx()
      return this.get(same.id as string)
    }
    const nid = crypto.randomUUID()
    const tx = this.db.transaction(() => {
      this.insert({
        id: nid,
        kind: old.kind,
        text: next,
        source: source?.trim() || (author === 'you' ? 'you corrected it' : 'an agent corrected it'),
        scope: old.scope,
        tags: old.tags.join(TAG_SEP),
        author,
        now,
      })
      this.db.prepare(`UPDATE memories SET superseded_by = ?, ended_at = ?, updated_at = ? WHERE id = ?`).run(nid, now, now, id)
      this.db.prepare(`DELETE FROM memory_fts WHERE id = ?`).run(id)
    })
    tx()
    return this.get(nid)
  }

  /** Replace a memory with another (kept for callers that pass a full input). */
  supersede(id: string, next: MemoryInput): Memory | null {
    return this.correct(id, next.text, next.author ?? 'agent', next.source)
  }

  /**
   * What a memory said before, newest first: every earlier version it replaced,
   * including ones that were folded into it.
   */
  history(id: string): Memory[] {
    const out: Memory[] = []
    const seen = new Set([id])
    let frontier = [id]
    const stmt = this.db.prepare(`SELECT * FROM memories WHERE superseded_by = ?`)
    while (frontier.length && out.length < 50) {
      const next: string[] = []
      for (const at of frontier) {
        for (const r of stmt.all(at) as Record<string, unknown>[]) {
          const m = this.row2mem(r)
          if (seen.has(m.id)) continue
          seen.add(m.id)
          out.push(m)
          next.push(m.id)
        }
      }
      frontier = next
    }
    return out.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0) || b.createdAt - a.createdAt)
  }

  /** The person keeps a memory an agent proposed. */
  confirm(id: string): boolean {
    return this.db.prepare(`UPDATE memories SET confirmed = 1 WHERE id = ?`).run(id).changes > 0
  }

  /** Delete outright. The forget button — deliberately real, not a soft flag. */
  forget(id: string): boolean {
    // Its earlier versions go with it: forgetting something means all of it.
    const ids = [id, ...this.history(id).map((m) => m.id)]
    let changed = 0
    for (const x of ids) {
      changed += this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(x).changes
      this.db.prepare(`DELETE FROM memory_fts WHERE id = ?`).run(x)
    }
    return changed > 0
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
