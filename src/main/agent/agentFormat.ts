/**
 * Pure (no-electron) parse/serialize for the agent `.md` file format, so the
 * round-trip is unit-testable without the electron app. Owned by handlers/
 * agents.ts, which layers file-system I/O on top. Frontmatter carries
 * name/description plus the WOS fields wos_mode / wos_skills and the Agent
 * Foundry fields wos_capabilities / wos_surface; the body is the persona.
 */

import { isValidModelAlias } from './modelPick'
import { validCapabilities, isSurface } from './capabilityCatalog'

export interface ParsedAgent {
  name: string
  description: string
  mode?: 'full' | 'safe'
  skills: string[]
  capabilities: string[]
  surface?: string
  persona: string
  /** wos_model alias, when the file pins one. */
  model?: string
}

/** Parses one agent `.md` (frontmatter + body). Unknown caps/surfaces dropped. */
export function parseAgentMd(md: string, fallbackName: string): ParsedAgent {
  let name = fallbackName
  let description = ''
  let mode: 'full' | 'safe' | undefined
  let skills: string[] = []
  let capabilities: string[] = []
  let surface: string | undefined
  let model: string | undefined
  let body = md
  const fm = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(md)
  if (fm) {
    body = fm[2]
    for (const line of fm[1].split('\n')) {
      const m = /^(name|description|wos_mode|wos_skills|wos_capabilities|wos_surface|wos_model):\s*(.+?)\s*$/.exec(line)
      if (!m) continue
      const val = m[2].replace(/^["']|["']$/g, '')
      if (m[1] === 'name') name = val
      else if (m[1] === 'description') description = val
      else if (m[1] === 'wos_mode') mode = val === 'safe' ? 'safe' : 'full'
      else if (m[1] === 'wos_skills') skills = val.split(',').map((s) => s.trim()).filter(Boolean)
      else if (m[1] === 'wos_capabilities') capabilities = validCapabilities(val.split(',').map((s) => s.trim()))
      else if (m[1] === 'wos_surface') surface = isSurface(val) ? val : undefined
      else if (m[1] === 'wos_model') model = isValidModelAlias(val) ? val : undefined
    }
  }
  return { name, description, mode, skills, capabilities, surface, model, persona: body.trim() }
}

export interface SerializeInput {
  name: string
  description?: string
  persona?: string
  mode?: 'full' | 'safe'
  skills?: unknown
  capabilities?: unknown
  surface?: unknown
  /** Model alias the agent prefers ('fable' | 'opus' | 'sonnet' | 'haiku'); unset = the app default. */
  model?: unknown
}

/** Serializes an agent into its `.md` text. Clamps caps/surface to the catalog. */
export function serializeAgentMd(a: SerializeInput): string {
  const mode: 'full' | 'safe' = a.mode === 'safe' ? 'safe' : 'full'
  const skills = Array.isArray(a.skills) ? a.skills.filter((s): s is string => typeof s === 'string') : []
  const capabilities = validCapabilities(a.capabilities)
  const surface = isSurface(a.surface) ? a.surface : undefined
  const fmName = a.name.trim().replace(/"/g, "'")
  const desc = (a.description ?? '').trim().replace(/\n/g, ' ').replace(/"/g, "'")
  return (
    `---\n` +
    `name: ${fmName}\n` +
    `description: ${desc}\n` +
    `wos_mode: ${mode}\n` +
    (skills.length ? `wos_skills: ${skills.join(', ')}\n` : '') +
    (capabilities.length ? `wos_capabilities: ${capabilities.join(', ')}\n` : '') +
    (isValidModelAlias(a.model) ? `wos_model: ${a.model}\n` : '') +
    (surface ? `wos_surface: ${surface}\n` : '') +
    `---\n\n` +
    `${(a.persona ?? '').trim()}\n`
  )
}
