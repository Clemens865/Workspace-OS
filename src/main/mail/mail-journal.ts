import Database from 'better-sqlite3'

/**
 * The mail action journal — an append-only record of every mailbox mutation,
 * each stored together with the operation that undoes it.
 *
 * This exists BEFORE any mutating verb does, deliberately. The rule the mail
 * design runs on is: **never let the agent's power exceed the undo you have
 * actually built.** The shadow-git checkpoint gives that for files and cannot
 * see IMAP state, so mail needs its own. Shipping move/delete first and adding
 * undo later would mean a window in which the guarantee is a promise rather
 * than a mechanism.
 *
 * Three decisions are load-bearing:
 *
 * 1. **Identity is the Message-ID, not the uid.** A moved message is assigned a
 *    NEW uid by the destination folder, so an inverse recorded as
 *    "move uid 5 back" is worthless the moment it is needed. IMAP's UIDPLUS
 *    extension reports the new uid, but not every server implements it. The
 *    Message-ID survives the move on every server, so undo resolves the uid by
 *    looking the Message-ID up in the folder it now lives in.
 *
 * 2. **Deletion is a move to Trash — there is no delete.** That makes its
 *    inverse an ordinary move back, so undo costs nothing extra, and it means
 *    we never call EXPUNGE. Nothing this journal records is unrecoverable.
 *
 * 3. **It records; it does not execute.** Computing an inverse is pure and
 *    unit-testable; performing one needs IMAP. Keeping them apart is what lets
 *    the undo semantics be proven without a mailbox.
 */

/** The mutations the mailbox will ever be asked to perform. */
export type MailActionKind = 'move' | 'markRead' | 'markUnread' | 'flag' | 'unflag'

/** Who performed it. The agent's actions are the ones a human may want to undo en masse. */
export type MailActor = 'user' | 'agent'

/** One recorded mutation. */
export interface MailAction {
  id: number
  at: number
  accountId: string
  actor: MailActor
  kind: MailActionKind
  /** Durable identity — survives folder moves, unlike the uid. */
  messageId: string
  /** Folder the message was in when the action ran. */
  fromFolder: string
  /** Destination, for `move` only. */
  toFolder: string | null
  /** Subject at the time, for a human-readable undo list. Never used to match. */
  label: string
  undoneAt: number | null
}

/** What the journal must be told to record an action. */
export type NewMailAction = Omit<MailAction, 'id' | 'at' | 'undoneAt'>

/**
 * An inverse, expressed as an executable descriptor rather than a closure so it
 * can be stored, inspected, shown to the user, and applied later.
 */
export interface InverseAction {
  kind: MailActionKind
  /** Where the message is NOW — where the undo must look for it. */
  searchFolder: string
  /** Where it should end up, for a `move`. */
  toFolder: string | null
  /** The Message-ID to resolve to a uid at execution time. */
  messageId: string
}

/**
 * Computes the operation that undoes `action`. Pure.
 *
 * Note `searchFolder`: after a move the message lives in the DESTINATION, so
 * that is where the undo has to find it — using `fromFolder` here would look in
 * the folder the message has already left, which is the obvious bug and the
 * reason this is a named function with tests rather than an inline ternary.
 */
export function inverseOf(action: Pick<MailAction, 'kind' | 'fromFolder' | 'toFolder' | 'messageId'>): InverseAction {
  const { kind, fromFolder, toFolder, messageId } = action
  switch (kind) {
    case 'move':
      return {
        kind: 'move',
        searchFolder: toFolder ?? fromFolder,
        toFolder: fromFolder,
        messageId,
      }
    case 'markRead':
      return { kind: 'markUnread', searchFolder: fromFolder, toFolder: null, messageId }
    case 'markUnread':
      return { kind: 'markRead', searchFolder: fromFolder, toFolder: null, messageId }
    case 'flag':
      return { kind: 'unflag', searchFolder: fromFolder, toFolder: null, messageId }
    case 'unflag':
      return { kind: 'flag', searchFolder: fromFolder, toFolder: null, messageId }
  }
}

