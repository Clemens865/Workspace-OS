import { describe, expect, it } from 'vitest'
import { ClaudeFailureTracker } from './claudeFailure'
import { claudeSettings } from './claudeSettings'

const limit = "API Error: Claude's response exceeded the 8192 output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable."

describe('Claude response limits', () => {
  it('sets an app-local 32000 limit while preserving each runner’s hook policy', () => {
    expect(JSON.parse(claudeSettings())).toEqual({ disableAllHooks: true, env: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000' } })
    expect(JSON.parse(claudeSettings(false))).toEqual({ env: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000' } })
  })

  it.each([{ result: limit }, { errors: [limit] }])('recognizes a terminal response-limit error: %j', (payload) => {
    const tracker = new ClaudeFailureTracker()
    tracker.consume(JSON.stringify({ type: 'result', is_error: true, ...payload }))
    expect(tracker.failure).toEqual({ kind: 'output-limit', message: limit })
  })

  it('keeps the specific assistant API error when the terminal result is generic', () => {
    const tracker = new ClaudeFailureTracker()
    tracker.consume(JSON.stringify({ type: 'assistant', error: 'max_output_tokens', message: { content: [{ type: 'text', text: limit }] } }))
    tracker.consume(JSON.stringify({ type: 'result', is_error: true, errors: ['Execution failed'] }))
    expect(tracker.failure?.kind).toBe('output-limit')
    expect(tracker.failure?.message).toContain(limit)
  })

  it('clears an error if Claude recovers and finishes successfully', () => {
    const tracker = new ClaudeFailureTracker()
    tracker.consume(JSON.stringify({ type: 'assistant', error: 'max_output_tokens' }))
    tracker.consume(JSON.stringify({ type: 'result', is_error: false, result: 'Done' }))
    expect(tracker.failure).toBeNull()
  })

  it('does not mistake normal text or a recoverable stop reason for a failed run', () => {
    const tracker = new ClaudeFailureTracker()
    for (const line of ['not json', 'null', JSON.stringify({ type: 'assistant', message: { stop_reason: 'max_tokens', content: [{ type: 'text', text: limit }] } }), JSON.stringify({ type: 'stream_event', event: { delta: { text: limit } } })]) tracker.consume(line)
    expect(tracker.failure).toBeNull()
  })

  it('keeps unrelated provider failures distinct', () => {
    const tracker = new ClaudeFailureTracker()
    tracker.consume(JSON.stringify({ type: 'result', is_error: true, errors: ['Authentication expired'] }))
    expect(tracker.failure).toEqual({ kind: 'provider-error', message: 'Authentication expired' })
  })
})
