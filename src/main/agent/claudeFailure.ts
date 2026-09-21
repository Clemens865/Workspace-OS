import type { AgentRunFailure } from '../../shared/agentRun'

const outputLimit = /CLAUDE_CODE_MAX_OUTPUT_TOKENS|response exceeded.{0,80}output token maximum|max_output_tokens/i

/** Only structured provider errors count; ordinary assistant text may discuss
 * token limits without having failed. A later successful result clears a
 * transient assistant error that Claude recovered from internally. */
export class ClaudeFailureTracker {
  failure: AgentRunFailure | null = null

  consume(line: string): void {
    let obj: any
    try { obj = JSON.parse(line) } catch { return }
    if (!obj || typeof obj !== 'object') return
    if (obj.type === 'result') {
      if (!obj.is_error) { this.failure = null; return }
      const message = [typeof obj.result === 'string' ? obj.result : '',
        ...(Array.isArray(obj.errors) ? obj.errors.filter((s: unknown) => typeof s === 'string') : []),
      ].filter(Boolean).join('\n')
      const failure = this.classify(message || this.failure?.message || 'The agent run failed.')
      // Some CLI versions put the specific API error on the assistant event
      // and only a generic failure on the final result.
      this.failure = this.failure?.kind === 'output-limit' && failure.kind !== 'output-limit'
        ? { ...this.failure, message: [this.failure.message, message].filter(Boolean).join('\n') }
        : failure
    } else if (obj.type === 'assistant' && typeof obj.error === 'string') {
      const content = obj.message?.content
      const message = Array.isArray(content)
        ? content.filter((c: any) => c?.type === 'text' && typeof c.text === 'string').map((c: any) => c.text).join('\n')
        : ''
      this.failure = this.classify(message || obj.error, obj.error)
    }
  }

  private classify(message: string, code = ''): AgentRunFailure {
    return { kind: outputLimit.test(code + '\n' + message) ? 'output-limit' : 'provider-error', message }
  }
}
