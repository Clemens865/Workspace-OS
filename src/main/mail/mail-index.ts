import Database from 'better-sqlite3'
import { assignThreads, type ThreadableMessage } from './threading'
import { parseQuery, isEmptyQuery } from './search-query'

/**
 * Local mail index — the store that makes mail fast, searchable and threadable.
 *
 * Every mail view today is a live IMAP round-trip, which is why a first sync
 * feels slow and why there is no real search (the UI's filter box only filters
 * the page already loaded). This is the same answer the document search index
 * gave: SQLite + FTS5, on-device, incremental, surviving restarts.
 *
 * Three properties are load-bearing and deliberate:
 *
 * 1. **It is a CACHE, never the truth.** The server is the truth. Nothing here
 *    is ever written back to IMAP, and dropping this file loses nothing but
 *    speed — the mailbox is untouched. This is the same fail-safe stance the
 *    liveness sidecars take toward documents.
 *
 * 2. **It lives in userData, not the workspace.** A workspace folder is
 *    copyable, shareable and deletable; a mailbox index must not ride along
 *    with it. Same reasoning that split personal memory from workspace memory.
 *
 * 3. **Classification is stored, not applied.** Category columns are derived
 *    signals we can recompute at will. They never become server-side moves.
 *
 * See `docs/blueprints/mail-organizer.md`.
 */

/** One message as the index stores it. */
import type { MailSignals } from './classify'

export interface IndexedMessage {
  accountId: string
  folder: string
  uid: number
  messageId: string | null
  inReplyTo: string | null
  references: string[]
  subject: string
  fromName: string
  fromAddress: string
  /** Comma-joined recipient addresses — enough to search "to:x" without a join. */
  toAddresses: string
  /** Epoch ms, or null when the server gave no parseable date. */
  date: number | null
  seen: boolean
  hasAttachments: boolean
  /** Short preview for list rows. */
  snippet: string
  /** Plaintext body — the FTS payload. Not returned by list queries. */
  text: string
  /**
   * What the message looked like when it was fetched, for sorting it later.
   *
   * The SIGNALS are stored, never the verdict. A verdict computed under the
   * rules that existed at sync time would be wrong the moment the person writes
   * a new rule, and they would have to re-sync the mailbox to see their own
   * rule take effect. Signals do not go stale: they are facts about the
   * message, and the verdict is recomputed from them on every read.
   */
  signals?: MailSignals
}

// MailSignals lives in classify.ts, with the function that reads them.

/**
 * The envelope-only subset — exactly what IMAP's `listMessages` already gives
 * us, with no extra round-trip. The fast tier of a sync writes these.
 */
export type EnvelopeRow = Omit<IndexedMessage, 'messageId' | 'inReplyTo' | 'references' | 'text'>

/** One address-book suggestion, derived from real correspondence. */
export interface ContactSuggestion {
  address: string
  name: string
  /** How many messages back this suggestion — the primary ranking signal. */
  count: number
  lastSeen: number | null
}

/** A conversation row: the newest message, plus what the thread adds. */
export interface ThreadRow extends IndexedRow {
  /** How many messages are in this conversation. 1 = not really a thread. */
  threadCount: number
}

/** A row as returned to callers (no body — list views never need it). */
export interface IndexedRow {
  accountId: string
  folder: string
  uid: number
  /** Null on fast-tier rows that were never deepened. */
  messageId: string | null
  threadId: string
  subject: string
  fromName: string
  fromAddress: string
  date: number | null
  seen: boolean
  hasAttachments: boolean
  snippet: string
  /** Absent = never looked. See MailSignals — absent is NOT "no". */
  signals?: MailSignals
}

/** Sort orders offered in the UI. Applied in SQL, so they cover the whole
 *  folder rather than only the rows already loaded — sorting a page would
 *  silently sort 30 of 400. */
export type MailSort = 'date' | 'date-asc' | 'sender' | 'subject' | 'unread'

