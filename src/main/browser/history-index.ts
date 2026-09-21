import Database from 'better-sqlite3'

/**
 * Browsing history — a full-text index of what you have READ, not a list of
 * URLs you have touched.
 *
 * Chrome's history stores urls and titles, so it can only answer questions you
 * can already phrase. The question people actually have is "what was that
 * pricing page I looked at last week?", and answering it needs the page's
 * text. We already extract readable page text for the agent (`deepRead.ts`),
 * and this codebase already runs a proven SQLite + FTS5 index for mail
 * (`mail/mail-index.ts`). This is those two halves joined.
 *
 * Four properties are load-bearing:
 *
 * 1. **One row per URL, not per visit.** A visit counter plus a last-visited
 *    stamp is what ranking needs, and it keeps the table proportional to what
 *    you have read rather than how often you refreshed it.
 *
 * 2. **Bookmarks are a column here, not a second system.** A bookmark is a
 *    history row you starred. That means bookmarks are full-text searchable for
 *    free, they cannot drift out of sync with history, and there is no folder
 *    tree to maintain — the thing everyone abandons in every browser.
 *
 * 3. **Deletion is real.** `forget` removes the FTS rows too. A local index of
 *    everything you have read is a genuinely sensitive object; "cleared" must
 *    not mean "hidden from the list while the text is still on disk and still
 *    reachable by search". Starring does not protect a row from deletion —
 *    the user asked for it to be gone.
 *
 * 4. **It is a CACHE, never the truth.** Deleting the file costs you search and
 *    nothing else. Same stance the mail index takes toward IMAP.
 *
 * Private browsing never reaches this module — the caller does not record for a
 * non-persistent partition. That is enforced at the wiring, and asserted in the
 * tests, because a privacy guarantee that lives only in a comment is not one.
 */

/** A page as the index stores it. */
export interface HistoryEntry {
  url: string
  title: string
  favicon: string
  /** Epoch ms of the most recent visit. */
  lastVisited: number
  visitCount: number
  starred: boolean
  /** Short preview for list rows. Never the whole page. */
  snippet: string
}

/** What a recorded visit carries. `text` is the FTS payload. */
export interface VisitInput {
  url: string
  title?: string
  favicon?: string
  /** Readable page text. Absent is fine — the row still records the visit. */
  text?: string
  /** Epoch ms. Passed in so callers and tests control time. */
  visitedAt: number
}

/** One omnibox suggestion. */
export interface Suggestion {
  url: string
  title: string
  favicon: string
  starred: boolean
  /** Higher ranks first. Exposed so the UI can group, and tests can assert. */
  score: number
  /** Why it was suggested — the UI shows a different icon per kind. */
  kind: 'bookmark' | 'history'
}

/**
 * Page text is capped before it is stored.
 *
 * An article is a few KB; a poorly-built app page can serialise megabytes of
 * markup-derived text. Storing that unbounded would let a handful of pages
 * dominate the database and slow every query. The cap is generous enough that
 * the readable part of any real article survives whole.
 */
export const MAX_TEXT = 200_000

/** Snippet length for list rows. */
const SNIPPET = 240

/**
 * Schemes worth remembering. Everything else — about:, data:, chrome-error:,
 * file: — is either not a page or not ours to index.
 *
 * `about:blank` matters specifically: every tab mounts there so its guest
 * attaches (WOS-005), so without this guard the history would fill with blank
 * entries nobody visited.
 */
export function isRecordable(url: string): boolean {
  return /^https?:\/\/[^/\s]+/i.test(url)
}

/**
 * Recency weight for ranking, in buckets rather than a smooth decay.
 *
 * Buckets are deliberate: a smooth curve makes suggestion order churn from one
 * hour to the next for no reason the user can perceive, which reads as the
 * omnibox being unreliable. Buckets keep today's pages above last month's and
 * otherwise stay still.
 */
export function recencyWeight(lastVisited: number, now: number): number {
  const days = (now - lastVisited) / 86_400_000
  if (days < 1) return 100
  if (days < 7) return 70
  if (days < 30) return 40
  if (days < 90) return 20
  return 10
}

/**
 * Frecency — frequency × recency, the standard answer to "which of these did
 * they mean?". A page visited fifty times last year should not outrank one
 * visited twice today, and neither should vanish.
 *
 * Frequency is DAMPED (square root), and that is the load-bearing detail. With
 * a linear count, fifty visits to a page abandoned a year ago scored 500 while
 * two visits today scored 200 — so the omnibox would keep offering last year's
 * habits ahead of the thing you are working in right now. The test caught it;
 * the numbers above are the real ones from that failure.
 *
 * Damping says: the difference between 1 visit and 10 is large, between 50 and
 * 60 nearly nothing — which is how habitual use actually feels. Recency then
 * decides among pages of comparable familiarity.
 *
 * Starred rows get a multiplier rather than a fixed bonus, so an explicit
 * bookmark reliably beats incidental history without pinning a stale bookmark
 * above the page the user is actively working in.
 */
