import { describe, it, expect } from 'vitest'
import type { Session } from '../../../lib/sessions/sessionModel'
import { artifactKind, csvRows, historyGroups, linkTarget } from './chatModel'

const s = (id: string, lastAt: number, title = id, words = ''): Session => ({
  id, title, agentName: null, caseId: null, createdAt: lastAt, lastAt, turns: 1, files: [], lastRunId: null,
  messages: words ? [{ role: 'user', text: words, at: lastAt }] : [],
})

describe('chat history', () => {
  const now = new Date(2026, 9, 5, 15, 0).getTime()
  const day = 86_400_000
  it('groups conversations by when they were last used, newest first', () => {
    const g = historyGroups([s('old', now - 30 * day), s('a', now - 3600_000), s('y', now - day), s('b', now - 60_000), s('w', now - 4 * day)], now)
    expect(g.map((x) => [x.label, x.items.map((i) => i.id)])).toEqual([
      ['Today', ['b', 'a']],
      ['Yesterday', ['y']],
      ['Previous 7 days', ['w']],
      ['Older', ['old']],
    ])
  })

  it('finds a conversation by its title or by what was said in it', () => {
    const all = [s('1', now, 'Trip to Lisbon'), s('2', now, 'Budget', 'what did Northwind offer?'), s('3', now, 'Other')]
    expect(historyGroups(all, now, 'lisbon')[0].items.map((x) => x.id)).toEqual(['1'])
    expect(historyGroups(all, now, 'NORTHWIND')[0].items.map((x) => x.id)).toEqual(['2'])
    expect(historyGroups(all, now, 'nothing like it')).toEqual([])
  })
})

describe('artifacts and links', () => {
  it('knows what preview a file gets', () => {
    expect(['a.html', 'b.svg', 'c.md', 'd.PNG', 'e.csv', 'f.py', 'g.docx', 'h.pdf', 'i.zip'].map(artifactKind)).toEqual(['html', 'svg', 'markdown', 'image', 'csv', 'code', 'office', 'pdf', 'other'])
  })

  it('sends web links to the browser and resolves file links against the workspace', () => {
    expect(linkTarget('https://example.com', '/ws')).toEqual({ web: 'https://example.com' })
    expect(linkTarget('Artifacts/Q3%20deck.html', '/ws/')).toEqual({ file: '/ws/Artifacts/Q3 deck.html' })
    expect(linkTarget('./notes.md', '/ws')).toEqual({ file: '/ws/notes.md' })
    expect(linkTarget('/abs/x.svg', '/ws')).toEqual({ file: '/abs/x.svg' })
  })

  it('reads a CSV into rows', () => {
    expect(csvRows('a,b\n"1",2\n\n')).toEqual([['a', 'b'], ['1', '2']])
    expect(csvRows('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })
})
