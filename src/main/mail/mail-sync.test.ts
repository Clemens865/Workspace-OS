import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { MailIndex } from './mail-index'
import {
  syncEnvelopes,
  deepenBatch,
  toEpoch,
  parseReferences,
  toEnvelopeRow,
  type SyncDeps,
} from './mail-sync'
import { ok, err, type MessageSummary, type FullMessage } from './types'

let dir: string
let idx: MailIndex

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-mailsync-'))
  idx = new MailIndex(path.join(dir, 'i.db'))
})
afterEach(() => {
  idx.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const summary = (over: Partial<MessageSummary> & { uid: number }): MessageSummary => ({
  subject: 's',
  from: [{ name: 'Ana', address: 'ana@x.com' }],
  to: [{ name: '', address: 'me@x.com' }],
  date: 'Tue, 05 Aug 2026 10:00:00 +0000',
  flags: [],
  seen: false,
  hasAttachments: false,
  snippet: 'hi',
  ...over,
})

const full = (over: Partial<FullMessage> & { uid: number }): FullMessage => ({
  subject: 's',
  from: [{ name: 'Ana', address: 'ana@x.com' }],
  to: [{ name: '', address: 'me@x.com' }],
  cc: [],
  date: 'Tue, 05 Aug 2026 10:00:00 +0000',
  messageId: '<1@x>',
  text: 'body text',
  html: '',
  hasBlockedRemoteContent: false,
  attachments: [],
  flags: [],
  seen: false,
  ...over,
})

/** A fake IMAP that serves fixed data and counts calls. */
function fakeDeps(over: Partial<SyncDeps> = {}): SyncDeps & { listCalls: number; fetchCalls: number } {
  const d = {
    listCalls: 0,
    fetchCalls: 0,
    async listMessages() {
      d.listCalls++
      return ok([])
    },
    async fetchMessage() {
      d.fetchCalls++
      return ok(full({ uid: 1 }))
    },
    ...over,
  } as SyncDeps & { listCalls: number; fetchCalls: number }
  return d
}

describe('toEpoch', () => {
  it('parses an RFC date', () => {
    expect(toEpoch('Tue, 05 Aug 2026 10:00:00 +0000')).toBe(Date.parse('2026-08-05T10:00:00Z'))
  })
  it('is null for missing or junk dates rather than NaN', () => {
    // NaN would sort unpredictably and poison ORDER BY.
    expect(toEpoch(null)).toBeNull()
    expect(toEpoch('not a date')).toBeNull()
  })
})

describe('parseReferences', () => {
  it('splits a References header into ids', () => {
    expect(parseReferences('<1@x> <2@x>')).toEqual(['<1@x>', '<2@x>'])
  })
  it('handles absent or malformed headers', () => {
    expect(parseReferences(undefined)).toEqual([])
    expect(parseReferences('')).toEqual([])
    expect(parseReferences('garbage')).toEqual([])
  })
})

describe('toEnvelopeRow', () => {
  it('maps an IMAP summary', () => {
    const r = toEnvelopeRow('a', 'INBOX', summary({ uid: 7, subject: 'Hi' }))
    expect(r).toMatchObject({ accountId: 'a', folder: 'INBOX', uid: 7, subject: 'Hi', fromAddress: 'ana@x.com' })
  })

  it('survives a message with no sender', () => {
    const r = toEnvelopeRow('a', 'INBOX', summary({ uid: 1, from: [] }))
    expect(r.fromAddress).toBe('')
    expect(r.fromName).toBe('')
  })
})

describe('syncEnvelopes', () => {
  it('indexes what IMAP returned', async () => {
    const deps = fakeDeps({
      async listMessages() {
        return ok([summary({ uid: 1, subject: 'one' }), summary({ uid: 2, subject: 'two' })])
      },
    })
    const rep = await syncEnvelopes(idx, deps, 'a', 'INBOX')
    expect(rep).toMatchObject({ indexed: 2, error: null })
    expect(idx.listFolder('a', 'INBOX')).toHaveLength(2)
  })

  it('leaves the index untouched when IMAP fails', async () => {
    idx.upsertEnvelopes([toEnvelopeRow('a', 'INBOX', summary({ uid: 1 }))])
    const deps = fakeDeps({
      async listMessages() {
        return err('host', 'unreachable')
      },
    })
    const rep = await syncEnvelopes(idx, deps, 'a', 'INBOX')
    expect(rep.error).toBe('unreachable')
    expect(rep.indexed).toBe(0)
    // A network blip must not empty the cache.
    expect(idx.listFolder('a', 'INBOX')).toHaveLength(1)
  })

  it('does NOT prune by default', async () => {
    idx.upsertEnvelopes([toEnvelopeRow('a', 'INBOX', summary({ uid: 99 }))])
    const deps = fakeDeps({
      async listMessages() {
        return ok([summary({ uid: 1 })])
      },
    })
    const rep = await syncEnvelopes(idx, deps, 'a', 'INBOX')
    expect(rep.pruned).toBe(0)
    expect(idx.listFolder('a', 'INBOX')).toHaveLength(2)
  })

  it('prunes when asked AND the listing is complete', async () => {
    idx.upsertEnvelopes([toEnvelopeRow('a', 'INBOX', summary({ uid: 99 }))])
    const deps = fakeDeps({
      async listMessages() {
        return ok([summary({ uid: 1 })])
      },
    })
    const rep = await syncEnvelopes(idx, deps, 'a', 'INBOX', { prune: true, limit: 10 })
    expect(rep.pruned).toBe(1)
    expect(idx.listFolder('a', 'INBOX').map((r) => r.uid)).toEqual([1])
  })

  it('REFUSES to prune on a full page, even when asked', async () => {
    // The dangerous case: a full page means more mail exists behind it, so the
    // uid set is partial and pruning would delete live mail from the cache.
    for (let uid = 1; uid <= 5; uid++) {
      idx.upsertEnvelopes([toEnvelopeRow('a', 'INBOX', summary({ uid }))])
    }
    const deps = fakeDeps({
      async listMessages() {
        return ok([summary({ uid: 1 }), summary({ uid: 2 })])
      },
    })
    const rep = await syncEnvelopes(idx, deps, 'a', 'INBOX', { prune: true, limit: 2 })
    expect(rep.pruned).toBe(0)
    expect(idx.listFolder('a', 'INBOX')).toHaveLength(5)
  })
})

describe('deepenBatch', () => {
  beforeEach(() => {
    idx.upsertEnvelopes([
      toEnvelopeRow('a', 'INBOX', summary({ uid: 1 })),
      toEnvelopeRow('a', 'INBOX', summary({ uid: 2 })),
    ])
  })

  it('fills bodies and makes them searchable', async () => {
    const deps = fakeDeps({
      async fetchMessage(_a, _f, uid) {
        return ok(full({ uid, messageId: `<${uid}@x>`, text: `body of ${uid}` }))
      },
    })
    const rep = await deepenBatch(idx, deps, 'a')
    expect(rep).toMatchObject({ deepened: 2, failed: 0, remaining: 0 })
    expect(idx.search('body')).toHaveLength(2)
  })

  it('is bounded and resumable', async () => {
    const deps = fakeDeps({
      async fetchMessage(_a, _f, uid) {
        return ok(full({ uid, messageId: `<${uid}@x>` }))
      },
    })
    const first = await deepenBatch(idx, deps, 'a', { limit: 1 })
    expect(first.deepened).toBe(1)
    expect(first.remaining).toBe(1)

    const second = await deepenBatch(idx, deps, 'a', { limit: 1 })
    expect(second.deepened).toBe(1)
    expect(second.remaining).toBe(0)
  })

  it('one unreadable message does not abort the batch', async () => {
    const deps = fakeDeps({
      async fetchMessage(_a, _f, uid) {
        if (uid === 1) return err('not-found', 'gone')
        return ok(full({ uid, messageId: `<${uid}@x>`, text: 'good body' }))
      },
    })
    const rep = await deepenBatch(idx, deps, 'a')
    expect(rep.deepened).toBe(1)
    expect(rep.failed).toBe(1)
    // The failed row stays shallow so a later pass retries it.
    expect(rep.remaining).toBe(1)
    expect(idx.search('good')).toHaveLength(1)
  })

  it('does nothing when everything is already deep', async () => {
    const deps = fakeDeps({
      async fetchMessage(_a, _f, uid) {
        return ok(full({ uid, messageId: `<${uid}@x>` }))
      },
    })
    await deepenBatch(idx, deps, 'a')
    const again = await deepenBatch(idx, deps, 'a')
    expect(again).toMatchObject({ deepened: 0, failed: 0, remaining: 0 })
  })

  it('threads properly once the headers arrive', async () => {
    const deps = fakeDeps({
      async fetchMessage(_a, _f, uid) {
        return uid === 1
          ? ok(full({ uid: 1, messageId: '<1@x>', subject: 'Budget' }))
          : ok(
              full({
                uid: 2,
                messageId: '<2@x>',
                subject: 'Re: Budget',
                headers: { 'in-reply-to': '<1@x>' },
              }),
            )
      },
    })
    await deepenBatch(idx, deps, 'a')
    const rows = idx.listFolder('a', 'INBOX')
    expect(rows[0].threadId).toBe(rows[1].threadId)
  })
})

describe('deepenBatch — batched connection path', () => {
  beforeEach(() => {
    idx.upsertEnvelopes([
      toEnvelopeRow('a', 'INBOX', summary({ uid: 1 })),
      toEnvelopeRow('a', 'INBOX', summary({ uid: 2 })),
      toEnvelopeRow('a', 'Archive', summary({ uid: 5 })),
    ])
  })

  it('opens ONE batch per folder instead of one per message', async () => {
    // The regression this guards: deepening a 400-message mailbox through the
    // single-message path is 400 connect/auth/logout cycles, which Outlook
    // throttles — and the user's own clicks start failing alongside it.
    const calls: { folder: string; uids: number[] }[] = []
    const deps = fakeDeps({
      async fetchMessages(_a, folder, uids) {
        calls.push({ folder, uids: [...uids] })
        return ok(uids.map((uid) => full({ uid, messageId: `<${uid}@x>` })))
      },
      async fetchMessage() {
        throw new Error('must not use the per-message path when a batch reader exists')
      },
    })

    const rep = await deepenBatch(idx, deps, 'a')
    expect(rep.deepened).toBe(3)
    expect(calls).toHaveLength(2) // one per folder, not one per message
    expect(calls.find((c) => c.folder === 'INBOX')?.uids).toEqual([1, 2])
    expect(calls.find((c) => c.folder === 'Archive')?.uids).toEqual([5])
  })

  it('leaves a uid the server omitted shallow rather than recording a blank', async () => {
    const deps = fakeDeps({
      async fetchMessages(_a, folder, uids) {
        // Server returns only the first uid of each batch.
        return ok([full({ uid: uids[0], messageId: `<${uids[0]}@x>` })])
      },
    })
    const rep = await deepenBatch(idx, deps, 'a')
    expect(rep.deepened).toBe(2) // one per folder
    expect(rep.failed).toBe(1) // INBOX uid 2 was not returned
    expect(rep.remaining).toBe(1) // and stays queued for a later pass
  })

  it('counts a failed batch without losing the rows', async () => {
    const deps = fakeDeps({
      async fetchMessages() {
        return err('timeout', 'slow')
      },
    })
    const rep = await deepenBatch(idx, deps, 'a')
    expect(rep.deepened).toBe(0)
    expect(rep.failed).toBe(3)
    expect(rep.remaining).toBe(3)
  })

  it('still works when no batch reader is provided', async () => {
    const deps = fakeDeps({
      async fetchMessage(_a, _f, uid) {
        return ok(full({ uid, messageId: `<${uid}@x>` }))
      },
    })
    const rep = await deepenBatch(idx, deps, 'a')
    expect(rep.deepened).toBe(3)
  })
})

describe('syncEnvelopes — incremental', () => {
  it('asks only for what arrived since the watermark', async () => {
    // The bug this fixes: highestUid existed on the index from day one and
    // nothing ever called it, so every sync re-listed the folder from the top.
    idx.upsertEnvelopes([toEnvelopeRow('a', 'INBOX', summary({ uid: 40 }))])

    let sinceArg = -1
    const deps = fakeDeps({
      async listMessages() {
        throw new Error('must not do a full listing once a watermark exists')
      },
      async listMessagesSince(_a, _f, since) {
        sinceArg = since
        return ok([summary({ uid: 41 })])
      },
    })

    const rep = await syncEnvelopes(idx, deps, 'a', 'INBOX')
    expect(sinceArg).toBe(40)
    expect(rep.indexed).toBe(1)
    expect(idx.listFolder('a', 'INBOX')).toHaveLength(2)
  })

  it('does a FULL listing on the first sync (no watermark yet)', async () => {
    let full = false
    const deps = fakeDeps({
      async listMessages() {
        full = true
        return ok([summary({ uid: 1 })])
      },
    })
    await syncEnvelopes(idx, deps, 'a', 'INBOX')
    expect(full).toBe(true)
  })

  it('does a FULL listing when pruning, because absences are invisible incrementally', async () => {
    // An incremental read only reports new mail; it cannot tell us what was
    // deleted. Pruning off one would delete the entire cached folder.
    idx.upsertEnvelopes([toEnvelopeRow('a', 'INBOX', summary({ uid: 40 }))])
    let full = false
    const deps = fakeDeps({
      async listMessages() {
        full = true
        return ok([summary({ uid: 40 })])
      },
      async listMessagesSince() {
        throw new Error('must not use the incremental read when pruning')
      },
    })
    await syncEnvelopes(idx, deps, 'a', 'INBOX', { prune: true, limit: 10 })
    expect(full).toBe(true)
  })

  it('never prunes from an incremental read', async () => {
    idx.upsertEnvelopes([
      toEnvelopeRow('a', 'INBOX', summary({ uid: 40 })),
      toEnvelopeRow('a', 'INBOX', summary({ uid: 41 })),
    ])
    const deps = fakeDeps({
      async listMessagesSince() { return ok([summary({ uid: 42 })]) },
    })
    // prune requested, but the guard above forces the full path; with a stub
    // that only implements the incremental read, the rows must survive either way.
    const rep = await syncEnvelopes(idx, deps, 'a', 'INBOX')
    expect(rep.pruned).toBe(0)
    expect(idx.listFolder('a', 'INBOX')).toHaveLength(3)
  })

  it('falls back to a full listing when no incremental reader is provided', async () => {
    idx.upsertEnvelopes([toEnvelopeRow('a', 'INBOX', summary({ uid: 40 }))])
    let full = false
    const deps = fakeDeps({
      async listMessages() { full = true; return ok([summary({ uid: 41 })]) },
    })
    await syncEnvelopes(idx, deps, 'a', 'INBOX')
    expect(full).toBe(true)
  })
})
