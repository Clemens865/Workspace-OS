import { spawn } from 'child_process'
import { resolveClaudeBinary } from '../handlers/agent'
import { claudeSettings } from './claudeSettings'
import { modelArgs } from './modelPick'

/**
 * A small, focused one-shot `claude -p` runner for internal, non-interactive
 * jobs (e.g. the Agent Foundry meta-agent). It reuses the SAME binary
 * resolution + stream-json contract as the Agent Terminal (handlers/agent.ts),
 * but collects the assistant's text into a single string instead of streaming
 * to a renderer. No persona/IWE grounding, no MCP, no permission flags beyond
 * what the caller asks for — these jobs read/produce text only.
 *
 * The prompt is fed on stdin (never argv) — same security posture as the main
 * run path. There is no time limit: an LLM call runs until it finishes, because
 * some agents legitimately work for a long time.
 */

export interface ClaudeRunResult {
  /** The concatenated assistant text (from stream-json text deltas + result). */
  text: string
  /** Process exit code (null if killed). */
  code: number | null
}

/** Pulls assistant text out of one stream-json line. Mirrors handlers/agent.ts. */
function textFromLine(line: string): string {
  const t = line.trim()
  if (!t || t[0] !== '{') return ''
  try {
    const obj = JSON.parse(t)
    if (
      obj.type === 'stream_event' &&
      obj.event?.type === 'content_block_delta' &&
      obj.event.delta?.type === 'text_delta'
    ) {
      return obj.event.delta.text ?? ''
    }
    // The final result event carries the full text — prefer it when no deltas
    // were captured (some CLI builds only emit the result), but avoid double
    // counting when deltas already streamed.
    return ''
  } catch {
    return ''
  }
}

/** Pulls the final `result` text out of a stream-json line, if present. */
function resultText(line: string): string | null {
  const t = line.trim()
  if (!t || t[0] !== '{') return null
  try {
    const obj = JSON.parse(t)
    if (obj.type === 'result' && !obj.is_error && typeof obj.result === 'string') return obj.result
    return null
  } catch {
    return null
  }
}

/**
 * Runs `claude -p` once with the given prompt (via stdin) and system prompt,
 * returning the assistant's full text. Streams deltas; falls back to the
 * `result` event's text if no deltas arrived.
 */
export function runClaudeJson(opts: {
  prompt: string
  systemPrompt?: string
  cwd?: string
  allowedTools?: string[]
  /** Model alias; unset = the CLI's default. */
  model?: string
  /** Load no settings files: the person's allow rules must not widen allowedTools (app answers, the app harness). */
  isolated?: boolean
}): Promise<ClaudeRunResult> {
  const { prompt, systemPrompt, cwd, allowedTools = [], model, isolated = false } = opts
  const binary = resolveClaudeBinary()

  const args = [
    '--settings', claudeSettings(),
    ...(isolated ? ['--setting-sources', ''] : []),
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    ...(allowedTools.length ? ['--allowedTools', ...allowedTools] : []),
    ...(systemPrompt ? ['--append-system-prompt', systemPrompt] : []),
    ...modelArgs(model),
    '-p',
  ]

  return new Promise<ClaudeRunResult>((resolve) => {
    const child = spawn(binary, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })

    let deltas = ''
    let finalResult = ''
    let buffer = ''

    child.stdin?.on('error', () => { /* EPIPE if child died early */ })
    child.stdin?.write(prompt)
    child.stdin?.end()

    const consume = (chunk: string): void => {
      buffer += chunk
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        deltas += textFromLine(line)
        const r = resultText(line)
        if (r !== null) finalResult = r
      }
    }

    child.stdout?.on('data', (d: Buffer) => consume(d.toString()))
    child.on('error', () => { /* reported via empty text + code */ })
    child.on('close', (code) => {
      if (buffer.trim()) {
        deltas += textFromLine(buffer)
        const r = resultText(buffer)
        if (r !== null) finalResult = r
      }
      const text = deltas.trim() ? deltas : finalResult
      resolve({ text, code })
    })
  })
}
