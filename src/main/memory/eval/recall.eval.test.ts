import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { remember, correct, forRun, closeAllStores, setEmbedder, embedPending, type MemoryContext } from '../memory-service'
import { inProcessEmbedder } from '../embedder'
import type { MemoryKind } from '../memory-store'

/**
 * How well memory recall finds the right thing — measured, not assumed.
 *
 * The set is TerminalOS's draft EN/DE pilot (see recall-v1.json `about`):
 * budgets that change twice, a German remark, a paraphrase, a planted
 * instruction, three workspaces with their own budgets, and questions nothing
 * answers. Each question is scored the way an agent run sees memory: the top 5
 * that fit (`forRun`), the earlier versions shown with them, and the standing
 * preferences every run gets.
 *
 * - full: every expected memory came back
 * - stale: a replaced or out-of-scope memory came back as if current
 * - quiet: a question nothing answers got nothing that claims to fit it
 * - noise: memories per question that fit nothing it needs
 * - off-topic: memories pushed at questions memory has nothing on (must be 0)
 *
 * It runs twice: by words only (no model), then by words and meaning (the local
 * model, downloaded once into ~/.cache/workspace-os/models or WOS_MODEL_CACHE).
 * The floors are the measured numbers; they only move up.
 */

interface Q { id: string; class: string; workspace: string; text: string; expected: string[]; notAsCurrent: string[] }
interface M { id: string; kind: string; workspace: string; role: string; supersedes?: string[]; untrusted?: boolean; text: string }
const set = JSON.parse(fs.readFileSync(path.join(__dirname, 'recall-v1.json'), 'utf8')) as { memories: M[]; queries: Q[] }
const K = 5
const MODEL_CACHE = process.env.WOS_MODEL_CACHE ?? path.join(os.homedir(), '.cache', 'workspace-os', 'models')
let tmp: string
const ctxs = new Map<string, MemoryContext>()
const chunkOf = new Map<string, string>()

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-recall-'))
  const userDataDir = path.join(tmp, 'user')
  const live = new Map<string, string>() // chunk id → memory id
  for (const m of set.memories) {
    if (!ctxs.has(m.workspace)) ctxs.set(m.workspace, { root: path.join(tmp, m.workspace), userDataDir })
    const ctx = ctxs.get(m.workspace)!
    const replaced = (m.supersedes ?? []).filter((c) => live.has(c))
    let id: string
    if (replaced.length) {
      // A correction of everything it replaces: the first becomes it, the rest fold into it.
      id = correct(ctx, live.get(replaced[0])!, m.text, 'you', m.id)!.id
      for (const c of replaced.slice(1)) correct(ctx, live.get(c)!, m.text, 'you', m.id)
    } else {
      id = remember(ctx, { kind: m.kind as MemoryKind, text: m.text, source: m.untrusted ? 'imported page' : m.id, author: m.role === 'user' ? 'you' : 'agent' }).id
    }
    live.set(m.id, id)
    chunkOf.set(id, m.id)
  }
})
afterAll(() => {
  setEmbedder(null)
  closeAllStores()
  fs.rmSync(tmp, { recursive: true, force: true })
})

interface Report { full: number; partial: number; stale: number; quiet: number; noise: number; offTopic: number }