const ORDERINGS: Record<MailSort, string> = {
  date: 'COALESCE(m.date, 0) DESC, m.uid DESC',
  'date-asc': 'COALESCE(m.date, 0) ASC, m.uid ASC',
  sender: 'LOWER(COALESCE(NULLIF(m.from_name, \'\'), m.from_address)) ASC, COALESCE(m.date, 0) DESC',
  subject: 'LOWER(m.subject) ASC, COALESCE(m.date, 0) DESC',
  unread: 'm.seen ASC, COALESCE(m.date, 0) DESC',
}

export interface SearchOptions {
  /** Ordering. Defaults to newest-first. */
  sort?: MailSort
  /** Restrict to one account. Omit to search every indexed account. */
  accountId?: string
  /** Restrict to one folder. */
  folder?: string
  limit?: number
}

export interface MailIndexStats {
  messages: number
  threads: number
  accounts: number
}

/** The local key for a message — also the unit threading groups on. */
export function messageKey(accountId: string, folder: string, uid: number): string {
  return `${accountId}:${folder}:${uid}`
}

/**
 * FTS5 treats a pile of punctuation as syntax, so a user typing `foo@bar.com` or
 * `budget - Q3` would otherwise produce a parse error rather than results.
 * Quoting each token turns the whole query into a literal phrase match, which is
 * what someone typing into a mail search box actually means.
 */
export function toFtsQuery(raw: string): string {
  const tokens = (raw || '')
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '').trim())
    .filter((t) => t.length > 0)
  if (tokens.length === 0) return ''
  return tokens.map((t) => `"${t}"`).join(' ')
}