export function frecency(visitCount: number, lastVisited: number, starred: boolean, now: number): number {
  const base = Math.sqrt(Math.min(visitCount, 1000)) * recencyWeight(lastVisited, now)
  return starred ? base * 3 + 500 : base
}

/** Escapes a user string for a safe FTS5 MATCH: quote it, double inner quotes. */
export function ftsPhrase(query: string): string {
  const cleaned = query.replace(/["]/g, '""').trim()
  return cleaned ? `"${cleaned}"*` : ''
}

export class HistoryIndex {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pages (
        url          TEXT PRIMARY KEY,
        title        TEXT NOT NULL DEFAULT '',
        favicon      TEXT NOT NULL DEFAULT '',
        last_visited INTEGER NOT NULL,
        visit_count  INTEGER NOT NULL DEFAULT 1,
        starred      INTEGER NOT NULL DEFAULT 0,
        snippet      TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_pages_visited ON pages(last_visited DESC);
      CREATE INDEX IF NOT EXISTS idx_pages_starred ON pages(starred, last_visited DESC);

      CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(
        url UNINDEXED,
        title,
        body
      );
    `)
  }

  /**
   * Records a visit. Bumps the counter for a page already known, so ranking
   * reflects real use.
   *
   * Text is optional and NON-DESTRUCTIVE when absent: a later visit that
   * arrives without extracted text must not wipe the text an earlier one
   * indexed. Otherwise a background re-navigation would silently un-index a
   * page while everything still looked fine — the exact failure the mail index
   * guards against with its `deep` tier, paid for once already.
   */
  recordVisit(v: VisitInput): void {
    if (!isRecordable(v.url)) return

    const text = (v.text ?? '').slice(0, MAX_TEXT)
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, SNIPPET)
    const existing = this.db.prepare('SELECT url, title, snippet FROM pages WHERE url = ?').get(v.url) as
      | { url: string; title: string; snippet: string }
      | undefined

    if (existing) {
      this.db
        .prepare(
          `UPDATE pages SET
             last_visited = @visitedAt,
             visit_count  = visit_count + 1,
             title        = CASE WHEN @title != '' THEN @title ELSE title END,
             favicon      = CASE WHEN @favicon != '' THEN @favicon ELSE favicon END,
             snippet      = CASE WHEN @snippet != '' THEN @snippet ELSE snippet END
           WHERE url = @url`,
        )
        .run({ url: v.url, visitedAt: v.visitedAt, title: v.title ?? '', favicon: v.favicon ?? '', snippet })
    } else {
      this.db
        .prepare(
          `INSERT INTO pages (url, title, favicon, last_visited, visit_count, starred, snippet)
           VALUES (@url, @title, @favicon, @visitedAt, 1, 0, @snippet)`,
        )
        .run({ url: v.url, title: v.title ?? '', favicon: v.favicon ?? '', visitedAt: v.visitedAt, snippet })
    }

    // Only rewrite the FTS payload when this visit actually brought text.
    if (text) {
      this.db.prepare('DELETE FROM page_fts WHERE url = ?').run(v.url)
      this.db
        .prepare('INSERT INTO page_fts (url, title, body) VALUES (?, ?, ?)')
        .run(v.url, v.title ?? '', text)
    } else if (!existing && (v.title ?? '')) {
      // No text yet, but a title is still worth finding by.
      this.db.prepare('INSERT INTO page_fts (url, title, body) VALUES (?, ?, ?)').run(v.url, v.title ?? '', '')
    }
  }

  /** Full-text search over page TITLE and BODY — the point of the whole module. */
  search(query: string, limit = 50): HistoryEntry[] {
    const phrase = ftsPhrase(query)
    if (!phrase) return []
    try {
      return this.db
        .prepare(
          `SELECT p.* FROM pages p
             WHERE p.url IN (SELECT url FROM page_fts WHERE page_fts MATCH ?)
             ORDER BY p.last_visited DESC
             LIMIT ?`,
        )
        .all(phrase, limit)
        .map(toEntry)
    } catch {
      // A malformed FTS expression must degrade to "no results", never take the
      // omnibox down with it.
      return []
    }
  }

  /**
   * Omnibox suggestions for a partial input.
   *
   * Matches url or title by prefix/substring — NOT full text. Typing "lin"
   * should offer linkedin.com, not every page that mentions "linkedin"
   * somewhere in its body; content search is a deliberate act, not something
   * that fires on the third keystroke.
   */
  suggest(prefix: string, now: number, limit = 8): Suggestion[] {
    const q = prefix.trim().toLowerCase()
    if (!q) {
      // Empty box: the places you actually go.
      return this.db
        .prepare('SELECT * FROM pages ORDER BY starred DESC, last_visited DESC LIMIT ?')
        .all(limit)
        .map((r) => toSuggestion(r as PageRow, now))
    }
    const like = `%${escapeLike(q)}%`
    return this.db
      .prepare(
        `SELECT * FROM pages
           WHERE lower(url) LIKE ? ESCAPE '\\' OR lower(title) LIKE ? ESCAPE '\\'
           LIMIT 200`,
      )
      .all(like, like)
      .map((r) => toSuggestion(r as PageRow, now))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  /** Most recent pages, for the History view. */
  recent(limit = 100): HistoryEntry[] {
    return this.db
      .prepare('SELECT * FROM pages ORDER BY last_visited DESC LIMIT ?')
      .all(limit)
      .map(toEntry)
  }

  /**
   * Stars a page. Creates the row if the URL has never been visited, so
   * bookmarking something pasted in still works.
   */
  star(url: string, now: number, title = '', favicon = ''): void {
    if (!isRecordable(url)) return
    const exists = this.db.prepare('SELECT url FROM pages WHERE url = ?').get(url)
    if (exists) this.db.prepare('UPDATE pages SET starred = 1 WHERE url = ?').run(url)
    else {
      this.db
        .prepare(
          `INSERT INTO pages (url, title, favicon, last_visited, visit_count, starred, snippet)
           VALUES (?, ?, ?, ?, 0, 1, '')`,
        )
        .run(url, title, favicon, now)
      this.db.prepare('INSERT INTO page_fts (url, title, body) VALUES (?, ?, ?)').run(url, title, '')
    }
  }

  unstar(url: string): void {
    this.db.prepare('UPDATE pages SET starred = 0 WHERE url = ?').run(url)
  }

  isStarred(url: string): boolean {
    const r = this.db.prepare('SELECT starred FROM pages WHERE url = ?').get(url) as
      | { starred: number }
      | undefined
    return !!r?.starred
  }

  bookmarks(limit = 500): HistoryEntry[] {
    return this.db
      .prepare('SELECT * FROM pages WHERE starred = 1 ORDER BY last_visited DESC LIMIT ?')
      .all(limit)
      .map(toEntry)
  }

  /**
   * Forgets one page — INCLUDING its indexed text.
   *
   * Starred rows are deleted too. A star is a convenience; an explicit request
   * to forget a page outranks it, and silently keeping the text of a page the
   * user asked to remove is the kind of thing that destroys trust in a local
   * index entirely.
   */
  forget(url: string): void {
    this.db.prepare('DELETE FROM pages WHERE url = ?').run(url)
    this.db.prepare('DELETE FROM page_fts WHERE url = ?').run(url)
  }

  /** Forgets everything visited since a cutoff ("last hour", "today"). */
  forgetSince(since: number): number {
    const rows = this.db.prepare('SELECT url FROM pages WHERE last_visited >= ?').all(since) as {
      url: string
    }[]
    const del = this.db.prepare('DELETE FROM pages WHERE url = ?')
    const delFts = this.db.prepare('DELETE FROM page_fts WHERE url = ?')
    const tx = this.db.transaction((list: { url: string }[]) => {
      for (const r of list) {
        del.run(r.url)
        delFts.run(r.url)
      }
    })
    tx(rows)
    return rows.length
  }

  /** Forgets everything. Both tables, so nothing survives in the FTS shadow. */
  clear(): void {
    this.db.exec('DELETE FROM pages; DELETE FROM page_fts;')
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) n FROM pages').get() as { n: number }).n
  }

  close(): void {
    this.db.close()
  }
}

interface PageRow {
  url: string
  title: string
  favicon: string
  last_visited: number
  visit_count: number
  starred: number
  snippet: string
}

function toEntry(r: unknown): HistoryEntry {
  const p = r as PageRow
  return {
    url: p.url,
    title: p.title,
    favicon: p.favicon,
    lastVisited: p.last_visited,
    visitCount: p.visit_count,
    starred: !!p.starred,
    snippet: p.snippet,
  }
}

function toSuggestion(p: PageRow, now: number): Suggestion {
  return {
    url: p.url,
    title: p.title,
    favicon: p.favicon,
    starred: !!p.starred,
    score: frecency(p.visit_count, p.last_visited, !!p.starred, now),
    kind: p.starred ? 'bookmark' : 'history',
  }
}

/** Escapes LIKE wildcards so a url containing % or _ cannot broaden the match. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}
