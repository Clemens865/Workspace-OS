import { nextId } from './bug-log'
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * WOS-010: `analyzeBug` is exercised against a stub engine so the deadline and
 * retry rules can be asserted without waiting minutes or calling a model.
 */
const runs: { systemPrompt: string; timeoutMs: number }[] = []
let replies: string[] = []
let elapsePerRunMs = 0
let now = 1_000_000
vi.mock('../agent/claudeRun', () => ({
  runClaudeJson: async (opts: { systemPrompt: string; timeoutMs: number }) => {
    runs.push({ systemPrompt: opts.systemPrompt, timeoutMs: opts.timeoutMs })
    now += elapsePerRunMs
    return { text: replies.shift() ?? '', timedOut: false }
  },
}))
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildAnalysisPrompt,
  parseAnalysis,
  toReport,
  unanalyzedReport,
  validateAnalysis,
  analyzeBug,
  ideaSystemPrompt,
} from './bug-analyzer'
import type { BugContext, ExistingBug } from './bug-log'

const ctx: BugContext = {
  appVersion: '0.1.0',
  commit: 'abc1234',
  surface: 'canvas',
  openFile: '/w/Untitled.docx',
  os: 'Darwin 25.3.0 (arm64)',
  recentErrors: ['[error] lok: open failed'],
}

const existing: ExistingBug[] = [{ id: 'WOS-001', title: 'Slide thumbnails blank', seen: 1 }]

const good = {
  title: 'Cannot type in a new Word document',
  severity: 'high',
  surface: 'canvas / writer',
  whatHappened: 'No caret, typing does nothing.',
  expected: 'Caret appears, typing inserts text.',
  steps: ['New Word document', 'Click the page', 'Type'],
  suspects: [{ path: 'src/main/office/lokEngine.ts', why: 'post-create focus' }],
  duplicateOf: null,
}

describe('validateAnalysis', () => {
  it('accepts a well-formed analysis', () => {
    const a = validateAnalysis(good, existing, true)
    expect(a?.title).toBe('Cannot type in a new Word document')
    expect(a?.severity).toBe('high')
    expect(a?.suspects).toHaveLength(1)
  })

  it('rejects an analysis with no title — it would file a nameless bug', () => {
    expect(validateAnalysis({ ...good, title: '   ' }, existing, true)).toBeNull()
    expect(validateAnalysis(null, existing, true)).toBeNull()
  })

  it('clamps an unknown severity to medium rather than trusting it', () => {
    expect(validateAnalysis({ ...good, severity: 'catastrophic' }, existing, true)?.severity).toBe('medium')
  })

  it('DROPS suspect paths when the model had no repo — those would be invented', () => {
    const a = validateAnalysis(good, existing, false)
    expect(a?.suspects).toEqual([])
    expect(a?.localized).toBe(false)
  })

  it('refuses suspect paths that escape the repo', () => {
    const a = validateAnalysis(
      { ...good, suspects: [
        { path: '/etc/passwd', why: 'x' },
        { path: '../../secrets', why: 'x' },
        { path: '~/.ssh/id_rsa', why: 'x' },
        { path: 'src/ok.ts', why: 'fine' },
      ] },
      existing,
      true,
    )
    expect(a?.suspects.map((s) => s.path)).toEqual(['src/ok.ts'])
  })

  it('ignores a duplicateOf that names no real entry — a hallucinated id would swallow the report', () => {
    expect(validateAnalysis({ ...good, duplicateOf: 'WOS-404' }, existing, true)?.duplicateOf).toBeNull()
    expect(validateAnalysis({ ...good, duplicateOf: 'WOS-001' }, existing, true)?.duplicateOf).toBe('WOS-001')
  })

  it('drops non-string and blank steps', () => {
    const a = validateAnalysis({ ...good, steps: ['real', '', 42, null] }, existing, true)
    expect(a?.steps).toEqual(['real'])
  })
})

