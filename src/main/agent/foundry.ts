/**
 * Agent Foundry — the META-AGENT.
 *
 * Given a plain-language description of a specialty, Claude AUTHORS a specialist
 * agent spec: a friendly name, one calm description line, a strong 2nd-person
 * persona, a subset of catalog capabilities that fit, the best home surface, and
 * a safe/full mode. This module owns the BUILDER prompt, the strict-JSON parse,
 * and the validator that clamps the model's output to the catalog.
 *
 * It returns a PROPOSAL only — the UI previews it and the user approves before
 * anything is written via `agents.write`. Nothing here touches disk.
 */

import { CAPABILITY_CATALOG, SURFACES, validCapabilities, isSurface, requiredMode, type Surface, type ToolMode } from './capabilityCatalog'
import { runProviderJson } from './providerText'

export interface AgentSpec {
  name: string
  description: string
  persona: string
  capabilities: string[]
  surface?: Surface
  mode: ToolMode
}

export interface BuildResult {
  ok: boolean
  spec?: AgentSpec
  error?: string
}

const MAX_DESCRIPTION = 2000
const BUILD_TIMEOUT_MS = 90_000

/** The catalog, rendered for the builder prompt so the model picks real ids. */
function catalogForPrompt(): string {
  return CAPABILITY_CATALOG.map(
    (c) => `  - "${c.id}" (${c.label}, home surface: ${c.surface}): ${c.description}`,
  ).join('\n')
}

/** The BUILDER system prompt: describes the job + the STRICT JSON contract. */
function builderPrompt(strictNudge: boolean): string {
  const lines = [
    'You are the Agent Foundry: you forge a specialized Workspace OS agent from a plain-language description of a specialty.',
    'Given the user\'s description, design ONE agent and return it as a SINGLE JSON object — nothing else.',
    '',
    'The available capabilities you may grant (choose only the ones the specialty truly needs):',
    catalogForPrompt(),
    '',
    `Valid home surfaces: ${SURFACES.join(', ')}. Pick the one the specialist lives on most.`,
    '',
    'Return EXACTLY this JSON shape (no markdown fence, no prose, no trailing commentary):',
    '{',
    '  "name": "<a friendly human first name + role, e.g. \\"Vera — Prospect Researcher\\">",',
    '  "description": "<one calm line describing what this agent does>",',
    '  "persona": "<a strong system prompt written in the SECOND person (\\"You are…\\"), 3-6 sentences, that shapes how the agent works>",',
    '  "capabilities": [<subset of the capability ids above that fit>],',
    `  "surface": "<one of: ${SURFACES.join(', ')}>",`,
    '  "mode": "<\\"safe\\" unless the specialty clearly needs to run arbitrary commands, then \\"full\\">"',
    '}',
    '',
    'Rules: prefer "safe" mode. Only grant capabilities the description implies — except "cases", which every agent receives automatically: an agent\'s run lives in a case (the thread of the work), so write the persona knowing the agent will open or continue one. The name must feel human and warm.',
  ]
  if (strictNudge) {
    lines.unshift('Your previous reply was not valid JSON. Return ONLY a single valid JSON object and nothing else.', '')
  }
  return lines.join('\n')
}

/** Extracts the first balanced JSON object from a model reply (tolerates fences). */
function extractJson(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/**
 * Validates + clamps a parsed builder object into a safe AgentSpec:
 *  - requires a non-empty name AND persona (else null),
 *  - drops unknown capability ids,
 *  - clamps mode to 'safe' unless it is exactly 'full',
 *  - keeps surface only if it is a real catalog surface.
 * Pure — trivially unit-testable with a mocked model object.
 */
export function validateBuildOutput(raw: unknown): AgentSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  const persona = typeof o.persona === 'string' ? o.persona.trim() : ''
  if (!name || !persona) return null
  const description = typeof o.description === 'string' ? o.description.trim().replace(/\s+/g, ' ') : ''
  const capabilities = validCapabilities(o.capabilities)
  // Every agent's run lives in a case — the thread the cockpit shows, the user
  // annotates ("applied for this one"), and the NEXT run reads. An agent
  // without `cases` writes files nobody's cockpit ever hears about, which is
  // how the job scout produced a perfect workbook and an empty cockpit. So
  // `cases` is standing equipment, not a choice the builder model can forget.
  if (!capabilities.includes('cases')) capabilities.push('cases')
  const surface = isSurface(o.surface) ? o.surface : undefined
  // Mode is DERIVED, not trusted. The builder prompt says "prefer safe", and the
  // model duly returned safe for a travel planner whose whole description was
  // about opening a browser tab per option and comparing them — which safe mode
  // cannot do (no Task/Agent, so no parallel fan-out). An agent that silently
  // loses the capability its description asked for is the worst failure mode for
  // "describe it and it exists", so the catalog decides: each capability declares
  // the LEAST privilege it needs, and the agent gets the highest of those. The
  // model can still escalate to full on its own judgement; it can no longer
  // under-grant below what the granted capabilities require.
  const asked: ToolMode = o.mode === 'full' ? 'full' : 'safe'
  const required: ToolMode = requiredMode(capabilities)
  const mode: ToolMode = asked === 'full' || required === 'full' ? 'full' : 'safe'
  return { name, description, persona, capabilities, surface, mode }
}

/** Parses a raw model reply → AgentSpec, or null if unparseable/invalid. */
function parseSpec(text: string): AgentSpec | null {
  const json = extractJson(text)
  if (!json) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  return validateBuildOutput(parsed)
}

/**
 * Runs the meta-agent: description → validated AgentSpec proposal. Retries once
 * with a strict-JSON nudge on a parse failure, then gives up with a clear error.
 * Never writes to disk — the caller previews + the user approves.
 */
export async function buildAgentSpec(description: string): Promise<BuildResult> {
  const desc = typeof description === 'string' ? description.trim() : ''
  if (!desc) return { ok: false, error: 'Describe the specialist you want to build.' }
  if (desc.length > MAX_DESCRIPTION) return { ok: false, error: 'Description is too long.' }

  for (let attempt = 0; attempt < 2; attempt++) {
    let res
    try {
      res = await runProviderJson({
        prompt: desc,
        systemPrompt: builderPrompt(attempt > 0),
        timeoutMs: BUILD_TIMEOUT_MS,
      })
    } catch (err) {
      return { ok: false, error: `Could not start the builder: ${(err as Error).message}` }
    }
    if (res.timedOut) return { ok: false, error: 'The builder timed out. Try a shorter description.' }
    const spec = parseSpec(res.text)
    if (spec) return { ok: true, spec }
    // else: loop retries once with the strict nudge.
  }
  return { ok: false, error: 'The builder did not return a valid agent. Please rephrase the description.' }
}
