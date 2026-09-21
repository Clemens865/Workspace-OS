/**
 * The store behavior that filled the cockpit with junk: triage cards only ever
 * accumulated, so `needs-draft` cards from old, weaker classifier runs lived in
 * localStorage forever. A fresh scan is now the authority for its folder —
 * these tests pin the retirement rules, especially the empty-scan case (a
 * clean inbox must CLEAR fossils, not preserve them).
 */

import { describe, it, expect } from 'vitest'
import { MailReviewStore, type TriageHit } from './mailReviewStore'

const hit = (uid: number, folder = 'INBOX'): TriageHit => ({
  folder,
  uid,
  subject: `mail ${uid}`,
  from: { name: 'Anna', address: 'anna@example.com' },
  reason: 'Unread, addressed to you',
  score: 80,
})

const memory = () => {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

const store = () => new MailReviewStore(memory(), () => 1_000)

describe('ingestTriage reconciliation', () => {
  it('an empty re-scan retires needs-draft fossils from the scanned folder', () => {
    const s = store()
    s.ingestTriage('acc', 'INBOX', [hit(1), hit(2)])
    expect(s.getSnapshot().cards).toHaveLength(2)
    s.ingestTriage('acc', 'INBOX', [])
    expect(s.getSnapshot().cards).toHaveLength(0)
  })

  it('a re-scan keeps hits that are still present and drops the rest', () => {
    const s = store()
    s.ingestTriage('acc', 'INBOX', [hit(1), hit(2)])
    s.ingestTriage('acc', 'INBOX', [hit(2)])
    expect(s.getSnapshot().cards.map((c) => c.source.uid)).toEqual([2])
  })

  it('scanning one folder never touches another folder or another account', () => {
    const s = store()
    s.ingestTriage('acc', 'INBOX', [hit(1)])
    s.ingestTriage('acc', 'Archive', [hit(9, 'Archive')])
    s.ingestTriage('other', 'INBOX', [hit(5)])
    s.ingestTriage('acc', 'Archive', [])
    const left = s.getSnapshot().cards.map((c) => c.id).sort()
    expect(left).toEqual(['acc:INBOX:1', 'other:INBOX:5'])
  })

  it('cards carrying work (drafting / drafted) survive an empty re-scan', () => {
    const s = store()
    s.ingestTriage('acc', 'INBOX', [hit(1), hit(2)])
    s.markDrafting('acc:INBOX:1')
    s.setDraft('acc:INBOX:2', 'Dear Anna, …', false)
    s.ingestTriage('acc', 'INBOX', [])
    const statuses = s.getSnapshot().cards.map((c) => c.status).sort()
    expect(statuses).toEqual(['drafted', 'drafting'])
  })
})
