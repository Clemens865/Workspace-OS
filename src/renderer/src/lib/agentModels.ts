/**
 * The models an agent run can be pinned to. Claude: aliases only — the CLI
 * resolves 'fable' / 'opus' / 'sonnet' / 'haiku' to the current generation, so
 * a choice made today never rots into a retired model id. '' = the CLI's own
 * default. Codex: read live from the Codex install (its own models cache) via
 * main — a Codex model name typed into source was already retired once.
 */
import { useEffect, useState } from 'react'

export interface AgentModel { id: string; label: string; hint: string; provider: 'Claude' | 'Codex'; efforts?: string[] }

export const CLAUDE_MODELS: AgentModel[] = [
  { id: '', label: 'Claude · Default', hint: "Claude Code's own default model", provider: 'Claude' },
  { id: 'fable', label: 'Claude · Fable', hint: 'Most capable; slowest and most expensive', provider: 'Claude' },
  { id: 'opus', label: 'Claude · Opus', hint: 'Strong reasoning for long, careful work', provider: 'Claude' },
  { id: 'sonnet', label: 'Claude · Sonnet', hint: 'Fast and capable for everyday work', provider: 'Claude' },
  { id: 'haiku', label: 'Claude · Haiku', hint: 'Fastest and cheapest; classification and quick tasks', provider: 'Claude' },
]

/** Before main answers (or without a Codex install): the default pick only. */
const CODEX_FALLBACK: AgentModel[] = [
  { id: 'codex:', label: 'Codex · Default', hint: "The Codex CLI's configured model", provider: 'Codex' },
]

/** @deprecated static view; prefer useAgentModels() for the live Codex list. */
export const AGENT_MODELS: AgentModel[] = [...CLAUDE_MODELS, ...CODEX_FALLBACK]

let codexCache: AgentModel[] | null = null
const listeners = new Set<() => void>()

export interface CodexStatus { available: boolean; account: string; error?: string }
let inFlight: Promise<CodexStatus> | undefined
/** One main round-trip (one app-server) per refresh; the status rides along for Settings. */
export function refreshCodexModels(): Promise<CodexStatus> {
  if (!inFlight) inFlight = fetchCodexModels().finally(() => { inFlight = undefined })
  return inFlight
}
async function fetchCodexModels(): Promise<CodexStatus> {
  let status: CodexStatus = { available: false, account: 'Unavailable' }
  try {
    const res = await window.workspace?.agent?.listModels?.()
    const list = (res?.codex ?? []).filter((m) => typeof m.id === 'string' && m.id.startsWith('codex:'))
    codexCache = list.length ? list.map((m) => ({ ...m, provider: 'Codex' as const })) : CODEX_FALLBACK
    if (res?.status) status = res.status
  } catch (err) {
    codexCache = CODEX_FALLBACK
    status = { available: false, account: 'Unavailable', error: (err as Error).message }
  }
  for (const l of listeners) l()
  return status
}

/** Claude aliases + whatever Codex models the install offers (fetched once, shared). */
export function useAgentModels(): AgentModel[] {
  const [, bump] = useState(0)
  useEffect(() => {
    const l = (): void => bump((n) => n + 1)
    listeners.add(l)
    if (!codexCache) void refreshCodexModels()
    return () => { listeners.delete(l) }
  }, [])
  return [...CLAUDE_MODELS, ...(codexCache ?? CODEX_FALLBACK)]
}

export function modelLabel(id: string | null | undefined): string {
  const key = id ?? ''
  const known = [...CLAUDE_MODELS, ...(codexCache ?? CODEX_FALLBACK)].find((m) => m.id === key)
  if (known) return known.label
  if (key.startsWith('codex:')) return `Codex · ${key.slice(6)}`
  return key || 'Default'
}
