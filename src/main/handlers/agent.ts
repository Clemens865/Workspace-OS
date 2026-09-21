import { IpcMain, BrowserWindow, app, shell } from 'electron'
import { ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { IPC } from '../ipc-channels'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError } from '../ipc-validator'
import {
  isValidClaudeSessionId,
  sanitizePromptPath,
  sanitizeContextFiles,
  CONVERSATION_ID_RE,
} from '../agent-permissions'
import { assertMainFrame } from '../security'
import { readAgentForRun } from './agents'
import { sendToWindow, setMainWindow } from '../main-window'
import { launchRun, resolveClaudeBinary } from '../agent/launchRun'
import { isValidModelAlias, parseModelPick, parseConversation } from '../agent/modelPick'
import { codexCatalog } from '../agent/providers/codexCatalog'
import { answerCodex, steerCodex, cancelCodex, codexRequestUrl } from '../agent/providers/codexSession'
import { getWorkspaceRoot } from '../workspace-root'

/** Settings → Agent model (alias), pushed from the renderer; '' = the CLI's default. */
import { getProviderModel, loadProviderSettings, setProviderModel, setCodexEffort } from '../agent/providerSettings'
export function getDefaultAgentModel(): string { return getProviderModel() }

export { resolveClaudeBinary }

export type { AgentRunMeta } from '../agent/launchRun'

/**
 * Bridges the Agent Terminal to the `claude` CLI. Running the CLI uses the
 * user's existing Claude Code subscription — no API key, no extra cost.
 *
 * Security posture:
 *  - The prompt is fed via stdin, never argv: argv would let a prompt starting
 *    with `--` be parsed as CLI flags (verified: `claude -p "--permission-mode
 *    bogus"` errors as an option), and argv is visible to other local
 *    processes via `ps`.
 *  - Nothing is spawned through a shell, so terminal input can't inject shell
 *    commands.
 *  - Both modes run under the default permission mode with scoped
 *    allow/deny lists (see ../agent-permissions.ts) — no bypassPermissions.
 */

const runs = new Map<string, ChildProcess>()
const startingCodex = new Map<string, AbortController>()

// Maps a renderer conversation (one per agent-terminal tab) to the `claude`
// session id captured from its first turn, so later turns can --resume it and
// keep conversation memory. Without this every message is a fresh, amnesiac run.
// Capped LRU-ish: Map preserves insertion order; reads reinsert to refresh
// recency, and sets over the cap evict the oldest entry.
const conversations = new Map<string, string>()
const MAX_CONVERSATIONS = 50

function getConversation(convoId: string): string | undefined {
  const sid = conversations.get(convoId)
  if (sid !== undefined) {
    // Refresh recency so active tabs aren't evicted before idle ones.
    conversations.delete(convoId)
    conversations.set(convoId, sid)
  }
  return sid
}

function setConversation(convoId: string, sid: string): void {
  conversations.delete(convoId)
  conversations.set(convoId, sid)
  if (conversations.size > MAX_CONVERSATIONS) {
    const oldest = conversations.keys().next().value
    if (oldest !== undefined) conversations.delete(oldest)
  }
  persistConversations()
}

/** Drops a conversation mapping when its tab closes, so the cache (and the
 *  persisted file) don't retain resume-ids for tabs that no longer exist — the
 *  eviction now happens on close, not only when the map overflows past its cap. */
function forgetConversation(convoId: string): void {
  if (conversations.delete(convoId)) persistConversations()
}

// The conversationId → claude-session-id map survives restarts so restored
// agent tabs can --resume their conversations (the renderer persists the
// conversationId per tab; claude keeps the session transcript on disk).
const CONVERSATIONS_FILE = (): string =>
  path.join(app.getPath('userData'), 'agent-conversations.json')

function loadPersistedConversations(): void {
  try {
    const raw = fs.readFileSync(CONVERSATIONS_FILE(), 'utf-8')
    const entries = JSON.parse(raw) as unknown
    if (!Array.isArray(entries)) return
    for (const pair of entries.slice(-MAX_CONVERSATIONS)) {
      // Re-validate shapes on load: the session id becomes the `--resume`
      // argv value, so a tampered file must not be able to smuggle a flag.
      if (
        Array.isArray(pair) &&
        typeof pair[0] === 'string' && CONVERSATION_ID_RE.test(pair[0]) &&
        parseConversation(pair[1]) !== null
      ) {
        conversations.set(pair[0], pair[1])
      }
    }
  } catch {
    // No persisted conversations yet — fine.
  }
}

