import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { remember, list, history, confirm, closeAllStores, type MemoryContext } from './memory-service'
import { tidy, tidyDue, lastTidy, LET_GO_AFTER_MS, TIDY_EVERY_MS } from './tidy'

let tmp: string
let ctx: MemoryContext
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-tidy-'))
  ctx = { root: path.join(tmp, 'ws'), userDataDir: path.join(tmp, 'user') }
})
afterEach(() => {
  closeAllStores()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('the daily tidy', () => {
  it('folds exact repeats into the most trusted one, keeping the other as its history', async () => {
    // A repeat of the same kind is merged when written; across kinds it reaches the tidy.
    const agents = remember(ctx, { kind: 'fact', text: 'Always send decks as PDF', source: 'run 1', author: 'agent' })
    const yours = remember(ctx, { kind: 'preference', text: 'always send decks as PDF!', source: 'you', author: 'you' })
    const r = await tidy(ctx)
    expect(r.folded).toBe(1)
    const live = list(ctx).filter((m) => m.text.toLowerCase().includes('decks'))
    expect(live.map((m) => m.id)).toEqual([yours.id])
    expect(live[0].reinforced).toBe(2)
    expect(history(ctx, yours.id).map((m) => m.id)).toEqual([agents.id])
  })

  it('never folds memories that only look alike (other object, other number)', async () => {
    remember(ctx, { kind: 'preference', text: 'Always send decks as PDF', source: 's', author: 'you' })
    remember(ctx, { kind: 'preference', text: 'Always send invoices as PDF', source: 's', author: 'you' })
    remember(ctx, { kind: 'fact', text: 'The launch budget is 8,000', source: 's', author: 'you' })
    remember(ctx, { kind: 'fact', text: 'The launch budget is 9,500', source: 's', author: 'you' })
    expect((await tidy(ctx)).folded).toBe(0)
    expect(list(ctx)).toHaveLength(4)
  })

  it('lets an agent proposal nobody kept for 30 days go, and never the person’s own or a kept one', async () => {
    const ignored = remember(ctx, { kind: 'fact', text: 'An agent noticed this once', source: 'run', author: 'agent' })
    const kept = remember(ctx, { kind: 'fact', text: 'An agent noticed this and it was kept', source: 'run', author: 'agent' })
    confirm(ctx, kept.id)
    const mine = remember(ctx, { kind: 'fact', text: 'The person said this', source: 'you', author: 'you' })
    expect((await tidy(ctx, { now: Date.now() + 5 * 86_400_000 })).letGo).toBe(0) // not yet
    const r = await tidy(ctx, { now: Date.now() + LET_GO_AFTER_MS + 60_000 })
    expect(r.letGo).toBe(1)
    const ids = list(ctx).map((m) => m.id)
    expect(ids).not.toContain(ignored.id)
    expect(ids).toEqual(expect.arrayContaining([kept.id, mine.id]))
  })

  it('offers decisions noted in Pulse since the last tidy, unconfirmed, at most five, none already known', async () => {
    remember(ctx, { kind: 'decision', text: 'Chose CalDAV over Google for sovereignty', source: 's', author: 'you' })
    const now = Date.now()
    const outside = [
      { text: 'Too old to bring in, decided long ago', at: now - 30 * 86_400_000 },
      { text: 'Chose CalDAV over Google for sovereignty', at: now - 1000 },
      ...[1, 2, 3, 4, 5, 6].map((i) => ({ text: `Decision number ${i} about the roadmap`, at: now - 10_000 + i })),
    ]
    const r = await tidy(ctx, { outside })
    expect(r.imported).toBe(5)
    const props = list(ctx, { unconfirmed: true })
    expect(props.every((m) => m.kind === 'decision' && m.author === 'agent' && m.source === 'noted in Pulse')).toBe(true)
    expect(props.map((m) => m.text)).not.toContain('Too old to bring in, decided long ago')
    expect((await tidy(ctx, { outside })).imported).toBe(0) // the next tidy does not offer them again
  })

  it('runs once a day and remembers what it did', async () => {
    expect(tidyDue(ctx)).toBe(true)
    const r = await tidy(ctx)
    expect(lastTidy(ctx)).toEqual(r)
    expect(tidyDue(ctx, r.at + 60_000)).toBe(false)
    expect(tidyDue(ctx, r.at + TIDY_EVERY_MS)).toBe(true)
    expect(tidyDue({ root: null, userDataDir: ctx.userDataDir })).toBe(false)
  })
})
