import { describe, it, expect } from 'vitest'
import {
  appendBug,
  bumpSeen,
  recordSighting,
  nextId,
  parseBugs,
  renderBug,
  type BugReport,
} from './bug-log'

const ctx = {
  appVersion: '0.1.0',
  commit: 'abc1234',
  surface: 'canvas',
  openFile: '/w/Untitled.docx',
  os: 'Darwin 25.3.0 (arm64)',
  recentErrors: [],
}

function bug(over: Partial<BugReport> = {}): BugReport {
  return {
    id: 'WOS-001',
    title: 'Cannot type in a new Word document',
    severity: 'high',
    surface: 'canvas / writer',
    whatHappened: 'No caret appears and typing does nothing.',
    expected: 'A caret appears and typing inserts text.',
    steps: ['New ▸ Word document', 'Click in the page', 'Type'],
    suspects: [{ path: 'src/main/office/lokEngine.ts', why: 'owns post-create focus' }],
    reporterWords: 'tried to open a new word doc, cannot write inside it',
    context: ctx,
    reportedAt: '2026-08-01T10:00:00.000Z',
    seen: 1,
    lastSeenAt: '2026-08-01T10:00:00.000Z',
    ...over,
  }
}

describe('renderBug', () => {
  it('keeps the reporter’s own words verbatim, as a quote', () => {
    const md = renderBug(bug({ reporterWords: 'it just\nsits there' }))
    expect(md).toContain('> it just')
    expect(md).toContain('> sits there')
  })

  it('labels suspected code as unverified so it is never read as a diagnosis', () => {
    const md = renderBug(bug())
    expect(md).toMatch(/Suspected code.*unverified/i)
    expect(md).toContain('src/main/office/lokEngine.ts')
  })

  it('says so plainly when there are no steps rather than inventing a shape', () => {
    expect(renderBug(bug({ steps: [] }))).toContain('_Not captured')
  })

  it('omits the seen-count suffix for a first report', () => {
    expect(renderBug(bug())).not.toContain('seen')
  })

  it('keeps a blank line before every section — without it Markdown welds them together', () => {
    // Regression: a blanket .filter(s => s !== '') over the block stripped the
    // separators, so "**What happens**" rendered as part of the metadata list.
    const md = renderBug(bug())
    for (const heading of ['**What happens**', '**Expected**', '**Steps to reproduce**', '**Reported as**']) {
      const i = md.indexOf(heading)
      expect(i).toBeGreaterThan(0)
      const prevLine = md.slice(0, i).split('\n').slice(-2)[0]
      expect(prevLine).toBe('')
    }
  })

  it('records an error tail when one was captured', () => {
    const md = renderBug(bug({ context: { ...ctx, recentErrors: ['[error] boom'] } }))
    expect(md).toContain('[error] boom')
  })
})

describe('parseBugs / nextId', () => {
  it('starts at WOS-001 on an empty log', () => {
    expect(nextId(parseBugs(''))).toBe('WOS-001')
  })

  it('reads back the entries it wrote', () => {
    const md = appendBug(appendBug('', bug()), bug({ id: 'WOS-002', title: 'Second' }))
    const parsed = parseBugs(md)
    expect(parsed.map((b) => b.id)).toEqual(['WOS-001', 'WOS-002'])
    expect(parsed[1].title).toBe('Second')
  })

  it('never reuses a number, even after gaps', () => {
    const existing = [
      { id: 'WOS-001', title: 'a', seen: 1 },
      { id: 'WOS-009', title: 'b', seen: 1 },
    ]
    expect(nextId(existing)).toBe('WOS-010')
  })
})

describe('appendBug', () => {
  it('writes a header into an empty log', () => {
    expect(appendBug('', bug())).toContain('# Workspace OS — Bug Log')
  })

  it('leaves every earlier entry byte-identical — the log is append-only', () => {
    const first = appendBug('', bug())
    const both = appendBug(first, bug({ id: 'WOS-002', title: 'Second' }))
    expect(both.startsWith(first.trimEnd())).toBe(true)
  })
})

describe('bumpSeen', () => {
  it('increments the counter in place instead of adding an entry', () => {
    const md = appendBug('', bug())
    const out = bumpSeen(md, 'WOS-001', '2026-08-02T09:00:00.000Z')
    expect(out).toContain('(seen 2×, last 2026-08-02T09:00:00.000Z)')
    expect(parseBugs(out)).toHaveLength(1)
  })

  it('keeps counting across repeated reports', () => {
    let md = appendBug('', bug())
    md = bumpSeen(md, 'WOS-001', 'A')
    md = bumpSeen(md, 'WOS-001', 'B')
    expect(md).toContain('(seen 3×, last B)')
    expect(parseBugs(md)[0].seen).toBe(3)
  })

  it('returns the log untouched for an unknown id, so nothing is corrupted', () => {
    const md = appendBug('', bug())
    expect(bumpSeen(md, 'WOS-999', 'X')).toBe(md)
  })

  it('does not disturb a neighbouring entry', () => {
    const md = appendBug(appendBug('', bug()), bug({ id: 'WOS-002', title: 'Second' }))
    const out = bumpSeen(md, 'WOS-002', 'Z')
    expect(out).toContain('## WOS-001 · Cannot type in a new Word document')
    expect(parseBugs(out)[0].seen).toBe(1)
    expect(parseBugs(out)[1].seen).toBe(2)
  })
})

