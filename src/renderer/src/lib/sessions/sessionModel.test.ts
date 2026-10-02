import { describe, expect, it } from 'vitest'
import { caseOnFirstAsk, outcomeLine, shouldSuggestCase, titleFromPrompt, trimMessages, turnNotes, workItems, type Session } from './sessionModel'

const s = (over: Partial<Session> = {}): Session => ({
  id: 'a',
  title: 'T',
  agentName: null,
  caseId: null,
  createdAt: 1,
  lastAt: 1,
  turns: 1,
  files: [],
  lastRunId: null,
  messages: [],
  ...over,
})

describe('titleFromPrompt', () => {
  it('takes the opening words of the first ask, capitalised, without trailing punctuation', () => {
    expect(titleFromPrompt('find three grants for the pilot programme in Austria please.')).toBe('Find three grants for the pilot')
    expect(titleFromPrompt('  \n\nsummarise this deck!  ')).toBe('Summarise this deck')
    expect(titleFromPrompt('')).toBe('New session')
  })
})

describe('when a session becomes a case', () => {
  it('always: on the first ask', () => {
    expect(caseOnFirstAsk('always')).toBe(true)
    expect(caseOnFirstAsk('suggest')).toBe(false)
  })

  it('suggested: once it produced a file or ran three turns, unless dismissed or already a case', () => {
    expect(shouldSuggestCase(s({ turns: 1 }), 'suggest')).toBe(false)
    expect(shouldSuggestCase(s({ files: ['/w/a.md'] }), 'suggest')).toBe(true)
    expect(shouldSuggestCase(s({ turns: 3 }), 'suggest')).toBe(true)
    expect(shouldSuggestCase(s({ turns: 3, suggestDismissed: true }), 'suggest')).toBe(false)
    expect(shouldSuggestCase(s({ turns: 3, caseId: 'c' }), 'suggest')).toBe(false)
  })

  it('manual: never suggested', () => {
    expect(shouldSuggestCase(s({ turns: 9, files: ['x'] }), 'manual')).toBe(false)
  })
})

describe('memory notes', () => {
  it('the outcome is the last paragraph of the answer, one line, without markup or code', () => {
    expect(outcomeLine('Looking at it.\n\nI found **three** grants and saved them to grants.md.')).toBe('I found three grants and saved them to grants.md.')
    expect(outcomeLine('Done:\n\n```\ncode\n```')).toBe('Done:')
    expect(outcomeLine('')).toBeNull()
  })

  it('a turn leaves the ask and the agent outcome, nothing invented', () => {
    expect(turnNotes('Find grants', 'Saved three.')).toEqual([
      { author: 'you', text: 'Find grants' },
      { author: 'agent', text: 'Saved three.' },
    ])
    expect(turnNotes('Find grants', '')).toEqual([{ author: 'you', text: 'Find grants' }])
  })

  it('keeps the stored conversation small', () => {
    const m = Array.from({ length: 80 }, (_, i) => ({ role: 'user' as const, text: 'x'.repeat(i === 79 ? 5000 : 3), at: i }))
    const t = trimMessages(m)
    expect(t).toHaveLength(60)
    expect(t[59].text.length).toBeLessThan(4100)
  })
})

describe('workItems', () => {
  it('folds sessions into their case, keeps loose sessions, newest first', () => {
    const items = workItems(
      [s({ id: 'a', caseId: 'c1', lastAt: 50 }), s({ id: 'b', lastAt: 70 }), s({ id: 'c', caseId: 'gone', lastAt: 10 })],
      [
        { id: 'c1', title: 'Pilot', updated: new Date(20).toISOString() },
        { id: 'c2', title: 'Old', updated: new Date(5).toISOString() },
      ],
    )
    expect(items.map((i) => i.id)).toEqual(['session:b', 'case:c1', 'session:c', 'case:c2'])
    const c1 = items[1]
    expect(c1.kind === 'case' && c1.sessions.map((x) => x.id)).toEqual(['a'])
    expect(c1.lastAt).toBe(50)
  })
})
