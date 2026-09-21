import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { MailJournal } from './mail-journal'
import { MailActions, type MutatingImap, type Target } from './mail-actions'
import { ok, err } from './types'

/**
 * These are the first operations in the product that can CHANGE a mailbox, so
 * the tests weigh the ways a change could become unrecoverable: acting without
 * recording, marking something undone that did not happen, and undoing against
 * a stale uid.
 */

let dir: string
let journal: MailJournal
let clock: number

/** A fake mailbox: folder → uids, with flags, so moves are observable. */
function fakeImap(over: Partial<MutatingImap> = {}) {
  const state = {
    // folder → uid → messageId
    folders: new Map<string, Map<number, string>>([
      ['INBOX', new Map([[10, '<a@x>']])],
      ['Archive', new Map()],
      ['Trash', new Map()],
    ]),
    flags: new Map<string, Set<string>>(),
    moveCalls: 0,
    flagCalls: 0,
  }
  let nextUid = 100

  const api: MutatingImap & { state: typeof state } = {
    state,
    async moveMessage(_a, folder, uid, toFolder) {
      state.moveCalls++
      const src = state.folders.get(folder)
      const msgId = src?.get(uid)
      if (!src || msgId === undefined) return err('not-found', 'no such uid')
      src.delete(uid)
      // The destination assigns a NEW uid — the whole reason the journal keys
      // on Message-ID rather than uid.
      const dst = state.folders.get(toFolder) ?? new Map()
      dst.set(nextUid++, msgId)
      state.folders.set(toFolder, dst)
      return ok(true as const)
    },
    async setFlags(_a, folder, uid, flags, add) {
      state.flagCalls++
      const src = state.folders.get(folder)
      const msgId = src?.get(uid)
      if (msgId === undefined) return err('not-found', 'no such uid')
      const set = state.flags.get(msgId) ?? new Set<string>()
      for (const f of flags) (add ? set.add(f) : set.delete(f))
      state.flags.set(msgId, set)
      return ok(true as const)
    },
    async findByMessageId(_a, folder, messageId) {
      const src = state.folders.get(folder)
      if (!src) return ok(null)
      for (const [uid, id] of src) if (id === messageId) return ok(uid)
      return ok(null)
    },
    ...over,
  }
  return api
}