describe('parseAnalysis', () => {
  it('reads a bare JSON object', () => {
    expect(parseAnalysis(JSON.stringify(good), existing, true)?.title).toBe(good.title)
  })

  it('reads JSON out of a fenced block', () => {
    const text = '```json\n' + JSON.stringify(good) + '\n```'
    expect(parseAnalysis(text, existing, true)?.title).toBe(good.title)
  })

  it('reads JSON that the model wrapped in prose', () => {
    const text = `Here you go:\n${JSON.stringify(good)}\nHope that helps.`
    expect(parseAnalysis(text, existing, true)?.title).toBe(good.title)
  })

  it('returns null for a reply with no JSON at all', () => {
    expect(parseAnalysis('I could not work that out.', existing, true)).toBeNull()
  })
})

describe('buildAnalysisPrompt', () => {
  it('leads with the user’s words and includes captured context', () => {
    const p = buildAnalysisPrompt({ text: 'cannot type', context: ctx, existing, repoRoot: '/repo' })
    expect(p).toContain('cannot type')
    expect(p).toContain('0.1.0')
    expect(p).toContain('[error] lok: open failed')
  })

  it('lists existing bugs so a duplicate can be spotted', () => {
    const p = buildAnalysisPrompt({ text: 'x', context: ctx, existing, repoRoot: null })
    expect(p).toContain('WOS-001: Slide thumbnails blank')
  })

  it('omits the already-filed section when the log is empty', () => {
    const p = buildAnalysisPrompt({ text: 'x', context: ctx, existing: [], repoRoot: null })
    expect(p).not.toContain('ALREADY FILED')
  })
})

describe('fallbacks', () => {
  it('unanalyzedReport still preserves the report — a failed model must not cost the user their bug', () => {
    const r = unanalyzedReport('WOS-002', 'the thing is broken\nand also slow', ctx, 'NOW')
    expect(r.reporterWords).toBe('the thing is broken\nand also slow')
    expect(r.title).toBe('the thing is broken')
    expect(r.whatHappened).toContain('and also slow')
  })

  it('toReport keeps the raw words alongside the structured version', () => {
    const a = validateAnalysis(good, existing, true)!
    const r = toReport('WOS-003', 'my own words', a, ctx, 'NOW')
    expect(r.reporterWords).toBe('my own words')
    expect(r.title).toBe(good.title)
    expect(r.seen).toBe(1)
  })

  it('falls back to the raw text when the model returned an empty description', () => {
    const a = validateAnalysis({ ...good, whatHappened: '', expected: '' }, existing, true)!
    const r = toReport('WOS-004', 'raw text here', a, ctx, 'NOW')
    expect(r.whatHappened).toBe('raw text here')
    expect(r.expected).toBe('_Not captured._')
  })
})