let convoSaveTimer: NodeJS.Timeout | null = null
function persistConversations(): void {
  if (convoSaveTimer) return
  convoSaveTimer = setTimeout(() => {
    convoSaveTimer = null
    flushConversations()
  }, 500)
  convoSaveTimer.unref?.()
}

function flushConversations(): void {
  if (convoSaveTimer) {
    clearTimeout(convoSaveTimer)
    convoSaveTimer = null
  }
  try {
    fs.writeFileSync(CONVERSATIONS_FILE(), JSON.stringify([...conversations]))
  } catch {
    // Persistence is best-effort; an unwritable userData dir shouldn't block runs.
  }
}

/** Resolves the claude binary once. GUI apps on macOS get a thin PATH, so we
 *  probe common install locations before falling back to PATH lookup. */

function assertRunId(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-z0-9-]{6,40}$/.test(id)) {
    throw new IpcValidationError('Invalid run id')
  }
  return id
}


export function registerAgentHandlers(ipcMain: IpcMain, win: BrowserWindow): void {
  setMainWindow(win)
  loadProviderSettings(app.getPath('userData'))
  loadPersistedConversations()

  // Settings → Agent model, mirrored here so routines and the interactive
  // session (which start in main) use the same default as dock runs.
  ipcHandle(ipcMain, 'agent:set-default-model', (_event, model: unknown) => {
    setProviderModel(model)
  })

  // The models a run can be pinned to beyond the Claude aliases: what the Codex
  // install actually offers right now (its own cache), never a list typed into source.
  ipcHandle(ipcMain, 'agent:list-models', async (event) => {
    assertMainFrame(event)
    const catalog = await codexCatalog(getWorkspaceRoot() ?? undefined)
    return { codex: catalog.models, status: { available: catalog.available, account: catalog.account, error: catalog.error } }
  })

  ipcHandle(ipcMain, 'codex:set-effort', (event, effort) => { assertMainFrame(event); setCodexEffort(effort) })
  ipcHandle(ipcMain, 'codex:respond', (event, runId, requestId, response) => {
    assertMainFrame(event)
    if (typeof runId !== 'string' || typeof requestId !== 'string') throw new IpcValidationError('Invalid Codex request')
    return answerCodex(runId, requestId, response)
  })
  ipcHandle(ipcMain, 'codex:open-request', async (event, runId, requestId) => {
    assertMainFrame(event)
    if (typeof runId !== 'string' || typeof requestId !== 'string') throw new IpcValidationError('Invalid Codex request')
    await shell.openExternal(codexRequestUrl(runId, requestId))
  })
  ipcHandle(ipcMain, 'codex:steer', (event, runId, text) => {
    assertMainFrame(event)
    if (typeof runId !== 'string' || typeof text !== 'string' || !text.trim() || text.length > 20000) throw new IpcValidationError('Invalid Codex input')
    return steerCodex(runId, text)
  })

  ipcHandle(ipcMain, IPC.AGENT_RUN, async (event, payload: unknown) => {
    assertMainFrame(event)
    const { runId, prompt, contextFiles, activeFile, mode, agentName, conversationId, model, resumeOnly } = payload as {
      runId: unknown
      prompt: unknown
      contextFiles?: unknown
      activeFile?: unknown
      mode?: unknown
      agentName?: unknown
      model?: unknown
      conversationId?: unknown
      resumeOnly?: unknown
    }
    const id = assertRunId(runId)
    // Stable per-tab conversation key; resume its claude session if we've seen it.
    const convoId = typeof conversationId === 'string' && CONVERSATION_ID_RE.test(conversationId) ? conversationId : null
    const stored = convoId ? getConversation(convoId) : undefined
    // Belt-and-braces: the resume id rides argv, so it must look like a UUID.
    // A conversation remembers "<provider>:<sid>": a thread can only be resumed by the CLI that made it.
    const storedProvider = stored?.includes(':') ? stored.slice(0, stored.indexOf(':')) : 'claude'
    const storedSid = stored?.includes(':') ? stored.slice(stored.indexOf(':') + 1) : stored
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new IpcValidationError('Prompt must be a non-empty string')
    }
    if (prompt.length > 20_000) throw new IpcValidationError('Prompt too long')

    // Selected persona (if any). Its body grounds the system prompt; its
    // wos_mode is a fallback when the session didn't pin a mode.
    const agent = typeof agentName === 'string' && agentName ? readAgentForRun(agentName) : null
    // 'safe' = read + generate only; 'full' (default) = run any command.
    const safeMode = mode === 'safe' || (mode === undefined && agent?.mode === 'safe')
    // Model precedence: the run's own pick → the agent's wos_model → Settings → the CLI's default.
    // A pick is "<provider>:<model>" or a bare Claude alias.
    const pick = parseModelPick(isValidModelAlias(model) ? model : isValidModelAlias(agent?.model) ? agent.model : getDefaultAgentModel())
    const resumeId = isValidClaudeSessionId(storedSid) && storedProvider === pick.provider ? storedSid : undefined
    if (resumeOnly === true && !resumeId) {
      throw new IpcValidationError('The original conversation is no longer available. Start a new request asking the agent to inspect the case files and finish the remaining work.')
    }

    const aborter = pick.provider === 'codex' ? new AbortController() : undefined
    if (aborter) startingCodex.set(id, aborter)
    let completed = false
    let sessionCaptured = false
    const { child, checkpointId } = await launchRun({
      runId: id,
      prompt,
      contextFiles: sanitizeContextFiles(contextFiles),
      activeFile: sanitizePromptPath(activeFile),
      safeMode,
      agent,
      resumeId,
      model: pick.model || undefined,
      provider: pick.provider,
      signal: aborter?.signal,
      // A forged specialist is held to its capabilities; a plain dock agent is
      // the person at their own keyboard and keeps the full grant.
      capabilities: agent?.capabilities?.length ? agent.capabilities : 'all',
      sink: {
        output: (t) => sendToWindow(IPC.AGENT_OUTPUT, id, t),
        sessionId: convoId ? (sid) => {
          sessionCaptured = true
          setConversation(convoId, `${pick.provider}:${sid}`)
        } : undefined,
        meta: (m) => sendToWindow(IPC.AGENT_RUN_META, id, m),
        activity: (a) => sendToWindow(IPC.AGENT_ACTIVITY, id, a),
        artifacts: (list) => sendToWindow(IPC.AGENT_ARTIFACTS, id, list),
        artifact: (p) => sendToWindow(IPC.AGENT_ARTIFACT, id, p),
        done: (code, cp, failure) => {
          completed = true
          runs.delete(id)
          sendToWindow(IPC.AGENT_DONE, id, code, cp, failure ? {
            ...failure, canResume: sessionCaptured && !!convoId && !!getConversation(convoId),
          } : undefined)
        },
      },
    }).finally(() => startingCodex.delete(id))
    if (!completed) runs.set(id, child)
    return { pid: child.pid, checkpointId, provider: pick.provider, model: `${pick.provider}:${pick.model}` }
  })

  ipcHandle(ipcMain, IPC.AGENT_CANCEL, (_event, runId: unknown) => {
    const id = assertRunId(runId)
    startingCodex.get(id)?.abort()
    if (cancelCodex(id)) { runs.delete(id); return }
    const child = runs.get(id)
    if (child) {
      child.kill('SIGTERM')
      runs.delete(id)
    }
  })

  // Called by the renderer when an agent tab is closed: forget its conversation
  // mapping so a closed tab's resume-id is evicted promptly (not left until the
  // 50-entry cap rolls it off). Silently ignores an unknown/invalid id.
  ipcHandle(ipcMain, IPC.AGENT_FORGET_CONVERSATION, (_event, conversationId: unknown) => {
    if (typeof conversationId === 'string' && CONVERSATION_ID_RE.test(conversationId)) {
      forgetConversation(conversationId)
    }
  })
}

/**
 * Pulls user-visible text out of one stream-json line. Streams assistant
 * `text_delta`s as they arrive; ignores thinking, signatures, and system
 * metadata. Non-JSON lines (rare warnings) pass through verbatim.
 */
/** Stops all running agents — called on app quit. */
export function shutdownAgents(): void {
  for (const aborter of startingCodex.values()) aborter.abort()
  startingCodex.clear()
  for (const child of runs.values()) child.kill('SIGTERM')
  runs.clear()
  flushConversations() // resume ids must hit disk before the map is dropped
  conversations.clear()
}