const target = (over: Partial<Target> = {}): Target => ({
  accountId: 'acct',
  folder: 'INBOX',
  uid: 10,
  messageId: '<a@x>',
  label: 'Budget',
  ...over,
})

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-actions-'))
  journal = new MailJournal(path.join(dir, 'j.db'))
  clock = 1_000
})
afterEach(() => {
  journal.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const makeActions = (imap: MutatingImap) => new MailActions(imap, journal, () => (clock += 10))

describe('move', () => {
  it('moves the message and journals it', () => {
    const imap = fakeImap()
    return makeActions(imap)
      .move(target(), 'Archive', 'user')
      .then((res) => {
        expect(res.ok).toBe(true)
        expect(imap.state.folders.get('INBOX')!.size).toBe(0)
        expect(imap.state.folders.get('Archive')!.size).toBe(1)
        expect(journal.undoable('acct')).toHaveLength(1)
      })
  })

  it('does NOT journal when the move failed', async () => {
    // A journal entry for something that did not happen would offer an undo
    // that corrupts state when taken.
    const imap = fakeImap({ async moveMessage() { return err('host', 'offline') } })
    const res = await makeActions(imap).move(target(), 'Archive', 'user')
    expect(res.ok).toBe(false)
    expect(journal.undoable('acct')).toHaveLength(0)
  })

  it('deleting is a move to Trash — recoverable, never expunged', async () => {
    const imap = fakeImap()
    const actions = makeActions(imap)
    await actions.move(target(), 'Trash', 'user')
    expect(imap.state.folders.get('Trash')!.size).toBe(1)

    const [entry] = journal.undoable('acct')
    const undone = await actions.undo('acct', entry.id)
    expect(undone.ok).toBe(true)
    expect(imap.state.folders.get('INBOX')!.size).toBe(1)
    expect(imap.state.folders.get('Trash')!.size).toBe(0)
  })

  it('refuses to act on a message with no Message-ID', async () => {
    // Better to decline than to make a change that cannot be reversed.
    const imap = fakeImap()
    const res = await makeActions(imap).move(target({ messageId: '' }), 'Archive', 'user')
    expect(res.ok).toBe(false)
    expect(imap.state.moveCalls).toBe(0)
    expect(journal.undoable('acct')).toHaveLength(0)
  })
})

describe('flags', () => {
  it('marks read and journals the inverse', async () => {
    const imap = fakeImap()
    const actions = makeActions(imap)
    await actions.setRead(target(), true, 'user')
    expect(imap.state.flags.get('<a@x>')!.has('\\Seen')).toBe(true)

    const [entry] = journal.undoable('acct')
    expect(entry.kind).toBe('markRead')
    await actions.undo('acct', entry.id)
    expect(imap.state.flags.get('<a@x>')!.has('\\Seen')).toBe(false)
  })

  it('flags and unflags', async () => {
    const imap = fakeImap()
    const actions = makeActions(imap)
    await actions.setFlagged(target(), true, 'user')
    expect(imap.state.flags.get('<a@x>')!.has('\\Flagged')).toBe(true)
    const [entry] = journal.undoable('acct')
    await actions.undo('acct', entry.id)
    expect(imap.state.flags.get('<a@x>')!.has('\\Flagged')).toBe(false)
  })
})

describe('undo', () => {
  it('re-resolves the uid, because the move renumbered the message', async () => {
    // The fake assigns a fresh uid on move exactly as a real server does. An
    // undo that reused uid 10 would act on nothing (or worse, on whatever now
    // holds that uid).
    const imap = fakeImap()
    const actions = makeActions(imap)
    await actions.move(target(), 'Archive', 'user')
    const archivedUid = [...imap.state.folders.get('Archive')!.keys()][0]
    expect(archivedUid).not.toBe(10)

    const [entry] = journal.undoable('acct')
    const res = await actions.undo('acct', entry.id)
    expect(res.ok).toBe(true)
    expect([...imap.state.folders.get('INBOX')!.values()]).toEqual(['<a@x>'])
  })

  it('reports plainly when the message is no longer where the undo expects', async () => {
    const imap = fakeImap()
    const actions = makeActions(imap)
    await actions.move(target(), 'Archive', 'user')
    // The user moves it again in another client.
    imap.state.folders.get('Archive')!.clear()

    const [entry] = journal.undoable('acct')
    const res = await actions.undo('acct', entry.id)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.message).toContain('no longer in Archive')
    // Still undoable — we did not mark it done for an operation that never ran.
    expect(journal.undoable('acct')).toHaveLength(1)
  })

  it('does not mark an action undone when the inverse itself fails', async () => {
    const imap = fakeImap()
    const actions = makeActions(imap)
    await actions.move(target(), 'Archive', 'user')

    const failing = makeActions(
      fakeImap({
        async findByMessageId() { return ok(55) },
        async moveMessage() { return err('timeout', 'slow') },
      }),
    )
    const [entry] = journal.undoable('acct')
    const res = await failing.undo('acct', entry.id)
    expect(res.ok).toBe(false)
    expect(journal.undoable('acct')).toHaveLength(1)
  })

  it('refuses an unknown or already-undone action', async () => {
    const actions = makeActions(fakeImap())
    expect((await actions.undo('acct', 999)).ok).toBe(false)
  })
})

describe('undoSince — take back a batch', () => {
  it('undoes an actor’s actions newest-first and reports counts', async () => {
    const imap = fakeImap()
    imap.state.folders.set('INBOX', new Map([[10, '<a@x>'], [11, '<b@x>']]))
    const actions = makeActions(imap)

    await actions.move(target({ uid: 10, messageId: '<a@x>' }), 'Archive', 'agent')
    await actions.move(target({ uid: 11, messageId: '<b@x>' }), 'Archive', 'agent')
    expect(imap.state.folders.get('Archive')!.size).toBe(2)

    const res = await actions.undoSince('acct', 0, 'agent')
    expect(res.ok && res.value).toEqual({ undone: 2, failed: 0 })
    expect(imap.state.folders.get('INBOX')!.size).toBe(2)
    expect(imap.state.folders.get('Archive')!.size).toBe(0)
  })

  it('leaves the user’s own actions alone when undoing the agent', async () => {
    const imap = fakeImap()
    imap.state.folders.set('INBOX', new Map([[10, '<a@x>'], [11, '<b@x>']]))
    const actions = makeActions(imap)

    await actions.move(target({ uid: 10, messageId: '<a@x>' }), 'Archive', 'agent')
    await actions.move(target({ uid: 11, messageId: '<b@x>' }), 'Trash', 'user')

    await actions.undoSince('acct', 0, 'agent')
    expect(imap.state.folders.get('Trash')!.size).toBe(1) // the user's move stands
    expect(journal.undoable('acct', { actor: 'user' })).toHaveLength(1)
  })

  it('one failure does not abort the batch', async () => {
    const imap = fakeImap()
    imap.state.folders.set('INBOX', new Map([[10, '<a@x>'], [11, '<b@x>']]))
    const actions = makeActions(imap)
    await actions.move(target({ uid: 10, messageId: '<a@x>' }), 'Archive', 'agent')
    await actions.move(target({ uid: 11, messageId: '<b@x>' }), 'Archive', 'agent')

    // One of them vanishes from Archive before the undo runs.
    for (const [uid, id] of imap.state.folders.get('Archive')!) {
      if (id === '<a@x>') imap.state.folders.get('Archive')!.delete(uid)
    }

    const res = await actions.undoSince('acct', 0, 'agent')
    expect(res.ok && res.value).toEqual({ undone: 1, failed: 1 })
  })
})
