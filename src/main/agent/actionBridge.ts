import net from 'net'
import fs from 'fs'
import path from 'path'
import { app, BrowserWindow } from 'electron'
import { IPC } from '../ipc-channels'
import { getContext } from '../context/workspaceContext'
import { runCaseAction } from '../handlers/cases'
import { runCalendarAction } from '../handlers/calendar'
import { dataAction } from './dataActions'
import { documentAction } from './documentActions'
import { allows, grants, type Grant } from './grants'

/**
 * AGENT→ACTION bridge (main side).
 *
 * The in-app `claude -p` agent EXECUTES per-surface actions by running the
 * `wos-action` CLI (a pure-Node shim on its PATH). The CLI connects to THIS
 * unix-domain socket; each request is one line of JSON, each reply one line of
 * JSON. On `run <id>`, main forwards the call to the focused window's renderer
 * executor over IPC (AGENT_ACTION_INVOKE) and awaits the reqId-correlated reply
 * (AGENT_ACTION_RESULT). The renderer runs the SAME surfaceActions registry a
 * dock chip runs — so the agent drives the live UI (single source of truth).
 *
 * Safety posture:
 *  - Socket is LOCAL unix-domain only, created with mode 0600, unlinked on start
 *    and quit. No TCP, no shell, no arbitrary exec.
 *  - `run` is validated against `allActionIds` from the live workspace context
 *    (the manifest the renderer pushes from the registry). Unknown ids are
 *    rejected without ever touching the renderer.
 *  - Every registered action is non-destructive by construction (the registry
 *    exposes no send/delete). This layer adds nothing executable of its own.
 *  - Additive: when the socket/CLI is absent the agent still runs normally.
 *
 * Concurrency (parallel research — Stage 3): each `wos-action` invocation is its
 * OWN socket connection with its own read buffer (`onConnection`), so N subagents
 * hitting the socket at once never share state. Every `run` gets a UNIQUE reqId
 * (`a<time>-<reqSeq++>` — the counter disambiguates same-millisecond calls) held
 * in `pending`, and `resolveActionResult` dispatches each reply by reqId — so
 * replies that arrive OUT OF ORDER (a fast tab finishing before a slow one) can't
 * cross-wire. Nothing here serializes: a slow renderer round-trip (e.g. a
 * `deepRead {tab:A}` still loading) does not block another (`{tab:B}`); they run
 * as independent promises, and tab-scoped browser actions load per-guest in
 * parallel (see guestRegistry.requireGuest).
 */

/** The request shapes the CLI sends. */
export interface ActionRequest {
  cmd: 'list' | 'context' | 'run'
  actionId?: string
  args?: unknown
  /** The run's identity (env WOS_AGENT_TOKEN, forwarded by the CLI). */
  token?: string
}

/** The reply shapes written back to the CLI. */
export type ActionReply =
  | { ok: true; result?: unknown }
  | { ok: false; error: string }

/** How long main waits for the renderer to run an action before giving up. */
const INVOKE_TIMEOUT_MS = 30_000
/** Cap the request line so a malformed/huge payload can't grow unbounded. */
const MAX_REQUEST_BYTES = 64 * 1024

/** The env var whose value is the socket path — set into the agent's childEnv. */
export const AGENT_SOCK_ENV = 'WOS_AGENT_SOCK'

/** The absolute path of the bridge socket ({userData}/wos-agent.sock). */
export function agentSockPath(): string {
  return path.join(app.getPath('userData'), 'wos-agent.sock')
}

let server: net.Server | null = null
/** reqId → pending renderer round-trip resolver. */
const pending = new Map<string, (reply: ActionReply) => void>()
let reqSeq = 0

/**
 * Handle one parsed request against the live context / focused window. Pure of
 * socket concerns so it is unit-testable with a fake webContents.
 */
export async function handleRequest(
  req: ActionRequest,
  deps: {
    context: () => { actions: { id: string; agentHint: string }[]; allActionIds: string[]; surface: string | null; root: string | null; folder: string | null; openFile: string | null }
    invoke: (actionId: string, args: unknown) => Promise<ActionReply>
    /**
     * Case operations, handled in MAIN rather than forwarded.
     *
     * The rest of the actions drive the renderer — they click, scroll and read
     * a page. A case is a file in the workspace, so sending it through a window
     * would add a dependency on one being focused for something that has no UI
     * in it. The agent's interface stays uniform (`wos-action run cases.note`);
     * only the delivery differs.
     */
    cases?: (actionId: string, args: unknown) => Promise<ActionReply>
    /** Calendar writes — see the note on `cases`. */
    calendar?: (actionId: string, args: unknown) => Promise<ActionReply>
    documents?: (actionId: string, args: unknown) => Promise<ActionReply>
    data?: (args: unknown) => Promise<ActionReply>
    /**
     * Per-run authorization. Resolves the request's token to a grant; a run
     * outside its grant is refused BEFORE anything is touched. When absent
     * (unit tests of the protocol alone) no grant check is made.
     */
    grants?: (token: unknown) => Grant | undefined
  },
): Promise<ActionReply> {
  const ctx = deps.context()
  if (req.cmd === 'context') {
    return { ok: true, result: { surface: ctx.surface, root: ctx.root, folder: ctx.folder, openFile: ctx.openFile } }
  }
  if (req.cmd === 'list') {
    return { ok: true, result: { available: ctx.actions, all: ctx.allActionIds } }
  }
  if (req.cmd === 'run') {
    const id = req.actionId
    if (typeof id !== 'string' || !id) return { ok: false, error: 'run requires an actionId' }
    if (deps.grants) {
      const grant = deps.grants(req.token)
      if (!grant) return { ok: false, error: 'no run identity — wos-action only works inside an agent run started by Workspace OS' }
      // A run bound to a workspace may not act on another one; with no workspace
      // open (fresh launch, Close Workspace) there is nothing to protect.
      if (grant.root && ctx.root && grant.root !== ctx.root) return { ok: false, error: 'This run belongs to a different workspace. Start a new run here.' }
      if (!allows(grant.scope, id)) {
        console.warn(`[action-bridge] refused ${id} for run ${grant.label}: outside its grant`)
        return { ok: false, error: `not granted: ${id} is outside what this agent was given` }
      }
    }
    if (id === 'document.data' && deps.data) return deps.data(req.args)
    if (id === 'document.generate' && deps.documents) return deps.documents(id, req.args)
    if (id.startsWith('cases.')) {
      if (!deps.cases) return { ok: false, error: 'cases are not available in this context' }
      return deps.cases(id, req.args)
    }
    // Same reasoning as cases: writing an event is file IO in main, and the
    // guidance in the capability catalog promises this action works.
    if (id.startsWith('calendar.')) {
      if (!deps.calendar) return { ok: false, error: 'the calendar is not available in this context' }
      return deps.calendar(id, req.args)
    }
    // Validate against the known set BEFORE touching the renderer.
    if (!ctx.allActionIds.includes(id)) return { ok: false, error: `unknown action: ${id}` }
    return deps.invoke(id, req.args)
  }
  return { ok: false, error: `unknown cmd: ${String((req as ActionRequest).cmd)}` }
}

