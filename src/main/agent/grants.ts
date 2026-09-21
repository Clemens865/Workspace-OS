import { randomBytes } from 'crypto'
import { getCapability } from './capabilityCatalog'

/**
 * PER-RUN GRANTS for the wos-action bridge (audit findings #2 High / #7 Low;
 * docs/blueprints/agent-bridge-authorization.md).
 *
 * Before this, `handleRequest` gated an action only against the global
 * registry: any agent could run every action. A safe-mode research agent
 * reading an untrusted page could be prompt-injected into clicking around the
 * user's logged-in sessions, or into `memory.remember`, poisoning every later
 * run. None of that was in its grant.
 *
 * Now every launched run gets a TOKEN (env `WOS_AGENT_TOKEN`, minted here,
 * never logged) and a grant. The CLI forwards the token; the bridge looks it
 * up and refuses anything outside the grant.
 *
 * WHAT A GRANT IS. The catalog's `actions` lists are guidance — their names
 * ("files.create") do not match the live registry ("files.new-document"), so
 * intersecting them would deny granted agents real actions. A capability
 * instead grants its SURFACE: the action-id prefixes below. A research agent
 * gets `browser.*` and nothing else; a cases routine gets `cases.*`. Memory
 * search stays on for everyone (an agent that cannot recall is worse, not
 * safer); `memory.remember` is a write and needs an explicit grant.
 *
 * A dock run with no persona keeps the old full grant ('all') — that is the
 * person typing at their own agent, and taking actions away from them is not
 * the fix. The narrowing lands where the risk is: forged specialists and
 * unattended routines.
 */

/** Action-id prefixes each capability may run. */
const SURFACE_PREFIXES: Record<string, readonly string[]> = {
  research: ['browser.'],
  documents: ['files.', 'document.'],
  webpage: ['files.', 'document.'],
  files: ['files.', 'document.'],
  mail: ['mail.'],
  'mail-organize': ['mail.'],
  cases: ['cases.'],
  calendar: ['calendar.'],
  knowledge: ['knowledge.', 'memory.'],
}

/** Every identified run may do these, whatever its grant. */
const BASELINE: readonly string[] = ['memory.search']

export type GrantScope = 'all' | ReadonlySet<string>

export interface Grant {
  /** Codex runs stay bound to the workspace where they were launched. */
  root?: string
  runId: string
  scope: GrantScope
  /** For the log line when something is refused. */
  label: string
}

/** Prefix set for a capability list. Unknown ids are ignored, not widened. */
export function prefixesFor(capabilities: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>()
  for (const id of capabilities) {
    if (!getCapability(id)) continue
    for (const p of SURFACE_PREFIXES[id] ?? []) out.add(p)
  }
  return out
}

/** Pure: may a grant run this action id? */
export function allows(scope: GrantScope, actionId: string): boolean {
  if (scope === 'all') return true
  if (BASELINE.includes(actionId)) return true
  for (const p of scope) if (actionId.startsWith(p)) return true
  return false
}

export class GrantTable {
  private byToken = new Map<string, Grant>()
  private byRun = new Map<string, string>()

  /** Mint a token for a run. `capabilities` = 'all' keeps the legacy full grant. */
  issue(runId: string, capabilities: readonly string[] | 'all', label = runId, root?: string): string {
    this.revoke(runId)
    const token = randomBytes(24).toString('base64url')
    const scope: GrantScope = capabilities === 'all' ? 'all' : prefixesFor(capabilities)
    this.byToken.set(token, { runId, scope, label, ...(root ? { root } : {}) })
    this.byRun.set(runId, token)
    return token
  }

  lookup(token: unknown): Grant | undefined {
    return typeof token === 'string' && token.length > 0 ? this.byToken.get(token) : undefined
  }

  revoke(runId: string): void {
    const t = this.byRun.get(runId)
    if (t) this.byToken.delete(t)
    this.byRun.delete(runId)
  }

  size(): number {
    return this.byToken.size
  }
}

/** The app-wide table. Tests construct their own. */
export const grants = new GrantTable()

/** The env var the launcher sets and the CLI forwards. */
export const AGENT_TOKEN_ENV = 'WOS_AGENT_TOKEN'
