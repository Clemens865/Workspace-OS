import fs from 'fs'
import path from 'path'
import { getWorkspaceRoot } from '../workspace-root'

/**
 * The live workspace "harness" — the shared context every terminal + agent
 * session carries: where the user is in the app and what Workspace-OS can do.
 *
 * The renderer pushes updates (rail change → surface, active file → openFile /
 * folder) via `window.workspace.context.set(...)`. Each `setContext` merges,
 * so FUTURE shell spawns inherit the current env, and best-effort writes a
 * machine-readable `<root>/.workspace-os/agent-context.json` for CLI/agents.
 */

/** The surfaces of the shell (rail ids), mapped to a human label in the prompt. */
export type WorkspaceSurface =
  | 'files'
  | 'home'
  | 'mail'
  | 'knowledge'
  | 'browser'
  | 'agents'
  | 'settings'
  | string

export interface WorkspaceContext {
  /** Absolute workspace root. */
  root: string | null
  /** Current surface (rail): Files / Home / Mail / Knowledge / Browser / Agents. */
  surface: WorkspaceSurface | null
  /** Absolute folder the user is currently in (defaults to root). */
  folder: string | null
  /** Absolute path of the open file, if any. */
  openFile: string | null
  /**
   * The page open in the in-app browser, when there is one.
   *
   * Without this, an agent started in the terminal has no idea the user is
   * looking at anything: it can drive the browser, but it cannot see where the
   * browser already IS. That gap is why "can you see this job posting?" got
   * "nothing came through with your message" — a perfectly correct answer to a
   * question the harness never told it about.
   */
  browserUrl: string | null
  browserTitle: string | null
  /** What Workspace-OS can do here — a stable capability list. */
  canDo: string[]
  /**
   * The per-surface action manifest the renderer computes from the SAME
   * surfaceActions registry the dock chips use — {id, agentHint} for the actions
   * available at the current harness. Pushed via context.set; drives the agent
   * preamble AND the socket server's `list` answer. Empty until the first push.
   */
  actions: WorkspaceAction[]
  /**
   * Every registered action id across all surfaces (not just the current one).
   * The allow-set the socket server validates `run <id>` against — an id absent
   * here is rejected. Empty until the first push (then the bridge is inert-safe).
   */
  allActionIds: string[]
}

/** One entry of the per-surface action manifest (id + one-line capability). */
export interface WorkspaceAction {
  id: string
  agentHint: string
}

/** The capabilities WOS advertises to every session (stable v1 list). */
const CAN_DO: string[] = [
  'edit-office',
  'generate-docs',
  'run-shell',
  'search-workspace',
  'read-mail',
  'knowledge-graph',
  'browse-web',
  'run-agents',
]

let context: WorkspaceContext = {
  root: getWorkspaceRoot(),
  surface: null,
  folder: null,
  openFile: null,
  browserUrl: null,
  browserTitle: null,
  canDo: CAN_DO,
  actions: [],
  allActionIds: [],
}

export function getContext(): WorkspaceContext {
  return context
}

/** Merge a partial update into the live context + persist a best-effort file. */
export function setContext(partial: Partial<WorkspaceContext>): WorkspaceContext {
  context = { ...context, ...partial }
  // Keep canDo authoritative — the renderer never removes capabilities.
  if (!context.canDo || context.canDo.length === 0) context.canDo = CAN_DO
  if (!context.root) context.root = getWorkspaceRoot()
  writeContextFile()
  return context
}

/** Env vars injected into every spawned shell so the harness travels with it. */
export function getContextEnv(): Record<string, string> {
  const root = context.root ?? getWorkspaceRoot() ?? ''
  return {
    WOS_WORKSPACE: root,
    WOS_SURFACE: context.surface ?? '',
    // `||`, not `??`: an empty folder string is "no folder", and a shell spawned
    // with cwd '' lands in `/` instead of the workspace.
    WOS_FOLDER: context.folder || root,
    WOS_OPEN_FILE: context.openFile ?? '',
    // Spawn-time only, so it goes stale the moment the user navigates. It is a
    // hint for a shell that starts on a page; `wos-action context` is the live
    // answer and is what an agent should consult.
    WOS_BROWSER_URL: context.browserUrl ?? '',
    WOS_BROWSER_TITLE: context.browserTitle ?? '',
    WOS_CAN_DO: (context.canDo ?? CAN_DO).join(','),
  }
}

/** A short human string handed to agent tabs so they know where the user is. */
export function contextPrompt(): string {
  const c = context
  const lines: string[] = []
  lines.push('You are inside Workspace-OS, running alongside the user.')
  if (c.root) lines.push(`Workspace root: ${c.root}`)
  if (c.surface) lines.push(`Current surface: ${c.surface}`)
  if (c.folder && c.folder !== c.root) lines.push(`Current folder: ${c.folder}`)
  if (c.openFile) lines.push(`Open file: ${c.openFile}`)
  if (c.browserUrl) {
    lines.push(`The user is looking at this page in the in-app browser: ${c.browserUrl}${c.browserTitle ? ` — "${c.browserTitle}"` : ''}`)
    lines.push('You can read it with `wos-action run browser.extract` — do that before saying you cannot see a page.')
  }
  lines.push(`Workspace-OS can: ${(c.canDo ?? CAN_DO).join(', ')}.`)
  return lines.join('\n')
}

/**
 * A short guide appended to the agent's first-turn system prompt: how to EXECUTE
 * workspace actions via the `wos-action` CLI, plus the current surface's action
 * manifest ({id — agentHint}). Returns '' when no manifest has been pushed yet
 * (so the guide is inert until the renderer advertises actions). All listed
 * actions are non-destructive by construction.
 */
export function agentActionGuide(): string {
  const c = context
  if (!c.actions || c.actions.length === 0) return ''
  const lines = c.actions.map((a) => `  - ${a.id} — ${a.agentHint}`)
  return [
    'You can EXECUTE workspace actions that drive the live UI by running the `wos-action` CLI (on your PATH):',
    '  - `wos-action list` — the actions available here + everywhere (JSON).',
    '  - `wos-action context` — the live harness (root/surface/open file) as JSON.',
    '  - `wos-action run <id> [jsonArgs]` — perform an action; prints {ok,result?|error?} JSON.',
    'Every exposed action is non-destructive (new doc/folder, export, duplicate, reveal, search, compose a DRAFT). It can never send or delete.',
    `Actions available right now (surface: ${c.surface ?? 'none'}):`,
    ...lines,
  ].join('\n')
}

/** Best-effort: write the machine-readable context file under the workspace. */
function writeContextFile(): void {
  const root = context.root ?? getWorkspaceRoot()
  if (!root) return
  try {
    const dir = path.join(root, '.workspace-os')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'agent-context.json'),
      JSON.stringify({ ...context, updatedAt: Date.now() }, null, 2),
      'utf-8',
    )
  } catch {
    /* best-effort — never block the UI on a context write */
  }
}