/** Same authorization and dispatch for the socket and Codex's structured app tool. */
export function invokeGrantedAction(req: ActionRequest): Promise<ActionReply> {
  return handleRequest(req, { context: getContext, invoke: invokeInRenderer, cases: runCaseAction,
    calendar: runCalendarAction, documents: documentAction, data: dataAction, grants: (token) => grants.lookup(token) })
}

/** Forward a `run` to the focused window's renderer executor; await its reply. */
function invokeInRenderer(actionId: string, args: unknown): Promise<ActionReply> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) {
    return Promise.resolve({ ok: false, error: 'no window available to run the action' })
  }
  const reqId = `a${Date.now()}-${reqSeq++}`
  return new Promise<ActionReply>((resolve) => {
    const timer = setTimeout(() => {
      if (pending.delete(reqId)) resolve({ ok: false, error: 'action timed out' })
    }, INVOKE_TIMEOUT_MS)
    pending.set(reqId, (reply) => {
      clearTimeout(timer)
      resolve(reply)
    })
    win.webContents.send(IPC.AGENT_ACTION_INVOKE, { reqId, actionId, args })
  })
}

/**
 * The renderer's reqId-correlated reply — called by the IPC handler in index.
 * `result` (present on ok) is the value the action RETURNED (e.g. extracted page
 * data / a screenshot path); it is relayed verbatim so `wos-action run` prints
 * it as `{ok:true, result:…}` for the agent to read.
 */
export function resolveActionResult(reqId: unknown, ok: unknown, error?: unknown, result?: unknown): void {
  if (typeof reqId !== 'string') return
  const done = pending.get(reqId)
  if (!done) return
  pending.delete(reqId)
  done(
    ok
      ? result === undefined ? { ok: true } : { ok: true, result }
      : { ok: false, error: typeof error === 'string' ? error : 'action failed' },
  )
}

/** Serve one connection: read a single JSON line, reply with one JSON line. */
function onConnection(sock: net.Socket): void {
  let buf = ''
  let closed = false
  const fail = (msg: string): void => {
    if (closed) return
    closed = true
    try { sock.write(JSON.stringify({ ok: false, error: msg }) + '\n') } catch { /* ignore */ }
    sock.end()
  }
  sock.setEncoding('utf-8')
  sock.on('data', (chunk: string) => {
    buf += chunk
    if (buf.length > MAX_REQUEST_BYTES) return fail('request too large')
    const nl = buf.indexOf('\n')
    if (nl === -1) return
    const line = buf.slice(0, nl)
    let req: ActionRequest
    try {
      req = JSON.parse(line)
    } catch {
      return fail('invalid JSON request')
    }
    invokeGrantedAction(req)
      .then((reply) => {
        if (closed) return
        closed = true
        try { sock.write(JSON.stringify(reply) + '\n') } catch { /* ignore */ }
        sock.end()
      })
      .catch((err) => fail((err as Error).message ?? 'internal error'))
  })
  sock.on('error', () => { /* client hung up — nothing to do */ })
}

/** Start the socket server (idempotent). Unlinks any stale socket first. */
export function startActionBridge(): void {
  if (server) return
  const sockPath = agentSockPath()
  try { fs.unlinkSync(sockPath) } catch { /* no stale socket — fine */ }
  try { fs.mkdirSync(path.dirname(sockPath), { recursive: true }) } catch { /* userData exists */ }
  const srv = net.createServer(onConnection)
  srv.on('error', (err) => {
    console.warn('[action-bridge] server error:', (err as Error).message)
  })
  srv.listen(sockPath, () => {
    try { fs.chmodSync(sockPath, 0o600) } catch { /* best-effort perms */ }
  })
  server = srv
}

/** Stop the server and unlink the socket (called on quit). */
export function stopActionBridge(): void {
  for (const [reqId, done] of pending) {
    done({ ok: false, error: 'shutting down' })
    pending.delete(reqId)
  }
  if (server) {
    try { server.close() } catch { /* ignore */ }
    server = null
  }
  try { fs.unlinkSync(agentSockPath()) } catch { /* already gone */ }
}
