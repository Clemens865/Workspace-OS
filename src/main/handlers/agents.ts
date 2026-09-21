import { IpcMain } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { IPC } from '../ipc-channels'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError } from '../ipc-validator'
import { getWorkspaceRoot } from '../workspace-root'
import { CAPABILITY_CATALOG } from '../agent/capabilityCatalog'
import { buildAgentSpec } from '../agent/foundry'
import { parseAgentMd, serializeAgentMd } from '../agent/agentFormat'

/**
 * User-defined agents ("personas") for the IWE agent. Stored as native
 * `.claude/agents/<name>.md` files — YAML frontmatter (name/description, plus
 * the WOS-specific `wos_mode`/`wos_skills`/`wos_capabilities`/`wos_surface`)
 * and a markdown body that is the agent's persona/instructions. Native format
 * so they also work in the bare `claude` CLI; the app applies one by injecting
 * its body + granted capabilities into the system prompt (see handlers/agent.ts).
 */

export interface AgentInfo {
  name: string
  description: string
  scope: 'global' | 'project'
  mode?: 'full' | 'safe'
  /** Agent Foundry: granted capability ids from the capability catalog. */
  capabilities?: string[]
  /** Agent Foundry: the specialist's home rail (a catalog surface). */
  surface?: string
  /** Preferred model alias (wos_model); unset = Settings → Agent model. */
  model?: string
}

export interface AgentFile extends AgentInfo {
  persona: string
  skills: string[]
}

const globalDir = (): string => path.join(os.homedir(), '.claude', 'agents')
const projectDir = (): string | null => {
  const root = getWorkspaceRoot()
  return root ? path.join(root, '.claude', 'agents') : null
}

/** A safe, file-system-friendly slug for an agent name. */
function slug(name: string): string {
  const s = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (!s) throw new IpcValidationError('Invalid agent name')
  return s
}

/** Parses one agent `.md` (frontmatter + body) into a full record. */
function parseAgent(md: string, fallbackName: string, scope: 'global' | 'project'): AgentFile {
  return { ...parseAgentMd(md, fallbackName), scope }
}

function listDir(dir: string, scope: 'global' | 'project'): AgentInfo[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: AgentInfo[] = []
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue
    try {
      const a = parseAgent(fs.readFileSync(path.join(dir, e.name), 'utf-8'), e.name.replace(/\.md$/, ''), scope)
      out.push({ name: a.name, description: a.description, scope, mode: a.mode, capabilities: a.capabilities, surface: a.surface, model: a.model })
    } catch {
      /* skip unreadable */
    }
  }
  return out
}

/** Resolves the on-disk path for an agent slug in the given scope. */
function agentPath(name: string, scope: 'global' | 'project'): string {
  const dir = scope === 'project' ? projectDir() : globalDir()
  if (!dir) throw new IpcValidationError('No workspace folder is open')
  return path.join(dir, `${slug(name)}.md`)
}

export function registerAgentsHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, IPC.AGENTS_LIST, () => {
    const global = listDir(globalDir(), 'global')
    const pd = projectDir()
    const project = pd ? listDir(pd, 'project') : []
    const byName = new Map<string, AgentInfo>()
    for (const a of [...global, ...project]) byName.set(a.name, a) // project wins
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  })

  ipcHandle(ipcMain, IPC.AGENTS_READ, (_e, name: unknown, scope: unknown) => {
    if (typeof name !== 'string') throw new IpcValidationError('Invalid agent name')
    const sc: 'global' | 'project' = scope === 'project' ? 'project' : 'global'
    const p = agentPath(name, sc)
    return parseAgent(fs.readFileSync(p, 'utf-8'), name, sc)
  })

  ipcHandle(ipcMain, IPC.AGENTS_WRITE, (_e, payload: unknown) => {
    const a = payload as Partial<AgentFile> & { scope?: 'global' | 'project' }
    if (!a || typeof a.name !== 'string' || !a.name.trim()) throw new IpcValidationError('Agent name is required')
    const scope: 'global' | 'project' = a.scope === 'project' ? 'project' : 'global'
    const md = serializeAgentMd({ ...a, name: a.name })
    const p = agentPath(a.name, scope)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, md, 'utf-8')
    return { name: a.name, path: p, scope }
  })

  ipcHandle(ipcMain, IPC.AGENTS_DELETE, (_e, name: unknown, scope: unknown) => {
    if (typeof name !== 'string') throw new IpcValidationError('Invalid agent name')
    const sc: 'global' | 'project' = scope === 'project' ? 'project' : 'global'
    fs.rmSync(agentPath(name, sc), { force: true })
  })

  // Agent Foundry: expose the capability catalog to the renderer (the UI palette
  // of what a specialist can be given). Guidance strings are internal (run-prompt
  // only), so the getter returns just the UI-relevant fields.
  ipcHandle(ipcMain, IPC.AGENTS_CAPABILITIES, () =>
    CAPABILITY_CATALOG.map((c) => ({
      id: c.id,
      label: c.label,
      description: c.description,
      surface: c.surface,
      actions: c.actions,
      toolMode: c.toolMode,
    })),
  )

  // Agent Foundry: the meta-agent. A plain-language description → a validated
  // agent-spec PROPOSAL (name/description/persona/capabilities/surface/mode).
  // Returns the proposal only — the UI previews it and the user approves before
  // calling AGENTS_WRITE. Never writes to disk here.
  ipcHandle(ipcMain, IPC.AGENTS_BUILD, async (_e, description: unknown) => {
    if (typeof description !== 'string' || !description.trim()) {
      throw new IpcValidationError('A description is required to build an agent')
    }
    return buildAgentSpec(description)
  })
}

/** Reads an agent for the run path (handlers/agent.ts). Tries project then global. */
export function readAgentForRun(name: string): AgentFile | null {
  for (const scope of ['project', 'global'] as const) {
    const dir = scope === 'project' ? projectDir() : globalDir()
    if (!dir) continue
    try {
      const p = path.join(dir, `${slug(name)}.md`)
      return parseAgent(fs.readFileSync(p, 'utf-8'), name, scope)
    } catch {
      /* try next scope */
    }
  }
  return null
}