describe('a REAL analyzer reply (regression fixture)', () => {
  // Captured from an actual `claude -p` run using the exact flags runClaudeJson
  // passes, analyzing a real report: "tried to open a new word doc, cannot write
  // inside it, no cursor". The model prefixed the JSON with a sentence of prose,
  // which is precisely the shape a naive JSON.parse would choke on — hence the
  // fixture. Regenerate it if the analyzer prompt changes.
  const reply = readFileSync(join(__dirname, '__fixtures__', 'real-analyzer-reply.txt'), 'utf8')

  it('survives the prose preamble the model actually emitted', () => {
    const a = parseAnalysis(reply, [], true)
    expect(a).not.toBeNull()
    expect(a!.title).toContain('caret')
    expect(a!.severity).toBe('high')
  })

  it('extracts every suspect, and all of them are repo-relative', () => {
    const a = parseAnalysis(reply, [], true)!
    expect(a.suspects.length).toBe(5)
    for (const s of a.suspects) {
      expect(s.path.startsWith('/')).toBe(false)
      expect(s.path).toMatch(/^src\//)
    }
  })

  it('drops those same suspects when no repo was available', () => {
    expect(parseAnalysis(reply, [], false)!.suspects).toEqual([])
  })
})

describe('idea reports are analysed differently from defects', () => {
  const base = {
    text: 'It would be great if mail could summarise a long thread.',
    context: {
      appVersion: '0.1.21', commit: 'abc', surface: 'mail',
      openFile: null, os: 'darwin', recentErrors: [],
    },
    existing: [],
  }

  it('tells the model an idea is NOT a defect', () => {
    // Severity and steps-to-reproduce are meaningless for a proposal, and a
    // bug-shaped analysis of an idea produces a useless entry.
    const p = buildAnalysisPrompt({ ...base, kind: 'idea' })
    expect(p).toMatch(/FEATURE IDEA, not a defect/)
    expect(p).toMatch(/Do not assign a severity/)
  })

  it('asks FIRST what already exists', () => {
    // "We already have most of this in X" is the single most useful thing the
    // analyser can say about an idea, and it needs the codebase to say it.
    const p = buildAnalysisPrompt({ ...base, kind: 'idea' })
    expect(p).toMatch(/WHAT ALREADY EXISTS/)
    expect(p).toMatch(/name the files/)
  })

  it('applies the project’s own roadmap rule, verbatim', () => {
    const p = buildAnalysisPrompt({ ...base, kind: 'idea' })
    expect(p).toMatch(/compound liveness or the reviewable agent/)
    expect(p).toMatch(/Say plainly if it does NOT pass/)
  })

  it('asks for the strongest objection, not a business case', () => {
    expect(buildAnalysisPrompt({ ...base, kind: 'idea' })).toMatch(/strongest reason NOT to build it/)
  })

  it('leaves a BUG prompt unchanged — no idea guidance leaks in', () => {
    const p = buildAnalysisPrompt({ ...base, kind: 'bug' })
    expect(p).not.toMatch(/FEATURE IDEA/)
    expect(p).toMatch(/^REPORT \(the user's own words\):/m)
  })

  it('defaults to a bug when no kind is given, so existing callers are untouched', () => {
    expect(buildAnalysisPrompt(base)).not.toMatch(/FEATURE IDEA/)
  })
})

describe('nextId keeps the two kinds on separate counters', () => {
  it('numbers ideas independently of bugs', () => {
    // A shared counter would make WOS-007 and IDEA-007 land at different
    // numbers depending on filing order, and ids here are referenced elsewhere
    // and never renumbered.
    const existing = [
      { id: 'WOS-001', title: 'a' },
      { id: 'WOS-002', title: 'b' },
      { id: 'IDEA-001', title: 'c' },
    ]
    expect(nextId(existing, 'WOS')).toBe('WOS-003')
    expect(nextId(existing, 'IDEA')).toBe('IDEA-002')
  })

  it('starts at 001 for a kind that has none yet', () => {
    expect(nextId([{ id: 'WOS-009', title: 'x' }], 'IDEA')).toBe('IDEA-001')
  })
})

/**
 * WOS-010 — why every idea report failed.
 *
 * Two causes, both here. The system prompt demanded `severity` and `steps`
 * while IDEA_GUIDANCE in the user prompt forbade both, so the model answered in
 * prose and nothing could be parsed; and the 120s bug budget was applied per
 * ATTEMPT, so the contradiction was paid for twice before the user was told.
 */
describe('the idea system prompt does not contradict the idea guidance', () => {
  it('never asks an idea for a severity or repro steps', () => {
    // The exact contradiction that broke this: IDEA_GUIDANCE says do not assign
    // a severity, while the bug schema requires one.
    const p = ideaSystemPrompt(true, false)
    expect(p).not.toMatch(/"severity"/)
    expect(p).not.toMatch(/"steps"/)
    expect(p).toMatch(/do not assign a severity/i)
  })

  it('asks for the idea-shaped fields instead', () => {
    const p = ideaSystemPrompt(true, false)
    expect(p).toMatch(/"title"/)
    expect(p).toMatch(/"whatHappened"/)
    expect(p).toMatch(/"expected"/)
    expect(p).toMatch(/"verdict"/)
    expect(p).toMatch(/"suspects"/)
  })

  it('carries the roadmap rule into the verdict', () => {
    // \s+ because the rule is wrapped across lines in the prompt source.
    expect(ideaSystemPrompt(true, false)).toMatch(/compound liveness or\s+the reviewable agent/)
    expect(ideaSystemPrompt(true, false)).toMatch(/it is a commodity/)
  })

  it('tells a model with no repo not to invent file paths', () => {
    expect(ideaSystemPrompt(false, false)).toMatch(/Do not invent/)
  })
})

describe('analyzeBug budget and retry (WOS-010)', () => {
  const input = (kind?: 'bug' | 'idea') => ({
    kind,
    text: 'something',
    context: {
      appVersion: '0.1.37', commit: 'abc', surface: 'mail',
      openFile: null, os: 'darwin', recentErrors: [],
    } as BugContext,
    existing: [] as ExistingBug[],
    repoRoot: '/repo',
  })

  const GOOD = JSON.stringify({ title: 'A real title', surface: 's', whatHappened: 'w', expected: 'e' })

  beforeEach(() => {
    runs.length = 0
    replies = []
    elapsePerRunMs = 0
    now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
  })

  it('gives an idea a bigger budget than a bug — it has to survey the codebase', () => {
    replies = [GOOD]
    return analyzeBug(input('idea')).then(() => {
      const ideaBudget = runs[0].timeoutMs
      runs.length = 0
      replies = [GOOD]
      return analyzeBug(input('bug')).then(() => {
        expect(ideaBudget).toBeGreaterThan(runs[0].timeoutMs)
      })
    })
  })

  it('sends an idea the idea prompt, not the bug prompt', async () => {
    replies = [GOOD]
    await analyzeBug(input('idea'))
    expect(runs[0].systemPrompt).toMatch(/You assess FEATURE IDEAS/)
    expect(runs[0].systemPrompt).not.toMatch(/"severity"/)
  })

  it('still sends a bug the bug prompt', async () => {
    replies = [GOOD]
    await analyzeBug(input('bug'))
    expect(runs[0].systemPrompt).toMatch(/You triage bug reports/)
    expect(runs[0].systemPrompt).toMatch(/"severity"/)
  })

  it('retries an unparseable reply with only the time that is LEFT', async () => {
    // The whole call shares one deadline. Before this, each attempt got the
    // full budget and the user waited ~4 minutes to be told it failed.
    replies = ['not json at all', GOOD]
    elapsePerRunMs = 40_000
    const res = await analyzeBug(input('bug'))

    expect(res.ok).toBe(true)
    expect(runs).toHaveLength(2)
    expect(runs[1].timeoutMs).toBeLessThan(runs[0].timeoutMs)
    expect(runs[0].timeoutMs - runs[1].timeoutMs).toBe(40_000)
  })

  it('does not start a retry it cannot finish', async () => {
    // A second attempt with seconds left is just a longer failure.
    replies = ['not json', GOOD]
    elapsePerRunMs = 119_000 // leaves 1s of a 120s budget
    const res = await analyzeBug(input('bug'))

    expect(runs).toHaveLength(1)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/did not return a usable report/)
  })

  it('nudges the retry to return JSON and nothing else', async () => {
    replies = ['prose', GOOD]
    elapsePerRunMs = 1000
    await analyzeBug(input('idea'))
    expect(runs[1].systemPrompt).toMatch(/previous reply was not valid JSON/)
  })

  it('keeps the verdict an idea returns', async () => {
    replies = [JSON.stringify({ title: 'T', surface: 's', whatHappened: 'w', expected: 'e', verdict: 'commodity — skip it' })]
    const res = await analyzeBug(input('idea'))
    expect(res.analysis?.verdict).toBe('commodity — skip it')
  })

  it('leaves verdict undefined for a bug, which never asks for one', async () => {
    replies = [GOOD]
    const res = await analyzeBug(input('bug'))
    expect(res.analysis?.verdict).toBeUndefined()
  })
})
