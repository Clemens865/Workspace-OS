import type { MailResult } from './types'
import { ok, err } from './types'
import {
  MailJournal,
  inverseOf,
  type MailActor,
  type MailAction,
  type InverseAction,
} from './mail-journal'

/**
 * Mutating mailbox operations — the only path by which mail is ever changed.
 *
 * Every mutation is journalled BEFORE it is reported as done, so an undo always
 * exists for anything that happened. This is the layer the journal was built
 * for, and the reason the journal was built first: the guarantee is that the
 * power to change the mailbox and the power to take it back ship together.
 *
 * What is NOT here, deliberately:
 *   - delete   — deleting is `move(..., Trash)`; the server keeps it, undo
 *                retrieves it.
 *   - expunge  — never called, anywhere. Nothing is unrecoverable.
 *   - send     — irreversible and public; it stays a human action in the UI and
 *                is not reachable from this class at all.
 */

/** The IMAP surface these operations need, injected so this is testable dry. */
export interface MutatingImap {
  moveMessage(accountId: string, folder: string, uid: number, toFolder: string): Promise<MailResult<true>>
  setFlags(
    accountId: string,
    folder: string,
    uid: number,
    flags: string[],
    add: boolean,
  ): Promise<MailResult<true>>
  findByMessageId(accountId: string, folder: string, messageId: string): Promise<MailResult<number | null>>
}

/** Identifies the message to act on. `messageId` is required — see below. */
export interface Target {
  accountId: string
  folder: string
  uid: number
  /**
   * REQUIRED, not optional. The uid changes when a message moves, so a journal
   * entry without a Message-ID cannot be undone. Refusing to act without one is
   * better than recording an action we cannot reverse.
   */
  messageId: string
  /** Subject, for the human-readable undo list. Never used to match. */
  label?: string
}

export class MailActions {
  constructor(
    private readonly imap: MutatingImap,
    private readonly journal: MailJournal,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Moves a message. Archive, filing, and "delete" (to Trash) all come here. */
  async move(target: Target, toFolder: string, actor: MailActor): Promise<MailResult<MailAction>> {
    const guard = requireMessageId(target)
    if (guard) return guard

    const res = await this.imap.moveMessage(target.accountId, target.folder, target.uid, toFolder)
    if (!res.ok) return res

    return ok(
      this.journal.record(
        {
          accountId: target.accountId,
          actor,
          kind: 'move',
          messageId: target.messageId,
          fromFolder: target.folder,
          toFolder,
          label: target.label ?? '',
        },
        this.now(),
      ),
    )
  }

  /** Marks read / unread. */
  async setRead(target: Target, read: boolean, actor: MailActor): Promise<MailResult<MailAction>> {
    return this.flagOp(target, ['\\Seen'], read, read ? 'markRead' : 'markUnread', actor)
  }

  /** Adds or removes the \\Flagged star. */
  async setFlagged(target: Target, flagged: boolean, actor: MailActor): Promise<MailResult<MailAction>> {
    return this.flagOp(target, ['\\Flagged'], flagged, flagged ? 'flag' : 'unflag', actor)
  }

  private async flagOp(
    target: Target,
    flags: string[],
    add: boolean,
    kind: 'markRead' | 'markUnread' | 'flag' | 'unflag',
    actor: MailActor,
  ): Promise<MailResult<MailAction>> {
    const guard = requireMessageId(target)
    if (guard) return guard

    const res = await this.imap.setFlags(target.accountId, target.folder, target.uid, flags, add)
    if (!res.ok) return res

    return ok(
      this.journal.record(
        {
          accountId: target.accountId,
          actor,
          kind,
          messageId: target.messageId,
          fromFolder: target.folder,
          toFolder: null,
          label: target.label ?? '',
        },
        this.now(),
      ),
    )
  }

  /**
   * Undoes one journalled action.
   *
   * The uid is re-resolved from the Message-ID rather than reused, because a
   * moved message has been renumbered by its new folder — and because the user
   * may have moved it again in another client since. If it cannot be found,
   * that is reported plainly and the action stays undoable, rather than being
   * marked done on the strength of an operation that did nothing.
   */
  async undo(accountId: string, actionId: number): Promise<MailResult<InverseAction>> {
    const action = this.journal
      .undoable(accountId, { limit: 1000 })
      .find((a) => a.id === actionId)
    if (!action) return err('not-found', 'That action is not available to undo.')

    const inv = inverseOf(action)

    const found = await this.imap.findByMessageId(accountId, inv.searchFolder, inv.messageId)
    if (!found.ok) return found
    if (found.value === null) {
      return err(
        'not-found',
        `That message is no longer in ${inv.searchFolder} — it may have been moved elsewhere.`,
      )
    }

    const uid = found.value
    const applied =
      inv.kind === 'move'
        ? await this.imap.moveMessage(accountId, inv.searchFolder, uid, inv.toFolder ?? inv.searchFolder)
        : await this.imap.setFlags(
            accountId,
            inv.searchFolder,
            uid,
            inv.kind === 'markRead' || inv.kind === 'markUnread' ? ['\\Seen'] : ['\\Flagged'],
            inv.kind === 'markRead' || inv.kind === 'flag',
          )

    if (!applied.ok) return applied

    // Only now is it undone. Marking earlier would lose the undo if the
    // operation failed halfway.
    this.journal.markUndone(action.id, this.now())
    return ok(inv)
  }

  /**
   * Undoes everything an actor did since a moment, newest first.
   *
   * Reverse order is a correctness requirement: replaying oldest-first moves a
   * message out from under a later undo. Individual failures do not abort the
   * batch — a message the user has since moved themselves should not block
   * undoing the rest.
   */
  async undoSince(
    accountId: string,
    since: number,
    actor?: MailActor,
  ): Promise<MailResult<{ undone: number; failed: number }>> {
    const actions = this.journal.undoableSince(accountId, since, actor)
    let undone = 0
    let failed = 0
    for (const a of actions) {
      const res = await this.undo(accountId, a.id)
      if (res.ok) undone++
      else failed++
    }
    return ok({ undone, failed })
  }
}

/** A target with no Message-ID cannot be undone, so it is refused up front. */
function requireMessageId(t: Target): MailResult<never> | null {
  if (!t.messageId || !t.messageId.trim()) {
    return err(
      'unavailable',
      'This message has no Message-ID, so the change could not be undone. Refusing to make it.',
    )
  }
  return null
}
