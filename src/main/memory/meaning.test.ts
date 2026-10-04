import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { remember, correct, recallMeaning, embedPending, setEmbedder, embedderStatus, closeAllStores, workspaceDbPath, type MemoryContext } from './memory-service'
import { MemoryStore } from './memory-store'
import type { Embedder, EmbedStatus } from './embedder'

/**
 * Meaning recall without the model: a fake embedder places texts by topic word,
 * so the rules (store, fuse, gate, never wait) are tested on their own. The
 * real model is measured in eval/recall.eval.test.ts.
 */
const TOPICS = ['budget', 'access', 'font', 'travel']
function fake(state: EmbedStatus = 'ready'): Embedder & { calls: number; set(s: EmbedStatus): void } {
  const vec = (t: string): Float32Array => {
    const v = new Float32Array(TOPICS.length + 1).fill(0.05)
    const l = t.toLowerCase()
    TOPICS.forEach((k, i) => { if (l.includes(k) || (k === 'access' && l.includes('barrierefrei'))) v[i] = 1 })
    const n = Math.hypot(...v)
    return v.map((x) => x / n)
  }
  return {
    model: 'fake@1',
    calls: 0,
    status: () => state,
    set(s) { state = s },
    async embed(texts) { this.calls++; return state === 'failed' ? null : texts.map(vec) },
  }
}

let tmp: string
let ctx: MemoryContext
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-meaning-'))
  ctx = { root: path.join(tmp, 'ws'), userDataDir: path.join(tmp, 'user') }
})
afterEach(() => {
  setEmbedder(null)
  closeAllStores()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('meaning vectors in the store', () => {
  it('stores one per live memory, keyed to the model that made it', async () => {
    const a = remember(ctx, { kind: 'fact', text: 'Launch budget is 9,500', source: 's' })
    remember(ctx, { kind: 'fact', text: 'Hero font is Instrument Serif', source: 's' })
    setEmbedder(fake())
    expect(await embedPending(ctx)).toBe(2)
    expect(await embedPending(ctx)).toBe(0) // nothing left to do
    const store = new MemoryStore(workspaceDbPath(ctx.root!))
    expect(store.unembedded('fake@1')).toHaveLength(0)
    expect(store.unembedded('another@2')).toHaveLength(2) // a new model re-embeds
    const q = new Float32Array([1, 0, 0, 0, 0])
    expect(store.nearest(q, 'fake@1', 1)[0].m.id).toBe(a.id)
    expect(store.nearest(q, 'another@2', 5)).toHaveLength(0) // spaces never mix
    store.close()
  })

  it('a corrected memory is found by its new text only', async () => {
    const old = remember(ctx, { kind: 'fact', text: 'The trip is to Lisbon', source: 's' })
    setEmbedder(fake())
    await embedPending(ctx)
    const now = correct(ctx, old.id, 'The travel goes to Porto now', 'you')!
    await embedPending(ctx)
    const got = await recallMeaning(ctx, 'travel plans')
    expect(got.map((m) => m.id)).toEqual([now.id])
  })
})

describe('recall by words and meaning', () => {
  it('adds what is meant to what the words found (a German note for an English question)', async () => {
    remember(ctx, { kind: 'fact', text: 'Next step: an access review of the page', source: 's' })
    remember(ctx, { kind: 'fact', text: 'Wir sollten prüfen, ob die Seite barrierefrei ist', source: 's' })
    setEmbedder(fake())
    await embedPending(ctx)
    const got = (await recallMeaning(ctx, 'What about access for everyone?')).map((m) => m.text)
    expect(got).toContain('Next step: an access review of the page')
    expect(got).toContain('Wir sollten prüfen, ob die Seite barrierefrei ist')
  })

  it('never starts from nothing: a task sharing no word with any memory is told nothing', async () => {
    remember(ctx, { kind: 'fact', text: 'Launch budget is 9,500', source: 's' })
    setEmbedder(fake())
    await embedPending(ctx)
    expect(await recallMeaning(ctx, 'Write a haiku about autumn leaves')).toEqual([])
  })

  it('never makes a run wait for a model that is not ready: words now, warm-up behind', async () => {
    remember(ctx, { kind: 'fact', text: 'Launch budget is 9,500', source: 's' })
    const e = fake('idle')
    setEmbedder(e)
    const got = await recallMeaning(ctx, 'launch budget')
    expect(got.map((m) => m.text)).toEqual(['Launch budget is 9,500'])
    await new Promise((r) => setTimeout(r, 20))
    expect(e.calls).toBeGreaterThan(0) // the warm-up started
  })

  it('is plain word recall with no model, and says so', async () => {
    remember(ctx, { kind: 'fact', text: 'Launch budget is 9,500', source: 's' })
    expect(embedderStatus()).toBe('off')
    expect((await recallMeaning(ctx, 'budget')).length).toBe(1)
  })
})