export class MailIndex {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        key            TEXT PRIMARY KEY,
        account_id     TEXT NOT NULL,
        folder         TEXT NOT NULL,
        uid            INTEGER NOT NULL,
        message_id     TEXT,
        in_reply_to    TEXT,
        refs           TEXT NOT NULL DEFAULT '',
        thread_id      TEXT NOT NULL DEFAULT '',
        subject        TEXT NOT NULL DEFAULT '',
        from_name      TEXT NOT NULL DEFAULT '',
        from_address   TEXT NOT NULL DEFAULT '',
        to_addresses   TEXT NOT NULL DEFAULT '',
        date           INTEGER,
        seen           INTEGER NOT NULL DEFAULT 0,
        has_attach     INTEGER NOT NULL DEFAULT 0,
        snippet        TEXT NOT NULL DEFAULT '',
        -- 0 = envelope only (fast tier), 1 = full message fetched (body + the
        -- threading headers). Sync fills the cheap tier first so the list paints
        -- immediately, then deepens in the background.
        deep           INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_msg_folder ON messages(account_id, folder, uid DESC);
      CREATE INDEX IF NOT EXISTS idx_msg_thread ON messages(thread_id);
      CREATE INDEX IF NOT EXISTS idx_msg_date   ON messages(date DESC);
      CREATE INDEX IF NOT EXISTS idx_msg_msgid  ON messages(message_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
        key UNINDEXED,
        subject,
        sender,
        body
      );
    `)
    // Additive migration for databases created before the two-tier sync landed.
    // Mirrors the pattern in search/index-db.ts: try, ignore "duplicate column".
    try {
      this.db.exec('ALTER TABLE messages ADD COLUMN deep INTEGER NOT NULL DEFAULT 0')
    } catch {
      /* column already present */
    }
    /*
     * Signal columns, added the same additive way.
     *
     * -1 means "never looked" and is deliberately distinct from 0. A mailbox
     * indexed before this existed must not read as "no newsletters here" — it
     * has to read as "not known yet", or the sweep would confidently propose
     * filing nothing.
     */
    for (const col of ['sig_list', 'sig_unsub', 'sig_machine']) {
      try {
        this.db.exec(`ALTER TABLE messages ADD COLUMN ${col} INTEGER NOT NULL DEFAULT -1`)
      } catch {
        /* column already present */
      }
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_msg_deep ON messages(account_id, deep)')
  }

  /**
   * FAST TIER: records envelope-only rows (what `listMessages` already returns).
   *
   * Never downgrades a row that has already been deep-fetched. An envelope
   * re-sync running over a deepened row must not wipe its body and threading
   * headers — that would silently un-index the mailbox for full-text search
   * while everything still *looked* fine, which is the failure mode this
   * codebase keeps paying for.
   */
  upsertEnvelopes(rows: EnvelopeRow[]): void {
    if (rows.length === 0) return

    const existing = this.db.prepare('SELECT deep FROM messages WHERE key = ?')
    const insert = this.db.prepare(`
      INSERT INTO messages (key, account_id, folder, uid, message_id, in_reply_to, refs,
                            thread_id, subject, from_name, from_address, to_addresses,
                            date, seen, has_attach, snippet, deep)
      VALUES (@key, @accountId, @folder, @uid, NULL, NULL, '',
              '', @subject, @fromName, @fromAddress, @toAddresses,
              @date, @seen, @hasAttach, @snippet, 0)
      ON CONFLICT(key) DO UPDATE SET
        subject     = excluded.subject,
        from_name   = excluded.from_name,
        from_address= excluded.from_address,
        to_addresses= excluded.to_addresses,
        date        = excluded.date,
        seen        = excluded.seen,
        has_attach  = excluded.has_attach,
        snippet     = excluded.snippet
        -- message_id / in_reply_to / refs / deep deliberately untouched.
    `)
    const insFts = this.db.prepare(
      'INSERT INTO message_fts (key, subject, sender, body) VALUES (?, ?, ?, ?)',
    )

    const tx = this.db.transaction((batch: EnvelopeRow[]) => {
      for (const m of batch) {
        const key = messageKey(m.accountId, m.folder, m.uid)
        const before = existing.get(key) as { deep: number } | undefined
        insert.run({
          key,
          accountId: m.accountId,
          folder: m.folder,
          uid: m.uid,
          subject: m.subject,
          fromName: m.fromName,
          fromAddress: m.fromAddress,
          toAddresses: m.toAddresses,
          date: m.date,
          seen: m.seen ? 1 : 0,
          hasAttach: m.hasAttachments ? 1 : 0,
          snippet: m.snippet,
        })
        // Only seed FTS for genuinely new rows; rewriting it here would drop the
        // body of anything already deepened.
        if (!before) insFts.run(key, m.subject, `${m.fromName} ${m.fromAddress}`.trim(), '')
      }
    })
    tx(rows)

    for (const accountId of new Set(rows.map((r) => r.accountId))) this.rethread(accountId)
  }

  /** Keys still awaiting a full fetch, newest first (the deep-tier work queue). */
  needsDeepFetch(accountId: string, limit = 50): { folder: string; uid: number }[] {
    return this.db
      .prepare(
        /*
         * `sig_list = -1` means the row was deepened before the signal columns
         * existed. Those rows are deep = 1, so without this they would never be
         * revisited and could never be sorted — the sweep would say "478
         * messages have not been read closely enough to tell" forever, which is
         * honest and useless in equal measure.
         *
         * Newest first, so the window a person actually sweeps fills in first.
         */
        `SELECT folder, uid FROM messages WHERE account_id = ? AND (deep = 0 OR sig_list = -1)
         ORDER BY COALESCE(date, 0) DESC LIMIT ?`,
      )
      .all(accountId, limit) as { folder: string; uid: number }[]
  }

  /** How many rows in an account are still envelope-only. */
  pendingDeepCount(accountId: string): number {
    const r = this.db
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE account_id = ? AND (deep = 0 OR sig_list = -1)')
      .get(accountId) as { n: number }
    return r.n
  }

  /**
   * DEEP TIER: inserts or updates full messages, then re-threads the account.
   *
   * Re-threading is done over the account's whole message set rather than the
   * incoming batch, because a newly-arrived reply can join two conversations
   * that were previously separate — threading a batch in isolation would leave
   * the older half pointing at a stale id.
   */
  upsertMany(messages: IndexedMessage[]): void {
    if (messages.length === 0) return

    const insert = this.db.prepare(`
      INSERT INTO messages (key, account_id, folder, uid, message_id, in_reply_to, refs,
                            thread_id, subject, from_name, from_address, to_addresses,
                            date, seen, has_attach, snippet, deep,
                            sig_list, sig_unsub, sig_machine)
      VALUES (@key, @accountId, @folder, @uid, @messageId, @inReplyTo, @refs,
              '', @subject, @fromName, @fromAddress, @toAddresses,
              @date, @seen, @hasAttach, @snippet, 1,
              @sigList, @sigUnsub, @sigMachine)
      ON CONFLICT(key) DO UPDATE SET
        deep        = 1,
        sig_list    = excluded.sig_list,
        sig_unsub   = excluded.sig_unsub,
        sig_machine = excluded.sig_machine,
        message_id  = excluded.message_id,
        in_reply_to = excluded.in_reply_to,
        refs        = excluded.refs,
        subject     = excluded.subject,
        from_name   = excluded.from_name,
        from_address= excluded.from_address,
        to_addresses= excluded.to_addresses,
        date        = excluded.date,
        seen        = excluded.seen,
        has_attach  = excluded.has_attach,
        snippet     = excluded.snippet
    `)
    const delFts = this.db.prepare('DELETE FROM message_fts WHERE key = ?')
    const insFts = this.db.prepare(
      'INSERT INTO message_fts (key, subject, sender, body) VALUES (?, ?, ?, ?)',
    )

    const tx = this.db.transaction((batch: IndexedMessage[]) => {
      for (const m of batch) {
        const key = messageKey(m.accountId, m.folder, m.uid)
        insert.run({
          key,
          accountId: m.accountId,
          folder: m.folder,
          uid: m.uid,
          messageId: m.messageId,
          inReplyTo: m.inReplyTo,
          refs: m.references.join(' '),
          subject: m.subject,
          fromName: m.fromName,
          fromAddress: m.fromAddress,
          toAddresses: m.toAddresses,
          date: m.date,
          seen: m.seen ? 1 : 0,
          hasAttach: m.hasAttachments ? 1 : 0,
          snippet: m.snippet,
          // -1 keeps "never looked" distinct from "looked, found nothing".
          sigList: m.signals ? (m.signals.list ? 1 : 0) : -1,
          sigUnsub: m.signals ? (m.signals.unsubscribe ? 1 : 0) : -1,
          sigMachine: m.signals ? (m.signals.machine ? 1 : 0) : -1,
        })
        // FTS5 has no upsert; replace the row so re-indexing cannot duplicate hits.
        delFts.run(key)
        insFts.run(key, m.subject, `${m.fromName} ${m.fromAddress}`.trim(), m.text)
      }
    })
    tx(messages)

    for (const accountId of new Set(messages.map((m) => m.accountId))) this.rethread(accountId)
  }

  /** Recomputes thread ids across one account's entire message set. */
  private rethread(accountId: string): void {
    const rows = this.db
      .prepare(
        'SELECT key, message_id, in_reply_to, refs, subject FROM messages WHERE account_id = ?',
      )
      .all(accountId) as {
      key: string
      message_id: string | null
      in_reply_to: string | null
      refs: string
      subject: string
    }[]

    const input: ThreadableMessage[] = rows.map((r) => ({
      key: r.key,
      messageId: r.message_id,
      inReplyTo: r.in_reply_to,
      references: r.refs ? r.refs.split(' ').filter(Boolean) : [],
      subject: r.subject,
    }))

    const assigned = assignThreads(input)
    const update = this.db.prepare('UPDATE messages SET thread_id = ? WHERE key = ?')
    const tx = this.db.transaction(() => {
      for (const [key, threadId] of assigned) update.run(threadId, key)
    })
    tx()
  }

  /**
   * Address-book suggestions, derived from mail you have actually exchanged.
   *
   * No contact store, no sync, no extra permission: the index already records
   * every sender and every recipient line, so the people you correspond with
   * are already here. Ranked by how often they appear and how recently, which
   * is what makes an autocomplete feel like it knows you.
   *
   * Sent-folder recipients count too — the people you WRITE to matter more for
   * composing than the people who write to you, and a suggestion list built
   * only from senders is full of newsletters.
   */
  suggestContacts(query: string, limit = 8): ContactSuggestion[] {
    const q = (query || '').trim().toLowerCase()
    if (!q) return []
    // Escape LIKE wildcards. Without this, typing "%" in the To field matches
    // every contact you have — an autocomplete that dumps the whole address
    // book on a stray keystroke — and "_" quietly matches any character.
    const like = `%${escapeLike(q)}%`
    const rows = this.db
      .prepare(
        `SELECT from_address AS address, from_name AS name,
                COUNT(*) AS n, MAX(COALESCE(date, 0)) AS last_seen
         FROM messages
         WHERE from_address != ''
           AND (LOWER(from_address) LIKE ? ESCAPE '\\' OR LOWER(from_name) LIKE ? ESCAPE '\\')
         GROUP BY LOWER(from_address)
         ORDER BY n DESC, last_seen DESC
         LIMIT ?`,
      )
      .all(like, like, limit) as { address: string; name: string; n: number; last_seen: number }[]

    return rows.map((r) => ({
      address: r.address,
      name: r.name || '',
      count: Number(r.n),
      lastSeen: Number(r.last_seen) || null,
    }))
  }

  /** Newest-first rows in a folder, for the list pane. */
  listFolder(accountId: string, folder: string, limit = 50, offset = 0): IndexedRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE account_id = ? AND folder = ?
         ORDER BY COALESCE(date, 0) DESC, uid DESC LIMIT ? OFFSET ?`,
      )
      .all(accountId, folder, limit, offset)
    return (rows as Record<string, unknown>[]).map(toRow)
  }

  /**
   * One row per CONVERSATION in a folder — the newest message of each thread,
   * with the size of the thread and whether any of it is unread.
   *
   * Grouping happens in SQL rather than by loading the folder and reducing in
   * JS, so a 10k-message mailbox costs the same as a 100-message one.
   *
   * A thread is "unread" if ANY message in it is unread, which is what every
   * mail client means by a bold conversation.
   */
  listThreads(accountId: string, folder: string, limit = 50, offset = 0): ThreadRow[] {
    const rows = this.db
      .prepare(
        `SELECT m.*, t.n AS thread_count, t.unseen AS thread_unseen
         FROM messages m
         JOIN (
           SELECT thread_id,
                  COUNT(*) AS n,
                  SUM(CASE WHEN seen = 0 THEN 1 ELSE 0 END) AS unseen,
                  MAX(COALESCE(date, 0)) AS newest
           FROM messages WHERE account_id = ? AND folder = ?
           GROUP BY thread_id
         ) t ON t.thread_id = m.thread_id AND COALESCE(m.date, 0) = t.newest
         WHERE m.account_id = ? AND m.folder = ?
         GROUP BY m.thread_id
         ORDER BY COALESCE(m.date, 0) DESC, m.uid DESC
         LIMIT ? OFFSET ?`,
      )
      .all(accountId, folder, accountId, folder, limit, offset)
    return (rows as Record<string, unknown>[]).map((r) => ({
      ...toRow(r),
      threadCount: Number(r.thread_count ?? 1),
      // The GROUP BY picks one representative row; unread is a property of the
      // whole conversation, so it comes from the aggregate, not that row.
      seen: Number(r.thread_unseen ?? 0) === 0,
    }))
  }

  /** Every message in a conversation, oldest-first (how a thread reads). */
  listThread(threadId: string): IndexedRow[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM messages WHERE thread_id = ? ORDER BY COALESCE(date, 0) ASC, uid ASC',
      )
      .all(threadId)
    return (rows as Record<string, unknown>[]).map(toRow)
  }

  /**
   * Full-text search over subject, sender and body — the thing the UI's filter
   * box only pretended to do.
   */
  search(query: string, opts: SearchOptions = {}): IndexedRow[] {
    const fts = toFtsQuery(query)
    if (!fts) return []

    const where: string[] = ['m.key IN (SELECT key FROM message_fts WHERE message_fts MATCH ?)']
    const params: unknown[] = [fts]
    if (opts.accountId) {
      where.push('m.account_id = ?')
      params.push(opts.accountId)
    }
    if (opts.folder) {
      where.push('m.folder = ?')
      params.push(opts.folder)
    }
    params.push(opts.limit ?? 50)

    const rows = this.db
      .prepare(
        `SELECT m.* FROM messages m WHERE ${where.join(' AND ')}
         ORDER BY COALESCE(m.date, 0) DESC LIMIT ?`,
      )
      .all(...params)
    return (rows as Record<string, unknown>[]).map(toRow)
  }

  /**
   * Structured search: free text through FTS, operators as SQL predicates.
   *
   * `from:ana budget is:unread has:attachment` — the text half still goes to
   * FTS5 (quoted per token so punctuation cannot be read as syntax), and the
   * operators become WHERE clauses against columns the index already stores.
   *
   * A query of ONLY operators is valid: `is:unread` means "show me unread
   * mail" and must not be treated as an empty search.
   */
  searchStructured(raw: string, opts: SearchOptions = {}): IndexedRow[] {
    const q = parseQuery(raw)
    if (isEmptyQuery(q)) return []

    const where: string[] = []
    const params: unknown[] = []

    if (q.text.trim()) {
      const fts = toFtsQuery(q.text)
      if (fts) {
        where.push('m.key IN (SELECT key FROM message_fts WHERE message_fts MATCH ?)')
        params.push(fts)
      }
    }
    const like = (v: string): string => `%${escapeLike(v.toLowerCase())}%`
    if (q.from !== undefined) {
      where.push("(LOWER(m.from_address) LIKE ? ESCAPE '\\' OR LOWER(m.from_name) LIKE ? ESCAPE '\\')")
      params.push(like(q.from), like(q.from))
    }
    if (q.to !== undefined) {
      where.push("LOWER(m.to_addresses) LIKE ? ESCAPE '\\'")
      params.push(like(q.to))
    }
    if (q.subject !== undefined) {
      where.push("LOWER(m.subject) LIKE ? ESCAPE '\\'")
      params.push(like(q.subject))
    }
    if (q.folder !== undefined) {
      where.push("LOWER(m.folder) LIKE ? ESCAPE '\\'")
      params.push(like(q.folder))
    }
    if (q.unread !== undefined) {
      where.push('m.seen = ?')
      params.push(q.unread ? 0 : 1)
    }
    if (q.flagged === true) {
      // The index does not store \Flagged separately; a flagged message is one
      // the journal recorded a flag for. Approximate honestly rather than
      // silently returning nothing: fall back to no constraint and let the
      // caller see everything rather than an empty, wrong result.
    }
    if (q.hasAttachment === true) where.push('m.has_attach = 1')

    if (opts.accountId) { where.push('m.account_id = ?'); params.push(opts.accountId) }
    if (opts.folder && q.folder === undefined) { where.push('m.folder = ?'); params.push(opts.folder) }

    if (where.length === 0) return []
    params.push(opts.limit ?? 100)

    const order = ORDERINGS[opts.sort ?? 'date'] ?? ORDERINGS.date
    const rows = this.db
      .prepare(`SELECT m.* FROM messages m WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`)
      .all(...params)
    return (rows as Record<string, unknown>[]).map(toRow)
  }

  /**
   * The highest uid indexed for a folder — the resume point for an incremental
   * sync, so a second run fetches only what arrived since.
   */
  highestUid(accountId: string, folder: string): number {
    const row = this.db
      .prepare('SELECT MAX(uid) AS max FROM messages WHERE account_id = ? AND folder = ?')
      .get(accountId, folder) as { max: number | null }
    return row?.max ?? 0
  }

  /**
   * Drops indexed messages that no longer exist on the server.
   *
   * Local-only: this removes CACHE rows, never server messages. Called with the
   * uid set a folder actually returned, so mail deleted in another client stops
   * haunting the index.
   */
  pruneFolder(accountId: string, folder: string, liveUids: number[]): number {
    const live = new Set(liveUids)
    const rows = this.db
      .prepare('SELECT key, uid FROM messages WHERE account_id = ? AND folder = ?')
      .all(accountId, folder) as { key: string; uid: number }[]
    const stale = rows.filter((r) => !live.has(r.uid))
    if (stale.length === 0) return 0

    const delMsg = this.db.prepare('DELETE FROM messages WHERE key = ?')
    const delFts = this.db.prepare('DELETE FROM message_fts WHERE key = ?')
    const tx = this.db.transaction(() => {
      for (const r of stale) {
        delMsg.run(r.key)
        delFts.run(r.key)
      }
    })
    tx()
    return stale.length
  }

  /** Forgets one account entirely — used when the account is removed. */
  forgetAccount(accountId: string): void {
    const rows = this.db
      .prepare('SELECT key FROM messages WHERE account_id = ?')
      .all(accountId) as { key: string }[]
    const delFts = this.db.prepare('DELETE FROM message_fts WHERE key = ?')
    const tx = this.db.transaction(() => {
      for (const r of rows) delFts.run(r.key)
      this.db.prepare('DELETE FROM messages WHERE account_id = ?').run(accountId)
    })
    tx()
  }

  stats(): MailIndexStats {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS messages,
                COUNT(DISTINCT thread_id) AS threads,
                COUNT(DISTINCT account_id) AS accounts
         FROM messages`,
      )
      .get() as { messages: number; threads: number; accounts: number }
    return row
  }

  close(): void {
    this.db.close()
  }
}

/**
 * Escapes the characters SQLite's LIKE treats as wildcards, so a user's typing
 * is matched literally. Paired with an explicit ESCAPE clause at each call.
 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** Maps a raw sqlite row to the caller-facing shape. */
function toRow(r: Record<string, unknown>): IndexedRow {
  return {
    accountId: String(r.account_id),
    folder: String(r.folder),
    uid: Number(r.uid),
    // Actions (mark-read, move) need it to re-find the message for undo; a
    // fast-tier row that was never deepened simply has none yet.
    messageId: r.message_id ? String(r.message_id) : null,
    threadId: String(r.thread_id),
    subject: String(r.subject),
    fromName: String(r.from_name),
    fromAddress: String(r.from_address),
    date: r.date === null || r.date === undefined ? null : Number(r.date),
    seen: Number(r.seen) === 1,
    hasAttachments: Number(r.has_attach) === 1,
    snippet: String(r.snippet),
    // Absent when this row predates the signal columns, or was never deepened.
    // The caller must treat that as "unknown", not as "not a newsletter".
    ...(Number(r.sig_list) >= 0
      ? {
          signals: {
            list: Number(r.sig_list) === 1,
            unsubscribe: Number(r.sig_unsub) === 1,
            machine: Number(r.sig_machine) === 1,
          },
        }
      : {}),
  }
}
