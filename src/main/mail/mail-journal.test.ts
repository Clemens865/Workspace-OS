import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  MailJournal,
  inverseOf,
  describeAction,
  type NewMailAction,
} from './mail-journal'

/**
 * The journal is the thing that lets mutating verbs exist at all, so these
 * tests weigh the undo semantics heavily — particularly the two mistakes that
 * would silently lose mail: inverting a move against the folder the message has
 * already left, and undoing a stack in the wrong order.
 */

let dir: string
let j: MailJournal

const act = (over: Partial<NewMailAction> = {}): NewMailAction => ({
  accountId: 'acct',
  actor: 'user',
  kind: 'move',
  messageId: '<1@x>',
  fromFolder: 'INBOX',
  toFolder: 'Archive',
  label: 'Budget',
  ...over,
})

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-journal-'))
  j = new MailJournal(path.join(dir, 'j.db'))
})
afterEach(() => {
  j.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('inverseOf', () => {
  it('inverts a move by searching the DESTINATION, not the origin', () => {
    // The bug this exists to prevent: after the move the message lives in
    // Archive, so undo must look there. Searching INBOX looks in the folder the
    // message has already left and finds nothing.
    const inv = inverseOf({ kind: 'move', fromFolder: 'INBOX', toFolder: 'Archive', messageId: '<1@x>' })
    expect(inv).toEqual({
      kind: 'move',
      searchFolder: 'Archive',
      toFolder: 'INBOX',
      messageId: '<1@x>',
    })
  })

  it('inverts a move to Trash back out of Trash', () => {
    // Deletion is modelled as a move, which is what makes it recoverable and
    // what lets us never call EXPUNGE.
    const inv = inverseOf({ kind: 'move', fromFolder: 'INBOX', toFolder: 'Trash', messageId: '<1@x>' })
    expect(inv.searchFolder).toBe('Trash')
    expect(inv.toFolder).toBe('INBOX')
  })

  it('inverts the flag pairs', () => {
    const base = { fromFolder: 'INBOX', toFolder: null, messageId: '<1@x>' }
    expect(inverseOf({ ...base, kind: 'markRead' }).kind).toBe('markUnread')
    expect(inverseOf({ ...base, kind: 'markUnread' }).kind).toBe('markRead')
    expect(inverseOf({ ...base, kind: 'flag' }).kind).toBe('unflag')
    expect(inverseOf({ ...base, kind: 'unflag' }).kind).toBe('flag')
  })

  it('leaves a flag inverse in the folder it is already in', () => {
    const inv = inverseOf({ kind: 'markRead', fromFolder: 'INBOX', toFolder: null, messageId: '<1@x>' })
    expect(inv.searchFolder).toBe('INBOX')
    expect(inv.toFolder).toBeNull()
  })

  it('is its own inverse — undoing an undo returns the original', () => {
    const original = { kind: 'move' as const, fromFolder: 'INBOX', toFolder: 'Archive', messageId: '<1@x>' }
    const undo = inverseOf(original)
    const redo = inverseOf({
      kind: undo.kind,
      fromFolder: undo.searchFolder,
      toFolder: undo.toFolder,
      messageId: undo.messageId,
    })
    expect(redo.searchFolder).toBe('INBOX')
    expect(redo.toFolder).toBe('Archive')
  })

  it('survives a move with no destination recorded', () => {
    const inv = inverseOf({ kind: 'move', fromFolder: 'INBOX', toFolder: null, messageId: '<1@x>' })
    expect(inv.searchFolder).toBe('INBOX')
  })
})

describe('MailJournal — recording', () => {
  it('records and returns the stored action', () => {
    const a = j.record(act(), 1_000)
    expect(a.id).toBeGreaterThan(0)
    expect(a.at).toBe(1_000)
    expect(a.undoneAt).toBeNull()
  })

  it('lists undoable actions newest-first', () => {
    // Order is correctness, not presentation: a stack of undos must run in
    // reverse, or an earlier undo moves a message out from under a later one.
    j.record(act({ messageId: '<1@x>' }), 1_000)
    j.record(act({ messageId: '<2@x>' }), 2_000)
    j.record(act({ messageId: '<3@x>' }), 3_000)
    expect(j.undoable('acct').map((a) => a.messageId)).toEqual(['<3@x>', '<2@x>', '<1@x>'])
  })

  it('keeps accounts separate', () => {
    j.record(act({ accountId: 'a' }), 1_000)
    j.record(act({ accountId: 'b' }), 2_000)
    expect(j.undoable('a')).toHaveLength(1)
    expect(j.undoable('b')).toHaveLength(1)
  })

  it('filters by actor — "undo what the agent did"', () => {
    j.record(act({ actor: 'user', messageId: '<u@x>' }), 1_000)
    j.record(act({ actor: 'agent', messageId: '<a1@x>' }), 2_000)
    j.record(act({ actor: 'agent', messageId: '<a2@x>' }), 3_000)
    expect(j.undoable('acct', { actor: 'agent' }).map((a) => a.messageId)).toEqual(['<a2@x>', '<a1@x>'])
    expect(j.undoable('acct', { actor: 'user' })).toHaveLength(1)
  })
})

describe('MailJournal — undo bookkeeping', () => {
  it('drops an action from the undoable list once undone', () => {
    const a = j.record(act(), 1_000)
    expect(j.undoable('acct')).toHaveLength(1)
    expect(j.markUndone(a.id, 2_000)).toBe(true)
    expect(j.undoable('acct')).toHaveLength(0)
  })

  it('will not undo the same action twice', () => {
    // Without this, a double-click on Undo moves the message back and forth,
    // or worse, applies the inverse to a message that has since moved on.
    const a = j.record(act(), 1_000)
    expect(j.markUndone(a.id, 2_000)).toBe(true)
    expect(j.markUndone(a.id, 3_000)).toBe(false)
  })

  it('keeps undone actions in the history as an audit trail', () => {
    const a = j.record(act(), 1_000)
    j.markUndone(a.id, 2_000)
    const hist = j.history('acct')
    expect(hist).toHaveLength(1)
    expect(hist[0].undoneAt).toBe(2_000)
  })

  it('returns false for an id that does not exist', () => {
    expect(j.markUndone(999, 1_000)).toBe(false)
  })
})

describe('MailJournal — undo a time range', () => {
  it('selects everything an actor did since a moment', () => {
    j.record(act({ actor: 'agent', messageId: '<old@x>' }), 1_000)
    j.record(act({ actor: 'agent', messageId: '<new1@x>' }), 5_000)
    j.record(act({ actor: 'agent', messageId: '<new2@x>' }), 6_000)
    j.record(act({ actor: 'user', messageId: '<mine@x>' }), 7_000)

    const since = j.undoableSince('acct', 5_000, 'agent')
    expect(since.map((a) => a.messageId)).toEqual(['<new2@x>', '<new1@x>'])
  })

  it('excludes already-undone actions from the range', () => {
    const a = j.record(act({ actor: 'agent' }), 5_000)
    j.markUndone(a.id, 6_000)
    expect(j.undoableSince('acct', 1_000, 'agent')).toHaveLength(0)
  })
})

describe('describeAction', () => {
  it('says who did what, in plain language', () => {
    expect(describeAction({ kind: 'move', toFolder: 'Archive', label: 'Budget', actor: 'agent' }))
      .toBe('Agent moved “Budget” to Archive')
    expect(describeAction({ kind: 'markRead', toFolder: null, label: 'Budget', actor: 'user' }))
      .toBe('You marked “Budget” read')
  })

  it('does not render an empty subject as empty quotes', () => {
    expect(describeAction({ kind: 'flag', toFolder: null, label: '   ', actor: 'user' }))
      .toContain('(no subject)')
  })
})

describe('MailJournal — lifecycle', () => {
  it('survives a reopen', () => {
    const p = path.join(dir, 'reopen.db')
    const a = new MailJournal(p)
    a.record(act(), 1_000)
    a.close()
    const b = new MailJournal(p)
    expect(b.undoable('acct')).toHaveLength(1)
    b.close()
  })

  it('forgets an account', () => {
    j.record(act({ accountId: 'gone' }), 1_000)
    j.record(act({ accountId: 'kept' }), 1_000)
    j.forgetAccount('gone')
    expect(j.history('gone')).toHaveLength(0)
    expect(j.history('kept')).toHaveLength(1)
  })
})