describe('recordSighting', () => {
  it('keeps the second reporter’s words instead of discarding them', () => {
    // Regression: dedup used to bump the counter and throw the report away. A
    // wrong duplicate verdict then destroyed the bug silently.
    const md = appendBug('', bug())
    const out = recordSighting(md, 'WOS-001', 'T2', 'happens on ODT files too')
    expect(out).toContain('(seen 2×, last T2)')
    expect(out).toContain('**Also reported** T2')
    expect(out).toContain('> happens on ODT files too')
  })

  it('still keeps the original reporter’s words', () => {
    const md = appendBug('', bug({ reporterWords: 'the first words' }))
    const out = recordSighting(md, 'WOS-001', 'T2', 'the second words')
    expect(out).toContain('> the first words')
    expect(out).toContain('> the second words')
  })

  it('accumulates across repeated sightings', () => {
    let md = appendBug('', bug())
    md = recordSighting(md, 'WOS-001', 'T2', 'second')
    md = recordSighting(md, 'WOS-001', 'T3', 'third')
    expect(md).toContain('(seen 3×, last T3)')
    expect(md).toContain('> second')
    expect(md).toContain('> third')
  })

  it('writes into the right entry and leaves its neighbour alone', () => {
    const md = appendBug(appendBug('', bug()), bug({ id: 'WOS-002', title: 'Second bug' }))
    const out = recordSighting(md, 'WOS-001', 'T2', 'extra detail')
    const first = out.slice(out.indexOf('## WOS-001'), out.indexOf('## WOS-002'))
    const second = out.slice(out.indexOf('## WOS-002'))
    expect(first).toContain('> extra detail')
    expect(second).not.toContain('extra detail')
    expect(parseBugs(out)).toHaveLength(2)
  })

  it('leaves the log untouched for an unknown id so the caller files it as new', () => {
    const md = appendBug('', bug())
    expect(recordSighting(md, 'WOS-404', 'T2', 'words')).toBe(md)
  })

  it('is a plain bump when there are no words to keep', () => {
    const md = appendBug('', bug())
    const out = recordSighting(md, 'WOS-001', 'T2', '   ')
    expect(out).toContain('(seen 2×, last T2)')
    expect(out).not.toContain('Also reported')
  })
})

/**
 * WOS-010. Ideas were rendered through the bug template, so every entry in
 * IDEAS.md carried a severity and a "Steps to reproduce — _Not captured_" line.
 * That reads like a list of broken things rather than a list of proposals.
 */
describe('an idea renders as a proposal, not a defect', () => {
  const idea = () =>
    bug({
      id: 'IDEA-004',
      title: 'Summarise a long mail thread',
      whatHappened: 'Mail already extracts commitments in commitments.ts.',
      expected: 'A one-paragraph summary at the top of a thread.',
      verdict: 'Passes: it compounds the reviewable agent. Objection: thread summaries go stale.',
      steps: [],
    })

  it('omits severity — a proposal is not triaged', () => {
    const md = renderBug(idea(), 'idea')
    expect(md).not.toMatch(/\*\*Severity:\*\*/)
    expect(md).toMatch(/^## IDEA-004 · Summarise a long mail thread$/m)
  })

  it('omits steps to reproduce', () => {
    expect(renderBug(idea(), 'idea')).not.toMatch(/Steps to reproduce/)
  })

  it('leads with what already exists — the most useful part of the analysis', () => {
    const md = renderBug(idea(), 'idea')
    expect(md).toMatch(/\*\*What already exists\*\*/)
    expect(md).toMatch(/commitments\.ts/)
    expect(md).toMatch(/\*\*What this would add\*\*/)
  })

  it('records the roadmap verdict and the objection', () => {
    const md = renderBug(idea(), 'idea')
    expect(md).toMatch(/\*\*Worth building\?\*\*/)
    expect(md).toMatch(/compounds the reviewable agent/)
    expect(md).toMatch(/go stale/)
  })

  it('drops the verdict block entirely when there is none', () => {
    const md = renderBug(bug({ verdict: undefined, steps: [] }), 'idea')
    expect(md).not.toMatch(/Worth building/)
  })

  it('still keeps the reporter’s own words, which are authoritative either way', () => {
    expect(renderBug(idea(), 'idea')).toMatch(/> tried to open a new word doc/)
  })

  it('leaves BUG rendering exactly as it was', () => {
    const md = renderBug(bug())
    expect(md).toMatch(/\*\*Severity:\*\* high/)
    expect(md).toMatch(/\*\*Steps to reproduce\*\*/)
    expect(md).toMatch(/\*\*What happens\*\*/)
    expect(md).not.toMatch(/What already exists/)
  })

  it('defaults to the bug shape when no kind is passed', () => {
    expect(renderBug(bug())).toMatch(/\*\*Severity:\*\*/)
  })
})

describe('parseBugs reads IDEA ids too (WOS-010)', () => {
  it('finds idea entries, so ids do not restart at 001 every time', () => {
    // This matched only /WOS-\d+/, so IDEAS.md always parsed as empty and every
    // idea was filed as IDEA-001 on top of the last one.
    const md = [
      '# Ideas',
      '',
      '## IDEA-001 · First idea',
      '',
      '- **Reported:** 2026-08-01T10:00:00.000Z',
      '',
      '## IDEA-002 · Second idea',
      '',
      '- **Reported:** 2026-08-02T10:00:00.000Z',
    ].join('\n')

    const found = parseBugs(md)
    expect(found.map((b) => b.id)).toEqual(['IDEA-001', 'IDEA-002'])
    expect(nextId(found, 'IDEA')).toBe('IDEA-003')
  })

  it('still reads bug ids', () => {
    const md = '## WOS-007 · A defect\n\n- **Reported:** 2026-08-01T10:00:00.000Z'
    expect(parseBugs(md).map((b) => b.id)).toEqual(['WOS-007'])
  })
})
