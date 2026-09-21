import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { MailIndex, toFtsQuery, messageKey, type IndexedMessage, type EnvelopeRow } from './mail-index'

/**
 * The index is a CACHE, never the truth — so these tests care most about the
 * properties that make a cache safe: re-indexing is idempotent, pruning removes
 * only local rows, and a search box full of punctuation cannot throw.
 */

let dir: string
let idx: MailIndex

const msg = (over: Partial<IndexedMessage> & { uid: number }): IndexedMessage => ({
  accountId: 'acct',
  folder: 'INBOX',
  messageId: null,
  inReplyTo: null,
  references: [],
  subject: '',
  fromName: '',
  fromAddress: '',
  toAddresses: '',
  date: 1_000,
  seen: false,
  hasAttachments: false,
  snippet: '',
  text: '',
  // Every real deep row carries these — toIndexedMessage always computes them.
  // Without them the row reads as "not looked at yet" and stays in the queue.
  signals: { list: false, unsubscribe: false, machine: false },
  ...over,
})

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-mailidx-'))
  idx = new MailIndex(path.join(dir, 'mail-index.db'))
})
afterEach(() => {
  idx.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('toFtsQuery', () => {
  it('quotes each token so punctuation cannot be read as FTS syntax', () => {
    expect(toFtsQuery('budget')).toBe('"budget"')
    expect(toFtsQuery('q3 budget')).toBe('"q3" "budget"')
  })

  it('survives the inputs that would otherwise be a syntax error', () => {
    // A mail search box gets addresses and punctuation constantly.
    expect(toFtsQuery('foo@bar.com')).toBe('"foo@bar.com"')
    expect(toFtsQuery('budget - Q3')).toBe('"budget" "-" "Q3"')
    expect(toFtsQuery('a AND b')).toBe('"a" "AND" "b"')
  })

  it('is empty for empty-ish input, so callers can short-circuit', () => {
    expect(toFtsQuery('')).toBe('')
    expect(toFtsQuery('   ')).toBe('')
  })
})

describe('MailIndex — storage', () => {
  it('stores and lists a folder newest-first', () => {
    idx.upsertMany([
      msg({ uid: 1, subject: 'old', date: 1_000 }),
      msg({ uid: 2, subject: 'new', date: 5_000 }),
    ])
    const rows = idx.listFolder('acct', 'INBOX')
    expect(rows.map((r) => r.subject)).toEqual(['new', 'old'])
  })

  it('is idempotent — re-indexing the same message does not duplicate it', () => {
    const m = msg({ uid: 1, subject: 'Budget', text: 'the budget' })
    idx.upsertMany([m])
    idx.upsertMany([m])
    idx.upsertMany([m])
    expect(idx.stats().messages).toBe(1)
    // The FTS side has no upsert of its own, so this is where a duplicate would
    // show up as the same mail appearing three times in search.
    expect(idx.search('budget')).toHaveLength(1)
  })

  it('updates a message in place when its flags change', () => {
    idx.upsertMany([msg({ uid: 1, subject: 'x', seen: false })])
    idx.upsertMany([msg({ uid: 1, subject: 'x', seen: true })])
    const rows = idx.listFolder('acct', 'INBOX')
    expect(rows).toHaveLength(1)
    expect(rows[0].seen).toBe(true)
  })

  it('keeps accounts and folders separate', () => {
    idx.upsertMany([
      msg({ uid: 1, subject: 'inbox' }),
      msg({ uid: 1, folder: 'Archive', subject: 'archived' }),
      msg({ uid: 1, accountId: 'other', subject: 'other account' }),
    ])
    expect(idx.listFolder('acct', 'INBOX').map((r) => r.subject)).toEqual(['inbox'])
    expect(idx.listFolder('acct', 'Archive').map((r) => r.subject)).toEqual(['archived'])
    expect(idx.listFolder('other', 'INBOX').map((r) => r.subject)).toEqual(['other account'])
  })

  it('tolerates a message with no date rather than dropping it', () => {
    idx.upsertMany([msg({ uid: 1, subject: 'undated', date: null })])
    const rows = idx.listFolder('acct', 'INBOX')
    expect(rows).toHaveLength(1)
    expect(rows[0].date).toBeNull()
  })
})

describe('MailIndex — search', () => {
  beforeEach(() => {
    idx.upsertMany([
      msg({ uid: 1, subject: 'Q3 budget', fromAddress: 'ana@x.com', text: 'here are the numbers' }),
      msg({ uid: 2, subject: 'Offsite', fromAddress: 'bo@y.com', text: 'lunch plans' }),
    ])
  })

  it('finds by subject, body and sender', () => {
    expect(idx.search('budget').map((r) => r.uid)).toEqual([1])
    expect(idx.search('numbers').map((r) => r.uid)).toEqual([1])
    expect(idx.search('bo@y.com').map((r) => r.uid)).toEqual([2])
  })

  it('returns nothing for an empty query instead of everything', () => {
    // The dangerous default: an empty search box dumping the whole mailbox.
    expect(idx.search('')).toEqual([])
    expect(idx.search('   ')).toEqual([])
  })

  it('scopes to an account and a folder', () => {
    idx.upsertMany([msg({ uid: 9, accountId: 'other', subject: 'budget elsewhere' })])
    expect(idx.search('budget', { accountId: 'acct' }).map((r) => r.uid)).toEqual([1])
    expect(idx.search('budget', { folder: 'Archive' })).toEqual([])
  })

  it('honours the limit', () => {
    // Use a term both messages share, so an unlimited search would return 2 and
    // the assertion actually distinguishes a working limit from a broken one.
    idx.upsertMany([
      msg({ uid: 3, subject: 'weekly recap', text: 'recap' }),
      msg({ uid: 4, subject: 'another recap', text: 'recap' }),
    ])
    expect(idx.search('recap')).toHaveLength(2)
    expect(idx.search('recap', { limit: 1 })).toHaveLength(1)
  })
})

describe('MailIndex — threading', () => {
  it('groups a reply with its parent', () => {
    idx.upsertMany([
      msg({ uid: 1, messageId: '<1@x>', subject: 'Budget' }),
      msg({ uid: 2, messageId: '<2@x>', inReplyTo: '<1@x>', subject: 'Re: Budget' }),
    ])
    const rows = idx.listFolder('acct', 'INBOX')
    expect(rows[0].threadId).toBe(rows[1].threadId)
    expect(idx.listThread(rows[0].threadId)).toHaveLength(2)
  })

  it('re-threads when a later reply joins two existing messages', () => {
    // The reason rethread() runs over the whole account, not the batch: these
    // two look unrelated until the third message arrives.
    idx.upsertMany([msg({ uid: 1, messageId: '<1@x>', subject: 'A' })])
    idx.upsertMany([msg({ uid: 2, messageId: '<2@x>', subject: 'B' })])
    const before = idx.listFolder('acct', 'INBOX')
    expect(before[0].threadId).not.toBe(before[1].threadId)

    idx.upsertMany([
      msg({ uid: 3, messageId: '<3@x>', references: ['<1@x>', '<2@x>'], subject: 'Re: A' }),
    ])
    const after = idx.listFolder('acct', 'INBOX')
    const ids = new Set(after.map((r) => r.threadId))
    expect(ids.size).toBe(1)
  })

  it('reads a thread oldest-first', () => {
    idx.upsertMany([
      msg({ uid: 2, messageId: '<2@x>', inReplyTo: '<1@x>', subject: 'Re: B', date: 5_000 }),
      msg({ uid: 1, messageId: '<1@x>', subject: 'B', date: 1_000 }),
    ])
    const tid = idx.listFolder('acct', 'INBOX')[0].threadId
    expect(idx.listThread(tid).map((r) => r.uid)).toEqual([1, 2])
  })
})

describe('MailIndex — incremental sync', () => {
  it('reports the highest uid so a resync fetches only what is new', () => {
    expect(idx.highestUid('acct', 'INBOX')).toBe(0)
    idx.upsertMany([msg({ uid: 4 }), msg({ uid: 9 }), msg({ uid: 7 })])
    expect(idx.highestUid('acct', 'INBOX')).toBe(9)
    expect(idx.highestUid('acct', 'Archive')).toBe(0)
  })

  it('prunes rows for messages that vanished server-side', () => {
    idx.upsertMany([msg({ uid: 1, text: 'one' }), msg({ uid: 2, text: 'two' })])
    const removed = idx.pruneFolder('acct', 'INBOX', [1])
    expect(removed).toBe(1)
    expect(idx.listFolder('acct', 'INBOX').map((r) => r.uid)).toEqual([1])
    // The FTS shadow must go too, or a deleted mail stays findable forever.
    expect(idx.search('two')).toEqual([])
  })

  it('prunes nothing when every uid is still live', () => {
    idx.upsertMany([msg({ uid: 1 }), msg({ uid: 2 })])
    expect(idx.pruneFolder('acct', 'INBOX', [1, 2])).toBe(0)
    expect(idx.listFolder('acct', 'INBOX')).toHaveLength(2)
  })

  it('does not prune a different folder', () => {
    idx.upsertMany([msg({ uid: 1 }), msg({ uid: 1, folder: 'Archive' })])
    idx.pruneFolder('acct', 'INBOX', [])
    expect(idx.listFolder('acct', 'Archive')).toHaveLength(1)
  })

  it('forgets an account entirely, FTS included', () => {
    idx.upsertMany([msg({ uid: 1, text: 'secret' }), msg({ uid: 1, accountId: 'keep', text: 'kept' })])
    idx.forgetAccount('acct')
    expect(idx.listFolder('acct', 'INBOX')).toEqual([])
    expect(idx.search('secret')).toEqual([])
    expect(idx.search('kept')).toHaveLength(1)
  })
})

describe('MailIndex — two-tier sync', () => {
  const env = (over: Partial<EnvelopeRow> & { uid: number }): EnvelopeRow => {
    const { messageId: _a, inReplyTo: _b, references: _c, text: _d, ...rest } = msg(over)
    return { ...rest, ...over }
  }

  it('records envelope rows as not-yet-deep', () => {
    idx.upsertEnvelopes([env({ uid: 1, subject: 'hello' })])
    expect(idx.pendingDeepCount('acct')).toBe(1)
    expect(idx.needsDeepFetch('acct')).toEqual([{ folder: 'INBOX', uid: 1 }])
  })

  it('marks a row deep once the full message lands', () => {
    idx.upsertEnvelopes([env({ uid: 1, subject: 'hello' })])
    idx.upsertMany([msg({ uid: 1, subject: 'hello', text: 'the body' })])
    expect(idx.pendingDeepCount('acct')).toBe(0)
    expect(idx.needsDeepFetch('acct')).toEqual([])
    expect(idx.search('body')).toHaveLength(1)
  })

  it('an envelope re-sync does NOT wipe a deepened row', () => {
    // The dangerous regression: a routine envelope refresh silently un-indexing
    // the mailbox for full-text search while every list still looks correct.
    idx.upsertMany([
      msg({ uid: 1, subject: 'Budget', messageId: '<1@x>', text: 'secret numbers' }),
    ])
    expect(idx.search('secret')).toHaveLength(1)

    idx.upsertEnvelopes([env({ uid: 1, subject: 'Budget', seen: true })])

    expect(idx.search('secret')).toHaveLength(1) // body survived
    expect(idx.pendingDeepCount('acct')).toBe(0) // still deep
    expect(idx.listFolder('acct', 'INBOX')[0].seen).toBe(true) // flags still updated
  })

  it('does not duplicate FTS rows when an envelope is re-synced', () => {
    idx.upsertEnvelopes([env({ uid: 1, subject: 'recap' })])
    idx.upsertEnvelopes([env({ uid: 1, subject: 'recap' })])
    idx.upsertEnvelopes([env({ uid: 1, subject: 'recap' })])
    expect(idx.search('recap')).toHaveLength(1)
  })

  it('threads envelope-only rows by subject until they are deepened', () => {
    // No Message-IDs yet at the fast tier, so the subject fallback is all we
    // have — and it must still produce something coherent.
    idx.upsertEnvelopes([env({ uid: 1, subject: 'Budget' }), env({ uid: 2, subject: 'Re: Budget' })])
    const rows = idx.listFolder('acct', 'INBOX')
    expect(rows[0].threadId).toBe(rows[1].threadId)
  })

  it('orders the deep queue newest-first', () => {
    idx.upsertEnvelopes([
      env({ uid: 1, date: 1_000 }),
      env({ uid: 2, date: 9_000 }),
      env({ uid: 3, date: 5_000 }),
    ])
    expect(idx.needsDeepFetch('acct').map((r) => r.uid)).toEqual([2, 3, 1])
  })

  it('limits the deep queue', () => {
    idx.upsertEnvelopes([env({ uid: 1 }), env({ uid: 2 }), env({ uid: 3 })])
    expect(idx.needsDeepFetch('acct', 2)).toHaveLength(2)
  })
})

describe('MailIndex — persistence', () => {
  it('survives a reopen', () => {
    const p = path.join(dir, 'reopen.db')
    const a = new MailIndex(p)
    a.upsertMany([msg({ uid: 1, subject: 'persisted', text: 'body' })])
    a.close()

    const b = new MailIndex(p)
    expect(b.listFolder('acct', 'INBOX').map((r) => r.subject)).toEqual(['persisted'])
    expect(b.search('body')).toHaveLength(1)
    b.close()
  })
})

describe('messageKey', () => {
  it('is stable and distinguishes account, folder and uid', () => {
    expect(messageKey('a', 'INBOX', 1)).toBe('a:INBOX:1')
    expect(messageKey('a', 'INBOX', 1)).not.toBe(messageKey('a', 'Archive', 1))
    expect(messageKey('a', 'INBOX', 1)).not.toBe(messageKey('b', 'INBOX', 1))
  })
})

describe('MailIndex — conversation rows', () => {
  it('returns one row per thread, newest message representing it', () => {
    idx.upsertMany([
      msg({ uid: 1, messageId: '<1@x>', subject: 'Budget', date: 1_000 }),
      msg({ uid: 2, messageId: '<2@x>', inReplyTo: '<1@x>', subject: 'Re: Budget', date: 5_000 }),
      msg({ uid: 3, messageId: '<9@x>', subject: 'Offsite', date: 3_000 }),
    ])
    const threads = idx.listThreads('acct', 'INBOX')
    expect(threads).toHaveLength(2)
    expect(threads[0].subject).toBe('Re: Budget') // newest overall
    expect(threads[0].threadCount).toBe(2)
    expect(threads[1].threadCount).toBe(1)
  })

  it('marks a conversation unread when ANY message in it is unread', () => {
    // What every mail client means by a bold conversation. Taking `seen` from
    // the representative row alone would show a thread as read while an unread
    // reply sits inside it.
    idx.upsertMany([
      msg({ uid: 1, messageId: '<1@x>', subject: 'A', date: 1_000, seen: false }),
      msg({ uid: 2, messageId: '<2@x>', inReplyTo: '<1@x>', subject: 'Re: A', date: 5_000, seen: true }),
    ])
    const [thread] = idx.listThreads('acct', 'INBOX')
    expect(thread.subject).toBe('Re: A')
    expect(thread.seen).toBe(false)
  })

  it('marks a conversation read only when every message is read', () => {
    idx.upsertMany([
      msg({ uid: 1, messageId: '<1@x>', subject: 'A', date: 1_000, seen: true }),
      msg({ uid: 2, messageId: '<2@x>', inReplyTo: '<1@x>', subject: 'Re: A', date: 5_000, seen: true }),
    ])
    expect(idx.listThreads('acct', 'INBOX')[0].seen).toBe(true)
  })

  it('orders conversations by their newest message', () => {
    idx.upsertMany([
      msg({ uid: 1, messageId: '<a@x>', subject: 'Old thread', date: 1_000 }),
      msg({ uid: 2, messageId: '<b@x>', subject: 'Newer', date: 9_000 }),
      msg({ uid: 3, messageId: '<a2@x>', inReplyTo: '<a@x>', subject: 'Re: Old thread', date: 9_500 }),
    ])
    // The old thread has a brand-new reply, so it must sort ABOVE "Newer".
    expect(idx.listThreads('acct', 'INBOX').map((t) => t.subject)).toEqual(['Re: Old thread', 'Newer'])
  })

  it('scopes to the folder and pages', () => {
    idx.upsertMany([
      msg({ uid: 1, messageId: '<1@x>', subject: 'in', date: 1_000 }),
      msg({ uid: 2, folder: 'Archive', messageId: '<2@x>', subject: 'arch', date: 1_000 }),
    ])
    expect(idx.listThreads('acct', 'INBOX')).toHaveLength(1)
    expect(idx.listThreads('acct', 'INBOX', 1, 1)).toHaveLength(0)
  })
})

describe('MailIndex — contact suggestions', () => {
  beforeEach(() => {
    idx.upsertMany([
      msg({ uid: 1, fromName: 'Ana Meier', fromAddress: 'ana@acme.com', date: 5_000 }),
      msg({ uid: 2, fromName: 'Ana Meier', fromAddress: 'ana@acme.com', date: 6_000 }),
      msg({ uid: 3, fromName: 'Ana Meier', fromAddress: 'ana@acme.com', date: 7_000 }),
      msg({ uid: 4, fromName: 'Bo Schmidt', fromAddress: 'bo@acme.com', date: 9_000 }),
      msg({ uid: 5, fromName: 'Newsletter', fromAddress: 'news@other.com', date: 1_000 }),
    ])
  })

  it('matches on the address', () => {
    expect(idx.suggestContacts('ana').map((c) => c.address)).toEqual(['ana@acme.com'])
  })

  it('matches on the display name too', () => {
    // People type "Schmidt", not "bo@".
    expect(idx.suggestContacts('schmidt').map((c) => c.address)).toEqual(['bo@acme.com'])
  })

  it('ranks by how often you correspond, not alphabetically', () => {
    // Ana appears 3×, Bo once — Ana first, even though Bo is more recent.
    expect(idx.suggestContacts('acme').map((c) => c.address)).toEqual(['ana@acme.com', 'bo@acme.com'])
  })

  it('deduplicates one person into one suggestion', () => {
    const hits = idx.suggestContacts('ana')
    expect(hits).toHaveLength(1)
    expect(hits[0].count).toBe(3)
  })

  it('returns nothing for an empty query rather than the whole address book', () => {
    expect(idx.suggestContacts('')).toEqual([])
    expect(idx.suggestContacts('   ')).toEqual([])
  })

  it('honours the limit', () => {
    expect(idx.suggestContacts('acme', 1)).toHaveLength(1)
  })

  it('is case-insensitive', () => {
    expect(idx.suggestContacts('ANA')).toHaveLength(1)
    expect(idx.suggestContacts('Ana Meier'.toLowerCase())).toHaveLength(1)
  })

  it('treats a query with SQL wildcards as literal text', () => {
    // "%" would otherwise match everyone — an autocomplete that dumps the whole
    // address book on a stray keystroke.
    const all = idx.suggestContacts('%')
    expect(all.every((c) => c.address.includes('%'))).toBe(true)
  })
})

describe('MailIndex — structured search', () => {
  beforeEach(() => {
    idx.upsertMany([
      msg({ uid: 1, subject: 'Q3 budget', fromName: 'Ana Meier', fromAddress: 'ana@acme.com',
            toAddresses: 'me@x.com', text: 'numbers inside', seen: false, hasAttachments: true, date: 9_000 }),
      msg({ uid: 2, subject: 'Offsite plan', fromName: 'Bo Schmidt', fromAddress: 'bo@acme.com',
            toAddresses: 'team@x.com', text: 'lunch', seen: true, date: 5_000 }),
      msg({ uid: 3, subject: 'Budget follow-up', fromName: 'Ana Meier', fromAddress: 'ana@acme.com',
            toAddresses: 'me@x.com', text: 'more', seen: true, date: 1_000 }),
    ])
  })

  it('filters by from:', () => {
    expect(idx.searchStructured('from:ana').map((r) => r.uid).sort()).toEqual([1, 3])
  })

  it('filters by to:', () => {
    expect(idx.searchStructured('to:team').map((r) => r.uid)).toEqual([2])
  })

  it('filters by subject:', () => {
    expect(idx.searchStructured('subject:offsite').map((r) => r.uid)).toEqual([2])
  })

  it('filters by is:unread and is:read', () => {
    expect(idx.searchStructured('is:unread').map((r) => r.uid)).toEqual([1])
    expect(idx.searchStructured('is:read').map((r) => r.uid).sort()).toEqual([2, 3])
  })

  it('filters by has:attachment', () => {
    expect(idx.searchStructured('has:attachment').map((r) => r.uid)).toEqual([1])
  })

  it('combines an operator with free text', () => {
    expect(idx.searchStructured('from:ana numbers').map((r) => r.uid)).toEqual([1])
  })

  it('treats an operator-only query as a real search, not an empty one', () => {
    // "show me unread mail" is a legitimate thing to type on its own.
    expect(idx.searchStructured('is:unread')).toHaveLength(1)
  })

  it('returns nothing for a genuinely empty query', () => {
    expect(idx.searchStructured('')).toEqual([])
    expect(idx.searchStructured('   ')).toEqual([])
  })

  it('searches an unknown operator literally instead of ignoring it', () => {
    // Dropping it would return every message and look like a working search.
    expect(idx.searchStructured('wat:xyz')).toEqual([])
  })

  it('sorts by sender, across the whole folder rather than a page', () => {
    const bySender = idx.searchStructured('acme', { sort: 'sender' }).map((r) => r.fromName)
    expect(bySender[0]).toBe('Ana Meier')
  })

  it('sorts oldest-first on request', () => {
    expect(idx.searchStructured('acme', { sort: 'date-asc' }).map((r) => r.uid)).toEqual([3, 2, 1])
  })

  it('sorts unread first', () => {
    expect(idx.searchStructured('acme', { sort: 'unread' })[0].uid).toBe(1)
  })
})

/**
 * A mailbox indexed before the signal columns existed.
 *
 * Those rows are deep = 1 with no signals, so nothing would ever revisit them
 * and they could never be sorted — the newsletter sweep would report "478
 * messages could not be checked" forever, which is honest and useless at once.
 */
describe('MailIndex — signal backfill', () => {
  it('queues a deepened row that has no signals', () => {
    idx.upsertMany([{ ...msg({ uid: 1 }), signals: undefined }])
    expect(idx.pendingDeepCount('acct')).toBe(1)
    expect(idx.needsDeepFetch('acct', 10).map((r) => r.uid)).toEqual([1])
  })

  it('stops queueing it once the signals are recorded', () => {
    idx.upsertMany([{ ...msg({ uid: 1 }), signals: undefined }])
    idx.upsertMany([msg({ uid: 1 })])
    expect(idx.pendingDeepCount('acct')).toBe(0)
    expect(idx.needsDeepFetch('acct', 10)).toEqual([])
  })

  it('reads the signals back', () => {
    idx.upsertMany([{ ...msg({ uid: 1 }), signals: { list: true, unsubscribe: true, machine: false } }])
    expect(idx.listFolder('acct', 'INBOX', 10)[0].signals).toEqual({
      list: true,
      unsubscribe: true,
      machine: false,
    })
  })
})
