import { runClaudeOneShot, type OneShotOptions } from '../mail/claude-oneshot'
import { runClaudeJson, type ClaudeRunResult } from './claudeRun'
import { getProviderModel } from './providerSettings'
import { parseModelPick } from './modelPick'
import { runCodexText } from './providers/codexText'

/** Dispatch only: the existing Claude implementations and their options stay intact. */
export function runProviderOneShot(prompt: string, opts: OneShotOptions): Promise<string> {
  const selected = opts.model?.includes(':') ? opts.model : getProviderModel()
  const pick = parseModelPick(selected)
  if (pick.provider === 'claude') return runClaudeOneShot(prompt, opts.model?.startsWith('claude:') ? { ...opts, model: pick.model } : opts)
  return runCodexText({ prompt, model: pick.model, timeoutMs: opts.timeoutMs }).then((r) => {
    if (r.timedOut) throw new Error(`${opts.label} timed out.`)
    if (r.code !== 0 || !r.text.trim()) throw new Error(`${opts.label} failed in Codex. Check the Codex account and model settings.`)
    return r.text.trim()
  })
}

export function runProviderJson(opts: Parameters<typeof runClaudeJson>[0]): Promise<ClaudeRunResult> {
  const pick = parseModelPick(getProviderModel())
  if (pick.provider === 'claude') return runClaudeJson(opts)
  return runCodexText({ ...opts, model: pick.model, allowRead: !!opts.allowedTools?.length })
}
