/**
 * A model pick is "<provider>:<model>" or a bare Claude alias. '' = the
 * default provider (Claude) with the CLI's default model. Only aliases and
 * plain ids get through — the value ends up on argv.
 */
export type ProviderId = 'claude' | 'codex'

export interface ModelPick {
  provider: ProviderId
  /** '' = the provider CLI's own default model. */
  model: string
}

const MODEL_RE = /^[a-z0-9][a-z0-9.-]{0,60}$/

export function isValidModelAlias(m: unknown): m is string {
  if (typeof m !== 'string') return false
  const { provider, model } = splitPick(m)
  return (provider === 'claude' || provider === 'codex') && (model === '' || MODEL_RE.test(model))
}

function splitPick(s: string): { provider: string; model: string } {
  const i = s.indexOf(':')
  if (i < 0) return { provider: 'claude', model: s }
  return { provider: s.slice(0, i) || 'claude', model: s.slice(i + 1) }
}

/** Parses a pick; anything invalid resolves to the Claude default. */
export function parseModelPick(s: unknown): ModelPick {
  if (!isValidModelAlias(s)) return { provider: 'claude', model: '' }
  const { provider, model } = splitPick(s)
  return { provider: provider as ProviderId, model }
}

/** The --model argument pair for a run, or nothing when the CLI's default should apply. */
export function modelArgs(model: string | undefined | null): string[] {
  return typeof model === 'string' && MODEL_RE.test(model) ? ['--model', model] : []
}

/** Both legacy bare UUIDs and provider-qualified persisted conversations. */
export function parseConversation(value: unknown): { provider: ProviderId; sessionId: string } | null {
  if (typeof value !== 'string') return null
  const at = value.indexOf(':')
  const provider = at < 0 ? 'claude' : value.slice(0, at)
  const sessionId = at < 0 ? value : value.slice(at + 1)
  if (provider !== 'claude' && provider !== 'codex') return null
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) return null
  return { provider, sessionId }
}