/** Plain-language description of an action, for the undo list. */
export function describeAction(a: Pick<MailAction, 'kind' | 'toFolder' | 'label' | 'actor'>): string {
  const who = a.actor === 'agent' ? 'Agent' : 'You'
  const subject = a.label.trim() || '(no subject)'
  switch (a.kind) {
    case 'move':
      return `${who} moved “${subject}” to ${a.toFolder ?? 'another folder'}`
    case 'markRead':
      return `${who} marked “${subject}” read`
    case 'markUnread':
      return `${who} marked “${subject}” unread`
    case 'flag':
      return `${who} flagged “${subject}”`
    case 'unflag':
      return `${who} removed the flag from “${subject}”`
  }
}

export class MailJournal {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mail_actions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        at          INTEGER NOT NULL,
        account_id  TEXT NOT NULL,
        actor       TEXT NOT NULL,
        kind        TEXT NOT NULL,
        message_id  TEXT NOT NULL,
        from_folder TEXT NOT NULL,
        to_folder   TEXT,
        label       TEXT NOT NULL DEFAULT '',
        undone_at   INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_act_account ON mail_actions(account_id, at DESC);
      CREATE INDEX IF NOT EXISTS idx_act_undone  ON mail_actions(undone_at);
    `)
  }

  /** Appends an action. `now` is injected so ordering is deterministic in tests. */
  record(action: NewMailAction, now: number): MailAction {
    const info = this.db
      .prepare(
        `INSERT INTO mail_actions (at, account_id, actor, kind, message_id, from_folder, to_folder, label, undone_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        now,
        action.accountId,
        action.actor,
        action.kind,
        action.messageId,
        action.fromFolder,
        action.toFolder,
        action.label,
      )
    return { ...action, id: Number(info.lastInsertRowid), at: now, undoneAt: null }
  }

  /**
   * Actions still eligible for undo, newest first.
   *
   * Newest-first matters for correctness, not just display: undoing a stack of
   * actions has to run in reverse order, or an earlier undo moves a message out
   * from under a later one.
   */
  undoable(accountId: string, opts: { actor?: MailActor; limit?: number } = {}): MailAction[] {
    const where = ['account_id = ?', 'undone_at IS NULL']
    const params: unknown[] = [accountId]
    if (opts.actor) {
      where.push('actor = ?')
      params.push(opts.actor)
    }
    params.push(opts.limit ?? 100)
    const rows = this.db
      .prepare(`SELECT * FROM mail_actions WHERE ${where.join(' AND ')} ORDER BY at DESC, id DESC LIMIT ?`)
      .all(...params)
    return (rows as Record<string, unknown>[]).map(toAction)
  }

  /** Everything an actor did since a moment — the "undo the agent's last hour" query. */
  undoableSince(accountId: string, since: number, actor?: MailActor): MailAction[] {
    return this.undoable(accountId, { actor, limit: 1000 }).filter((a) => a.at >= since)
  }

  /** Marks an action undone. Idempotent: undoing twice is a no-op, not a double-undo. */
  markUndone(id: number, now: number): boolean {
    const info = this.db
      .prepare('UPDATE mail_actions SET undone_at = ? WHERE id = ? AND undone_at IS NULL')
      .run(now, id)
    return info.changes > 0
  }

  /** The full history including undone entries — the audit trail. */
  history(accountId: string, limit = 100): MailAction[] {
    const rows = this.db
      .prepare('SELECT * FROM mail_actions WHERE account_id = ? ORDER BY at DESC, id DESC LIMIT ?')
      .all(accountId, limit)
    return (rows as Record<string, unknown>[]).map(toAction)
  }

  /** Forgets one account's history — used when the account is removed. */
  forgetAccount(accountId: string): void {
    this.db.prepare('DELETE FROM mail_actions WHERE account_id = ?').run(accountId)
  }

  close(): void {
    this.db.close()
  }
}

function toAction(r: Record<string, unknown>): MailAction {
  return {
    id: Number(r.id),
    at: Number(r.at),
    accountId: String(r.account_id),
    actor: String(r.actor) as MailActor,
    kind: String(r.kind) as MailActionKind,
    messageId: String(r.message_id),
    fromFolder: String(r.from_folder),
    toFolder: r.to_folder === null || r.to_folder === undefined ? null : String(r.to_folder),
    label: String(r.label ?? ''),
    undoneAt: r.undone_at === null || r.undone_at === undefined ? null : Number(r.undone_at),
  }
}
