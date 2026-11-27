/**
 * What the Agent Foundry edits and how it saves: a new specialist, an existing
 * one, or a copy. The rule throughout: a save never silently replaces a
 * different agent. Pure (the agents IPC is passed in), so it is unit-tested.
 */
import { agentSlug } from '../../../../shared/agentRun'

export type AgentScope = 'global' | 'project'

/** The editable draft bound to the Foundry's preview and fields. */
export interface AgentDraft {
  name: string
  description: string
  persona: string
  mode: 'safe' | 'full'
  /** '' = the app's model (Settings → Models). */
  model: string
  capabilities: string[]
  skills: string[]
  surface: string
}

export type FoundryRequest = { kind: 'new' } | { kind: 'edit' | 'duplicate'; name: string; scope: AgentScope }

/** Where a draft came from, which decides where it may be saved. `read` is the file as it was opened. */
export type DraftOrigin = { kind: 'new' } | { kind: 'edit'; name: string; scope: AgentScope; read: string } | { kind: 'duplicate'; name: string; scope: AgentScope }

export type AgentsApi = Pick<Window['workspace']['agents'], 'list' | 'read' | 'write'>
type AgentFile = Awaited<ReturnType<AgentsApi['read']>>

/** Reads a `wos:new-agent` event's detail. */
export function foundryRequest(detail: unknown): FoundryRequest {
  const d = (detail ?? {}) as { edit?: unknown; duplicate?: unknown; scope?: unknown }
  const scope: AgentScope = d.scope === 'project' ? 'project' : 'global'
  if (typeof d.edit === 'string') return { kind: 'edit', name: d.edit, scope }
  if (typeof d.duplicate === 'string') return { kind: 'duplicate', name: d.duplicate, scope }
  return { kind: 'new' }
}

function toDraft(a: AgentFile): AgentDraft {
  return {
    name: a.name,
    description: a.description,
    persona: a.persona,
    mode: a.mode ?? 'full',
    model: a.model ?? '',
    capabilities: a.capabilities ?? [],
    skills: a.skills ?? [],
    surface: a.surface ?? '',
  }
}
const fingerprint = (a: AgentFile): string => JSON.stringify([a.name, toDraft(a)])

/** Whether some agent (in either scope) is already saved under this name's file. */
const taken = (name: string, list: { name: string }[]): boolean => list.some((a) => agentSlug(a.name) === agentSlug(name))

function copyName(name: string, list: { name: string }[]): string {
  let next = `${name} copy`
  for (let n = 2; taken(next, list); n++) next = `${name} copy ${n}`
  return next
}

/** Opens an existing agent for editing, or prefills a copy of it. */
export async function loadDraft(request: Exclude<FoundryRequest, { kind: 'new' }>, api: AgentsApi): Promise<{ draft: AgentDraft; origin: DraftOrigin }> {
  const { kind, name, scope } = request
  const a = await api.read(name, scope)
  // The file is found by name: one that says it is someone else must not be saved over.
  if (a.name !== name) throw new Error(`The file for “${name}” holds another agent (“${a.name}”), so it cannot be opened here.`)
  if (kind === 'edit') return { draft: toDraft(a), origin: { kind, name, scope, read: fingerprint(a) } }
  return { draft: { ...toDraft(a), name: copyName(name, await api.list()) }, origin: { kind, name, scope } }
}

/** Saves a draft. Editing writes back to its own agent; anything else only ever creates one. */
export async function saveDraft(draft: AgentDraft, origin: DraftOrigin, api: AgentsApi): Promise<void> {
  const scope: AgentScope = origin.kind === 'new' ? 'global' : origin.scope
  const name = origin.kind === 'edit' ? origin.name : draft.name.trim()
  if (origin.kind === 'edit') {
    const now = await api.read(name, scope).catch(() => null)
    if (!now) throw new Error(`“${name}” is no longer there; nothing was saved.`)
    if (fingerprint(now) !== origin.read) throw new Error(`“${name}” changed since you opened it; nothing was saved. Close and open it again.`)
  } else if (taken(name, await api.list())) {
    throw new Error(`An agent named “${name}” already exists. Choose another name.`)
  }
  await api.write({
    name,
    scope,
    description: draft.description,
    persona: draft.persona,
    mode: draft.mode,
    model: draft.model || undefined,
    capabilities: draft.capabilities,
    skills: draft.skills,
    surface: draft.surface || undefined,
    ...(origin.kind === 'edit' ? {} : { createOnly: true }),
    ...(origin.kind === 'duplicate' ? { copyFrom: { name: origin.name, scope: origin.scope } } : {}),
  })
}