async function measure(label: string): Promise<Report> {
  const rows = []
  for (const q of set.queries) {
    // Exactly what a run is told: the standing preferences, the top K that fit, and their earlier versions.
    const mem = await forRun(ctxs.get(q.workspace)!, q.text, K)
    const ids = (list: { id: string }[]): string[] => list.map((m) => chunkOf.get(m.id) ?? '?')
    const [profile, now, earlier] = [ids(mem.profile), ids(mem.recalled), [...mem.earlier.values()].flatMap(ids)]
    const seen = new Set([...profile, ...now, ...earlier])
    const answerable = q.expected.length > 0
    rows.push({
      id: q.id,
      class: q.class,
      full: answerable ? q.expected.every((e) => seen.has(e)) : null,
      part: answerable ? q.expected.filter((e) => seen.has(e)).length / q.expected.length : null,
      // Earlier versions are shown as earlier, so only a current-looking hit is stale.
      stale: q.notAsCurrent.filter((d) => now.includes(d)),
      quiet: answerable ? null : now.length === 0,
      // Memories that fit nothing the question needs: what crowds an agent's instructions.
      noise: now.filter((c) => !q.expected.includes(c)).length,
      now,
      earlier,
    })
  }
  const graded = rows.filter((r) => r.full !== null)
  const offTopic = rows.filter((r) => r.class === 'off-topic')
  const unknown = rows.filter((r) => r.quiet !== null && r.class !== 'off-topic')
  const pct = (n: number, d: number): number => Math.round((n / d) * 1000) / 10
  const report = {
    full: pct(graded.filter((r) => r.full).length, graded.length),
    partial: pct(graded.reduce((a, r) => a + (r.part ?? 0), 0), graded.length),
    stale: pct(rows.filter((r) => r.stale.length).length, rows.length),
    quiet: unknown.filter((r) => r.quiet).length,
    noise: Math.round((rows.reduce((a, r) => a + r.noise, 0) / rows.length) * 10) / 10,
    // Memories pushed at a question nothing in memory concerns.
    offTopic: offTopic.reduce((a, r) => a + r.now.length, 0),
  }
  console.log(`\n${label} recall@${K}: full ${report.full}% · partial ${report.partial}% · stale ${report.stale}% · quiet ${report.quiet}/${unknown.length} · noise ${report.noise}/question · off-topic ${report.offTopic}`)
  for (const r of rows)
    console.log(
      `  ${r.id} ${r.class.padEnd(22)} ${r.full === null ? (r.quiet ? 'quiet' : 'NOISY') : r.full ? 'ok   ' : 'MISS '}${r.stale.length ? ` stale:${r.stale}` : ''}  now=${r.now.join(',')}${r.earlier.length ? ` earlier=${r.earlier.join(',')}` : ''}`,
    )
  return report
}

describe('memory recall (TerminalOS EN/DE set)', () => {
  it('by words only', async () => {
    setEmbedder(null)
    const r = await measure('words')
    // Measured 2026-10-04 (before: full 66.7%, quiet 0/4, about 4 unrelated
    // memories per question, 3 while question words still counted). quiet stays
    // 0/4 for any word search; the run's rule "never present something as
    // remembered that is not listed" is what keeps an answer honest there.
    expect(r.full).toBeGreaterThanOrEqual(81)
    expect(r.stale).toBeLessThanOrEqual(6.9)
    expect(r.noise).toBeLessThanOrEqual(2.2)
    expect(r.offTopic).toBeLessThanOrEqual(1) // o3: its fix matches fixed in another note
  })

  it('by words and meaning', { timeout: 15 * 60_000 }, async () => {
    const e = inProcessEmbedder(MODEL_CACHE)
    setEmbedder(e)
    for (const ctx of ctxs.values()) await embedPending(ctx)
    expect(e.status(), 'the meaning model did not load (offline on first run?)').toBe('ready')
    const r = await measure('meaning')
    // Measured 2026-10-04 with q8 weights (fp32 scored the same). Meaning finds
    // the German remark for the English question (q06). Letting meaning recall
    // on its own reached 90.5% (q03's pure paraphrase too) but pushed 7 memories
    // at off-topic runs, the planted instruction among them, so meaning only
    // widens what words found. q03/q04/q11 stay missed.
    expect(r.full).toBeGreaterThanOrEqual(85.7)
    expect(r.stale).toBeLessThanOrEqual(6.9)
    expect(r.noise).toBeLessThanOrEqual(2.3)
    expect(r.offTopic).toBeLessThanOrEqual(2)
  })
})
