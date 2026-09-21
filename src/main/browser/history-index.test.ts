import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  HistoryIndex,
  isRecordable,
  recencyWeight,
  frecency,
  escapeLike,
  MAX_TEXT,
} from './history-index'

const DAY = 86_400_000
const NOW = 1_800_000_000_000

let dir: string
let idx: HistoryIndex

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-hist-'))
  idx = new HistoryIndex(path.join(dir, 'history.db'))
})
afterEach(() => {
  idx.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('what is worth recording', () => {
  it('records ordinary web pages', () => {
    expect(isRecordable('https://example.com/a')).toBe(true)
    expect(isRecordable('http://localhost:3000/x')).toBe(true)
  })

  it('refuses about:blank — every tab mounts there, so it would flood history', () => {
    expect(isRecordable('about:blank')).toBe(false)
  })

  it('refuses schemes that are not pages', () => {
    for (const u of ['data:text/html,x', 'file:///etc/passwd', 'chrome-error://x', '']) {
      expect(isRecordable(u)).toBe(false)
    }
  })

  it('a refused url never reaches the store', () => {
    idx.recordVisit({ url: 'about:blank', title: 'blank', visitedAt: NOW })
    expect(idx.count()).toBe(0)
  })
})

describe('visits', () => {
  it('records a page and finds it by its TEXT, not just its title', () => {
    idx.recordVisit({
      url: 'https://acme.com/pricing',
      title: 'Acme',
      text: 'Our enterprise tier costs 4200 euro per seat annually.',
      visitedAt: NOW,
    })
    // The whole point: the word is in the body, not the title or the url.
    const hits = idx.search('enterprise tier')
    expect(hits).toHaveLength(1)
    expect(hits[0].url).toBe('https://acme.com/pricing')
  })

  it('counts repeat visits on ONE row rather than growing a log', () => {
    for (let i = 0; i < 3; i++) {
      idx.recordVisit({ url: 'https://a.com/', title: 'A', visitedAt: NOW + i * 1000 })
    }
    expect(idx.count()).toBe(1)
    expect(idx.recent()[0].visitCount).toBe(3)
  })

  it('a later visit WITHOUT text never wipes text an earlier visit indexed', () => {
    idx.recordVisit({ url: 'https://a.com/', title: 'A', text: 'quarterly revenue figures', visitedAt: NOW })
    // A background re-navigation with no extraction — the mail index paid for
    // this exact case with a silently un-indexed mailbox.
    idx.recordVisit({ url: 'https://a.com/', title: 'A', visitedAt: NOW + 1000 })
    expect(idx.search('quarterly revenue')).toHaveLength(1)
  })

  it('keeps the previous title when a visit brings none', () => {
    idx.recordVisit({ url: 'https://a.com/', title: 'Real Title', visitedAt: NOW })
    idx.recordVisit({ url: 'https://a.com/', visitedAt: NOW + 1 })
    expect(idx.recent()[0].title).toBe('Real Title')
  })

  it('caps stored text so one pathological page cannot dominate the database', () => {
    idx.recordVisit({ url: 'https://big.com/', text: 'x'.repeat(MAX_TEXT * 2), visitedAt: NOW })
    expect(idx.recent()[0].snippet.length).toBeLessThanOrEqual(240)
  })
})

describe('ranking', () => {
  it('weights today above last week above last year', () => {
    expect(recencyWeight(NOW, NOW)).toBeGreaterThan(recencyWeight(NOW - 3 * DAY, NOW))
    expect(recencyWeight(NOW - 3 * DAY, NOW)).toBeGreaterThan(recencyWeight(NOW - 60 * DAY, NOW))
    expect(recencyWeight(NOW - 60 * DAY, NOW)).toBeGreaterThan(recencyWeight(NOW - 900 * DAY, NOW))
  })

  it('twice today beats fifty times last year', () => {
    const fresh = frecency(2, NOW, false, NOW)
    const stale = frecency(50, NOW - 400 * DAY, false, NOW)
    expect(fresh).toBeGreaterThan(stale)
  })

  it('a bookmark outranks incidental history', () => {
    expect(frecency(1, NOW, true, NOW)).toBeGreaterThan(frecency(5, NOW, false, NOW))
  })

  it('suggests by url or title prefix — not by body text', () => {
    idx.recordVisit({ url: 'https://linkedin.com/', title: 'LinkedIn', visitedAt: NOW })
    idx.recordVisit({ url: 'https://blog.com/x', title: 'Post', text: 'a rant about linkedin', visitedAt: NOW })
    const s = idx.suggest('linked', NOW)
    // Typing three letters must not surface every page that mentions the word.
    expect(s.map((x) => x.url)).toEqual(['https://linkedin.com/'])
  })

  it('an empty box offers the places you actually go', () => {
    idx.recordVisit({ url: 'https://rare.com/', visitedAt: NOW - 40 * DAY })
    idx.recordVisit({ url: 'https://daily.com/', visitedAt: NOW })
    idx.star('https://starred.com/', NOW)
    const s = idx.suggest('', NOW)
    expect(s[0].url).toBe('https://starred.com/')
    expect(s.map((x) => x.url)).toContain('https://daily.com/')
  })

  it('labels each suggestion so the UI can show the right icon', () => {
    idx.recordVisit({ url: 'https://h.com/', visitedAt: NOW })
    idx.star('https://b.com/', NOW)
    const kinds = Object.fromEntries(idx.suggest('', NOW).map((s) => [s.url, s.kind]))
    expect(kinds['https://b.com/']).toBe('bookmark')
    expect(kinds['https://h.com/']).toBe('history')
  })
})

describe('bookmarks are history rows, not a second system', () => {
  it('starring a visited page keeps its indexed text searchable', () => {
    idx.recordVisit({ url: 'https://a.com/', title: 'A', text: 'kubernetes migration notes', visitedAt: NOW })
    idx.star('https://a.com/', NOW)
    expect(idx.isStarred('https://a.com/')).toBe(true)
    // Free consequence of one store: bookmarks are full-text searchable.
    expect(idx.search('kubernetes migration')).toHaveLength(1)
  })

  it('starring a never-visited url still works', () => {
    idx.star('https://new.com/', NOW, 'New')
    expect(idx.bookmarks().map((b) => b.url)).toEqual(['https://new.com/'])
  })

  it('unstarring keeps the page in history', () => {
    idx.recordVisit({ url: 'https://a.com/', visitedAt: NOW })
    idx.star('https://a.com/', NOW)
    idx.unstar('https://a.com/')
    expect(idx.bookmarks()).toHaveLength(0)
    expect(idx.recent()).toHaveLength(1)
  })

  it('refuses to bookmark something that is not a page', () => {
    idx.star('about:blank', NOW)
    expect(idx.bookmarks()).toHaveLength(0)
  })
})

describe('deletion is real', () => {
  it('forgetting a page removes its TEXT, not just its listing', () => {
    idx.recordVisit({ url: 'https://secret.com/', title: 'S', text: 'confidential merger memo', visitedAt: NOW })
    idx.forget('https://secret.com/')
    expect(idx.recent()).toHaveLength(0)
    // The failure that would matter: gone from the list, still findable.
    expect(idx.search('confidential merger')).toHaveLength(0)
  })

  it('forgetting deletes a STARRED page too — the user asked for it to be gone', () => {
    idx.recordVisit({ url: 'https://a.com/', text: 'sensitive', visitedAt: NOW })
    idx.star('https://a.com/', NOW)
    idx.forget('https://a.com/')
    expect(idx.count()).toBe(0)
    expect(idx.search('sensitive')).toHaveLength(0)
  })

  it('clearing a time range leaves older pages alone', () => {
    idx.recordVisit({ url: 'https://old.com/', text: 'old page', visitedAt: NOW - 10 * DAY })
    idx.recordVisit({ url: 'https://new.com/', text: 'new page', visitedAt: NOW })
    expect(idx.forgetSince(NOW - DAY)).toBe(1)
    expect(idx.recent().map((r) => r.url)).toEqual(['https://old.com/'])
    expect(idx.search('new page')).toHaveLength(0)
    expect(idx.search('old page')).toHaveLength(1)
  })

  it('clear() empties the FTS shadow as well', () => {
    idx.recordVisit({ url: 'https://a.com/', text: 'anything at all', visitedAt: NOW })
    idx.clear()
    expect(idx.count()).toBe(0)
    expect(idx.search('anything')).toHaveLength(0)
  })
})

describe('robustness', () => {
  it('a malformed search degrades to no results rather than throwing', () => {
    idx.recordVisit({ url: 'https://a.com/', text: 'hello', visitedAt: NOW })
    for (const q of ['"', '*', 'AND OR', '((', 'NEAR/']) {
      expect(() => idx.search(q)).not.toThrow()
    }
  })

  it('an empty query returns nothing rather than everything', () => {
    idx.recordVisit({ url: 'https://a.com/', text: 'hello', visitedAt: NOW })
    expect(idx.search('   ')).toHaveLength(0)
  })

  it('escapes LIKE wildcards so a url cannot broaden its own match', () => {
    expect(escapeLike('100%_x')).toBe('100\\%\\_x')
    idx.recordVisit({ url: 'https://a.com/real', visitedAt: NOW })
    // "%" must be a literal, not "match anything".
    expect(idx.suggest('%', NOW)).toHaveLength(0)
  })

  it('survives a reopen — the index is on disk, not in memory', () => {
    const p = path.join(dir, 'persist.db')
    const a = new HistoryIndex(p)
    a.recordVisit({ url: 'https://a.com/', text: 'durable content', visitedAt: NOW })
    a.close()
    const b = new HistoryIndex(p)
    expect(b.search('durable content')).toHaveLength(1)
    b.close()
  })
})
