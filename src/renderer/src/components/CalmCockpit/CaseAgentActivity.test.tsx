import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CaseAgentActivity } from './CaseAgentActivity'
import type { CaseAgentRun } from './caseAgentRuns'

const run: CaseAgentRun = {
  runId: 'case-test-123', caseKey: 'case-test', title: 'Test case', label: 'Prepare the interview',
  status: 'running', provider: 'claude', startedAt: Date.now(), finishedAt: null,
  conversationId: 'case-test-123', model: 'claude:sonnet', launchPending: false, failure: null, outputTruncated: false,
  steps: [{ kind: 'read', label: 'Reading a file', chip: 'cv.md', count: 1, at: Date.now() }],
  output: 'Found useful experience.', artifacts: [], requests: [], error: null, code: null, checkpointId: null,
}

describe('case activity feedback', () => {
  it('explains a response limit and offers continuation only when resumable', () => {
    const limited: CaseAgentRun = { ...run, status: 'error', failure: { kind: 'output-limit', message: 'Limit reached', canResume: true } }
    const html = renderToStaticMarkup(<CaseAgentActivity run={limited} onContinue={() => {}} />)
    expect(html).toContain('Response limit reached')
    expect(html).toContain('Continue unfinished work')
    expect(html).toContain('Found useful experience.')
    const unavailable = renderToStaticMarkup(<CaseAgentActivity run={{ ...limited, failure: { ...limited.failure!, canResume: false } }} onContinue={() => {}} />)
    expect(unavailable).not.toContain('Continue unfinished work')
    expect(unavailable).toContain('Send a new request')
  })

  it.each(['claude', 'codex'] as const)('renders %s running state, current work and response', (provider) => {
    const html = renderToStaticMarkup(<CaseAgentActivity run={{ ...run, provider }} />)
    expect(html).toContain(`${provider === 'claude' ? 'Claude' : 'Codex'} · Running`)
    expect(html).toContain('Reading a file')
    expect(html).toContain('cv.md')
    expect(html).toContain('Found useful experience.')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
  })

  it('shows startup feedback even before any provider events arrive', () => {
    const html = renderToStaticMarkup(<CaseAgentActivity run={{ ...run, provider: undefined, status: 'preparing', steps: [], output: '' }} />)
    expect(html).toContain('Agent · Preparing case')
    expect(html).toContain('Loading the case')
  })

  it('distinguishes waiting, failure and successful completion', () => {
    expect(renderToStaticMarkup(<CaseAgentActivity run={{ ...run, provider: 'codex', requests: ['question'] }} />)).toContain('Codex · Waiting for you')
    const failed = renderToStaticMarkup(<CaseAgentActivity run={{ ...run, status: 'error', error: 'Sign in again' }} />)
    expect(failed).toContain('Claude · Failed')
    expect(failed).toContain('role="alert"')
    expect(failed).not.toContain('Completed')
    expect(renderToStaticMarkup(<CaseAgentActivity run={{ ...run, status: 'completed' }} />)).toContain('Claude · Completed')
  })

  it('renders output as safe plain text without terminal escape sequences', () => {
    const html = renderToStaticMarkup(<CaseAgentActivity run={{ ...run, output: '\x1b[31m<script>alert(1)</script>\x1b[0m' }} />)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('\x1b')
    expect(html).toContain('&lt;script&gt;')
  })
})
