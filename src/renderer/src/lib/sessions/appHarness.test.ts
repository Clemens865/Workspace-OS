import { beforeEach, describe, expect, it, vi } from 'vitest'
import { afterTurn, briefFirst, reviewFixPrompt, reviewLine, type HarnessDeps } from './appHarness'

const api = { lint: vi.fn(), review: vi.fn(), brief: vi.fn() }
vi.stubGlobal('window', { workspace: { apps: api } })
vi.stubGlobal('document', { querySelector: () => null })
vi.stubGlobal('CSS', { escape: (s: string) => s })

let said: string[]
let sent: { text: string; auto: string }[]
let deps: HarnessDeps
beforeEach(() => {
  vi.useFakeTimers()
  said = []
  sent = []
  for (const f of Object.values(api)) f.mockReset()
  deps = {
    app: () => 'notes',
    push: (_id, m) => said.push(m.text + (m.suggest ? ` [${m.suggest.join(' | ')}]` : '')),
    busy: () => {},
    send: async (_id, text, auto) => void sent.push({ text, auto }),
  }
})
const settle = async (p: Promise<unknown>): Promise<void> => {
  await vi.runAllTimersAsync()
  await p
}

const review = (o: Partial<{ checks: { check: string; met: boolean; note: string }[]; looks: string[]; next: string[] }> = {}) => ({ checks: [], looks: [], next: [], ...o })

describe('the brief', () => {
  it('tells the builder to build to the brief', async () => {
    api.brief.mockResolvedValue({ brief: '# X', checks: 9 })
    expect(await briefFirst('s', 'notes', 'notes app', deps)).toContain('Apps/notes/BRIEF.md')
    expect(said).toEqual(['Product brief written (BRIEF.md): 9 acceptance checks the build is held to. Building…'])
  })

  it('builds from the words alone when there is no brief', async () => {
    api.brief.mockResolvedValue(null)
    expect(await briefFirst('s', 'notes', 'make it blue', deps)).toBe('')
    api.brief.mockRejectedValue(new Error("Error invoking remote method 'apps:brief': Error: No usable brief came back"))
    expect(await briefFirst('s', 'notes', 'notes app', deps)).toBe('')
    expect(said).toEqual(['No brief this time (No usable brief came back); building from your words.'])
  })
})

describe('after a turn', () => {
  it('fixes the design first, then reviews once that fix is done', async () => {
    api.lint.mockResolvedValue([{ rule: 'colour', detail: 'style.css: #fff' }])
    await settle(afterTurn('s', undefined, deps))
    expect(sent.map((s) => s.auto)).toEqual(['design'])
    expect(api.review).not.toHaveBeenCalled()

    api.lint.mockResolvedValue([])
    api.review.mockResolvedValue(review({ checks: [{ check: 'Saves', met: true, note: '' }], next: ['Add tags'] }))
    await settle(afterTurn('s', 'design', deps))
    expect(said.slice(-3)).toEqual(['Design check: all fixed.', 'Review: 1 of 1 check met.', 'Next, you could ask: [Add tags]'])
    expect(sent).toHaveLength(1)
  })

  it('sends what the review found once, then offers the next steps', async () => {
    api.lint.mockResolvedValue([])
    api.review.mockResolvedValue(review({ checks: [{ check: 'Saves', met: false, note: 'lost on reload' }], looks: ['Title cut off'], next: ['Add tags', 'Export'] }))
    await settle(afterTurn('s', undefined, deps))
    expect(said).toEqual(['Review: 0 of 1 check met, 1 thing to fix on screen. Fixing…'])
    expect(sent).toEqual([{ text: expect.stringContaining('- Not met: Saves (lost on reload)\n- Looks: Title cut off'), auto: 'review' }])

    await settle(afterTurn('s', 'review', deps))
    expect(api.review).toHaveBeenCalledTimes(1)
    expect(said.at(-1)).toBe('Next, you could ask: [Add tags | Export]')
  })

  it('says nothing more when the review gave nothing', async () => {
    api.lint.mockResolvedValue([])
    api.review.mockResolvedValue(null)
    await settle(afterTurn('s', undefined, deps))
    expect(said).toEqual([])
    expect(sent).toEqual([])
  })
})

describe('review lines', () => {
  it('summarises and asks for fixes only when something is missing', () => {
    expect(reviewFixPrompt(review({ checks: [{ check: 'A', met: true, note: '' }] }))).toBeNull()
    expect(reviewLine(review(), false)).toBe('Review: no brief to check against.')
  })
})
