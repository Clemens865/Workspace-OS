import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { remember, correct, forRun, closeAllStores, type MemoryContext } from '../memory-service'
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
 *
 * The floors below are the measured numbers; they only move up.
 */

interface Q { id: string; class: string; workspace: string; text: string; expected: string[]; notAsCurrent: string[] }
interface M { id: string; kind: string; workspace: string; role: string; supersedes?: string[]; untrusted?: boolean; text: string }
const set = JSON.parse(fs.readFileSync(path.join(__dirname, 'recall-v1.json'), 'utf8')) as { memories: M[]; queries: Q[] }
const K = 5
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
  closeAllStores()
  fs.rmSync(tmp, { recursive: true, force: true })
})

function run(q: Q): { profile: string[]; now: string[]; earlier: string[] } {
  // Exactly what a run is told: the standing preferences, the top K that fit, and their earlier versions.
  const mem = forRun(ctxs.get(q.workspace)!, q.text, K)
  const ids = (list: { id: string }[]): string[] => list.map((m) => chunkOf.get(m.id) ?? '?')
  return { profile: ids(mem.profile), now: ids(mem.recalled), earlier: [...mem.earlier.values()].flatMap(ids) }
}

describe('memory recall (TerminalOS EN/DE set)', () => {
  it('finds what each question needs', () => {
    const rows = set.queries.map((q) => {
      const { profile, now, earlier } = run(q)
      const seen = new Set([...profile, ...now, ...earlier])
      const answerable = q.expected.length > 0
      return {
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
      }
    })
    const graded = rows.filter((r) => r.full !== null)
    const unknown = rows.filter((r) => r.quiet !== null)
    const pct = (n: number, d: number): number => Math.round((n / d) * 1000) / 10
    const report = {
      full: pct(graded.filter((r) => r.full).length, graded.length),
      partial: pct(graded.reduce((a, r) => a + (r.part ?? 0), 0), graded.length),
      stale: pct(rows.filter((r) => r.stale.length).length, rows.length),
      quiet: `${unknown.filter((r) => r.quiet).length}/${unknown.length}`,
      noise: Math.round((rows.reduce((a, r) => a + r.noise, 0) / rows.length) * 10) / 10,
    }
    console.log(`\nrecall@${K}: full ${report.full}% · partial ${report.partial}% · stale ${report.stale}% · quiet ${report.quiet} · noise ${report.noise}/question`)
    for (const r of rows)
      console.log(
        `  ${r.id} ${r.class.padEnd(22)} ${r.full === null ? (r.quiet ? 'quiet' : 'NOISY') : r.full ? 'ok   ' : 'MISS '}${r.stale.length ? ` stale:${r.stale}` : ''}  now=${r.now.join(',')}${r.earlier.length ? ` earlier=${r.earlier.join(',')}` : ''}`,
      )
    // Measured 2026-10-04 (word search; before: full 66.7%, quiet 0/4, about 4
    // unrelated memories per question, 3 while question words still counted). The four
    // still missed (q03, q04, q06, q11) are paraphrases and German↔English: only
    // meaning-based search finds those. quiet stays 0/4 for any word search; the
    // run's rule "never present something as remembered that is not listed" is
    // what keeps an answer honest there.
    expect(report.full).toBeGreaterThanOrEqual(81)
    expect(report.stale).toBeLessThanOrEqual(8)
    expect(report.noise).toBeLessThanOrEqual(2.5)
  })
})
