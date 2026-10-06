import { beforeEach, describe, expect, it, vi } from 'vitest'
import { afterTurn, briefFirst, MAX_TEST_FIXES, reviewFixPrompt, reviewLine, testFixPrompt, type HarnessDeps } from './appHarness'

const api = { lint: vi.fn(), review: vi.fn(), brief: vi.fn(), testsWrite: vi.fn(), test: vi.fn(), onTestProgress: vi.fn() }
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
  api.onTestProgress.mockReturnValue(() => {})
  api.testsWrite.mockResolvedValue(null)
  api.test.mockResolvedValue(null)
  deps = {
    app: () => 'notes',
    ask: () => 'a notes app',
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

const scen = (name: string, ok: boolean, more: object = {}) => ({ name, check: '', ok, errors: [], ...more })
const report = (...scenarios: ReturnType<typeof scen>[]) => ({ total: scenarios.length, passed: scenarios.filter((x) => x.ok).length, scenarios, ms: 1 })

describe('the tests', () => {
  beforeEach(() => {
    api.lint.mockResolvedValue([])
    api.review.mockResolvedValue(null)
  })

  it('writes the tests for the last ask, runs them in the app, and sends what fails back', async () => {
    api.testsWrite.mockResolvedValue({ scenarios: 2 })
    api.test.mockResolvedValue(report(scen('Adds a note', true), scen('Undo', false, { step: 3, error: 'Found no ".note"', shot: 'Apps/notes/.tests/2.png' })))
    await settle(afterTurn('s', undefined, deps))
    expect(api.testsWrite).toHaveBeenCalledWith('notes', 'a notes app')
    expect(said).toEqual(['Tests written (TESTS.json): 2 scenarios. Running them in the app beside this chat: watch it being clicked.', 'Tests: 1 of 2 passed (failing: Undo). Fixing, round 1 of 3…'])
    expect(sent).toEqual([{ text: expect.stringContaining('- "Undo": step 3 failed: Found no ".note" (the app at that moment: Apps/notes/.tests/2.png; look at it with Read)'), auto: 'test' }])
    expect(api.review).not.toHaveBeenCalled()
  })

  it('stops after three fix rounds and reviews, telling the reviewer how the tests went', async () => {
    api.test.mockResolvedValue(report(scen('Undo', false, { error: 'x' })))
    await settle(afterTurn('s', undefined, deps))
    for (let i = 0; i < MAX_TEST_FIXES; i++) await settle(afterTurn('s', 'test', deps))
    expect(sent.map((x) => x.auto)).toEqual(['test', 'test', 'test'])
    expect(said).toContain('Tests: 0 of 1 passed (failing: Undo) after 3 fix rounds. Ask for a fix, or say if a test is wrong.')
    expect(api.testsWrite).toHaveBeenCalledTimes(1) // a fix round keeps the tests
    expect(api.review).toHaveBeenCalledWith('notes', null, '0 of 1 passed (failing: Undo)')
  })

  it('goes on to the review when every test passes', async () => {
    api.test.mockResolvedValue(report(scen('Adds a note', true)))
    api.review.mockResolvedValue(review())
    await settle(afterTurn('s', undefined, deps))
    expect(said[0]).toBe('Tests: all 1 passed in the running app.')
    expect(api.review).toHaveBeenCalledWith('notes', null, 'all 1 passed')
  })

  it('says when the tests could not run, and still reviews', async () => {
    api.test.mockResolvedValue({ total: 3, passed: 0, scenarios: [], ms: 1, stopped: 'The app’s preview is not on screen' })
    await settle(afterTurn('s', undefined, deps))
    expect(said).toEqual(['The tests could not run: The app’s preview is not on screen.'])
    expect(api.review).toHaveBeenCalled()
  })

  it('asks for no fix when nothing failed', () => {
    expect(testFixPrompt('notes', report(scen('A', true)))).toBeNull()
  })
})

describe('review lines', () => {
  it('summarises and asks for fixes only when something is missing', () => {
    expect(reviewFixPrompt(review({ checks: [{ check: 'A', met: true, note: '' }] }))).toBeNull()
    expect(reviewLine(review(), false)).toBe('Review: no brief to check against.')
  })
})
