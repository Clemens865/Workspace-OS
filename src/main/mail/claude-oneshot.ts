import { spawn } from 'child_process'
import { resolveClaudeBinary } from '../handlers/agent'
import { claudeSettings } from '../agent/claudeSettings'

/**
 * One-shot `claude -p` runner for the drafting paths (mail draft, rich draft,
 * assist, build-from-file).
 *
 * WHY THIS IS NOT PLAIN STDOUT
 *
 * A `Stop` hook can return `{decision:"block", reason:"…"}`, which makes the CLI
 * continue and produce ANOTHER assistant message. Interactively that is fine —
 * it appends a turn. Under `-p` there is only one printed response, so the
 * forced continuation REPLACES the answer: the model does the work correctly and
 * the result is thrown away.
 *
 * That is not hypothetical. A session-summary hook on the developer's machine
 * turned every draft in this app into:
 *
 *     PROGRESS: Drafted the email body as a six-block JSON array …
 *     DECISION: Led with the €130k-clearing count …
 *
 * — a perfect description of the answer, instead of the answer. Every drafting
 * feature failed identically and looked like a model problem.
 *
 * THE FIX, in two layers:
 *
 *  1. `--settings '{"disableAllHooks":true}'` stops it at source. The agent
 *     paths have always passed this; these drafting paths never did, which is
 *     the entire bug. It is the real fix.
 *  2. Reading the STREAM and taking the FIRST assistant message. With one prompt
 *     and no tools there is exactly one; anything after it is an induced
 *     continuation. This is a backstop for the day a CLI version ignores the
 *     flag, or a hook arrives by a route the flag does not cover — the failure
 *     it guards against is silent and produces confident wrong output, which is
 *     the kind worth paying a little redundancy for.
 *
 * Rejected: `--bare` also skips hooks but drops the OAuth session ("Not logged
 * in"), and a `--settings` file containing `{"hooks":{}}` merges rather than
 * replaces, so the user's hooks still fire.
 */

/** One assistant text message, in order of arrival. */
function assistantTexts(ndjson: string): string[] {
  const out: string[] = []
  for (const line of ndjson.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed[0] !== '{') continue
    let evt: unknown
    try {
      evt = JSON.parse(trimmed)
    } catch {
      continue // a partial line at the buffer edge is not an error
    }
    const e = evt as { type?: string; message?: { content?: { type?: string; text?: string }[] } }
    if (e.type !== 'assistant') continue
    for (const part of e.message?.content ?? []) {
      if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        out.push(part.text)
      }
    }
  }
  return out
}

export interface OneShotOptions {
  /** Milliseconds before the run is killed. */
  timeoutMs: number
  /** Used in the timeout/exit messages, e.g. "The writing assistant". */
  label: string
  /**
   * Model ALIAS to run on (e.g. "haiku") — a user setting passed through,
   * never a constant: no model name may live in source, because names go
   * obsolete and settings don't. Absent = the CLI's configured default.
   * When a named model is rejected, the caller-facing promise does NOT fail:
   * the run retries once without the flag, so mail features keep working the
   * day a model alias is retired — the person just stops getting the cheap
   * tier until they update the setting.
   */
  model?: string
}

/**
 * Runs the prompt and resolves the model's FIRST reply.
 *
 * The prompt goes on stdin, never argv: a prompt starting with `--` must not
 * parse as flags, and argv is visible to `ps`. No permission flags are passed,
 * so in `-p` mode the model has no tools — it only writes text.
 */
export function runClaudeOneShot(prompt: string, opts: OneShotOptions): Promise<string> {
  const attempt = runOneShotAttempt(prompt, opts)
  if (!opts.model) return attempt
  // Model-alias fallback: see OneShotOptions.model. A retry without the flag
  // costs one more attempt only on the failure path.
  return attempt.catch(() => runOneShotAttempt(prompt, { ...opts, model: undefined }))
}

function runOneShotAttempt(prompt: string, opts: OneShotOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    let binary: string
    try {
      binary = resolveClaudeBinary()
    } catch (e) {
      reject(e as Error)
      return
    }

    const child = spawn(
      binary,
      [
        // The actual fix. The agent paths (agent/claudeRun.ts, handlers/agent.ts)
        // have carried this since they were written; the mail drafting paths
        // never got it, which is the whole reason they broke.
        '--settings', claudeSettings(),
        // --verbose is REQUIRED alongside stream-json: without it the CLI emits
        // only the final result, which is exactly the message a Stop hook
        // replaces — so the earlier, real one would never be printed.
        '--output-format', 'stream-json',
        '--verbose',
        ...(opts.model ? ['--model', opts.model] : []),
        '-p',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )

    let out = ''
    let errText = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`${opts.label} timed out.`))
    }, opts.timeoutMs)
    timer.unref?.()

    child.stdout.on('data', (d: Buffer) => { out += d.toString() })
    child.stderr.on('data', (d: Buffer) => { errText += d.toString() })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => {
      clearTimeout(timer)
      const texts = assistantTexts(out)
      if (code === 0 && texts.length > 0) {
        resolve(texts[0].trim())
        return
      }
      reject(new Error(errText.trim() || `${opts.label} exited with code ${code ?? 'null'}.`))
    })

    child.stdin?.on('error', () => { /* EPIPE if the child died early — close handler reports it */ })
    child.stdin?.write(prompt)
    child.stdin?.end()
  })
}

/** Exported for tests: the parser is the part with the interesting edge cases. */
export const __test = { assistantTexts }
