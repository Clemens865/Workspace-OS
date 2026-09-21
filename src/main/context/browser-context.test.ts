import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => '/tmp/ws' }))
vi.mock('fs', () => ({
  default: { mkdirSync: () => {}, writeFileSync: () => {} },
  mkdirSync: () => {},
  writeFileSync: () => {},
}))

const { setContext, getContextEnv, contextPrompt } = await import('./workspaceContext')

beforeEach(() => {
  setContext({ browserUrl: null, browserTitle: null, surface: null, openFile: null })
})

describe('the harness knows which page the user is looking at', () => {
  it('carries the url and title once the browser reports them', () => {
    setContext({ browserUrl: 'https://revolut.com/careers/1', browserTitle: 'Backend Engineer' })
    const env = getContextEnv()
    expect(env.WOS_BROWSER_URL).toBe('https://revolut.com/careers/1')
    expect(env.WOS_BROWSER_TITLE).toBe('Backend Engineer')
  })

  it('is empty rather than undefined when no page is open', () => {
    // A shell must never inherit the literal string "undefined".
    expect(getContextEnv().WOS_BROWSER_URL).toBe('')
  })

  it('tells an agent the page exists AND how to read it', () => {
    // The failure this fixes: asked "can you see this job posting?", an agent
    // in the terminal answered "nothing came through with your message" —
    // correct, and only because nothing ever told it about the open page.
    setContext({ browserUrl: 'https://revolut.com/careers/1', browserTitle: 'Backend Engineer' })
    const prompt = contextPrompt()
    expect(prompt).toContain('https://revolut.com/careers/1')
    expect(prompt).toContain('browser.extract')
  })

  it('says nothing about a browser when no page is open', () => {
    expect(contextPrompt()).not.toMatch(/looking at/i)
  })

  it('a later partial push does not wipe the page', () => {
    // The shell pushes {surface, folder, openFile} on every navigation and the
    // browser pushes only its two fields; a merge that dropped either would
    // make the harness flicker.
    setContext({ browserUrl: 'https://a.com/', browserTitle: 'A' })
    setContext({ surface: 'files', openFile: '/tmp/ws/x.md' })
    expect(getContextEnv().WOS_BROWSER_URL).toBe('https://a.com/')
    expect(getContextEnv().WOS_OPEN_FILE).toBe('/tmp/ws/x.md')
  })
})
