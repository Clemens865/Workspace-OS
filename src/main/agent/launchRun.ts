import { app } from 'electron'
import { spawn, ChildProcess, execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  permissionArgs,
  safeModeCommandNote,
  isValidClaudeSessionId,
  sanitizePromptPath,
  sanitizeContextFiles,
} from '../agent-permissions'
import { modelArgs, type ProviderId } from './modelPick'
import { resolveCodexBinary, type McpJsonConfig } from './providers/codex'
import { launchCodexSession } from './providers/codexSession'
import { codexGuidance } from './providers/codexGuidance'
import { codexSkills, matchCodexSkills } from './providers/codexCatalog'
import { getCodexEffort } from './providerSettings'
import { sendToWindow } from '../main-window'
import { getWorkspaceRoot } from '../workspace-root'
import { checkpoints } from '../checkpoint'
import { docgenBinDir, docgenVenvBinDir } from '../docgen'
import type { AgentFile } from '../handlers/agents'
import { extractActivity, type AgentActivity } from '../handlers/agent-activity'
import { snapshotArtifacts, changedArtifacts, type Artifact } from '../artifacts'
import { getVault, getConnectorState } from '../secrets'
import { resolveMcpInjection } from '../mcp/mcp-runtime'
import { headersHelperCommand } from '../install-mcp-token-cli'
import { agentSockPath, AGENT_SOCK_ENV, invokeGrantedAction } from './actionBridge'
import { agentActionGuide } from '../context/workspaceContext'
import { search as searchMemory, markUsed, buildMemoryBlock, retrievalQueryFor } from '../memory/memory-service'
import { capabilityGuidanceBlock } from './capabilityCatalog'
import { grants, AGENT_TOKEN_ENV } from './grants'
import { claudeSettings } from './claudeSettings'
import { ClaudeFailureTracker } from './claudeFailure'
import { documentOutputGuidance, type AgentRunFailure } from '../../shared/agentRun'

/**
 * ONE way to launch a `claude -p` run, whoever asks for it.
 *
 * The dock's agent tab and the background queue (M2 — routines, unattended
 * work) must spawn the agent identically: same permission lists, same MCP
 * injection, same checkpoint, same stream parsing. This module is that path,
 * extracted verbatim from the IPC handler; the callers differ only in where
 * the events GO (a `RunSink`) and in whether an idle timeout is armed.
 *
 * Security posture is unchanged and lives here now: the prompt rides stdin,
 * never argv; nothing is spawned through a shell; both modes run scoped
 * allow/deny lists (../agent-permissions.ts) — no bypassPermissions.
 */

/** The model names a result line reports under modelUsage ("claude-opus-5"), joined; '' when absent. */
export function modelsUsed(obj: { modelUsage?: unknown }): string {
  const mu = obj.modelUsage
  if (!mu || typeof mu !== 'object') return ''
  return Object.keys(mu as Record<string, unknown>).map((k) => k.replace(/\[.*$/, '')).filter(Boolean).join(' + ')
}

export interface AgentRunMeta { costUsd: number; turns: number; durationMs: number; model?: string; provider?: ProviderId; costKnown?: boolean; inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }

/** Where a run's events go. The dock forwards to the window; the queue records and forwards. */
export interface RunSink {
  output(text: string): void
  /** The claude session id, once seen — lets a later turn --resume. */
  sessionId?(sid: string): void
  meta(meta: AgentRunMeta): void
  activity(activity: AgentActivity): void
  artifacts(list: Artifact[]): void
  /** The run's deliverable to auto-open in the canvas. */
  artifact(filePath: string): void
  done(code: number, checkpointId: string | null, failure?: AgentRunFailure): void
}

export interface LaunchRunOptions {
  runId: string
  prompt: string
  contextFiles: string[]
  activeFile: string | null
  safeMode: boolean
  agent: AgentFile | null
  /** A claude session id to --resume (validated by the caller). */
  resumeId?: string
  /** Model alias for the provider ('fable' | 'opus' | 'sonnet' | 'haiku' | 'gpt-5-codex' …); unset = the CLI's default. */
  model?: string
  /** Which agent CLI runs this: Claude Code (default) or Codex. */
  provider?: ProviderId
  signal?: AbortSignal
  /** Kill the child after this long with NO stdout. Unset = no idle limit (the dock). */
  idleTimeoutMs?: number
  /**
   * What the run may reach through wos-action: a capability list (its surfaces)
   * or 'all' for the legacy full grant of a plain dock run. See ./grants.ts.
   */
  capabilities: readonly string[] | 'all'
  sink: RunSink
}

export { isValidModelAlias, modelArgs } from './modelPick'

let cachedBinary: string | null = null

export function resolveClaudeBinary(): string {
  if (cachedBinary) return cachedBinary
  const candidates = [
    process.env['CLAUDE_BIN'],
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ].filter(Boolean) as string[]

  for (const c of candidates) {
    if (fs.existsSync(c)) { cachedBinary = c; return c }
  }
  // Last resort: ask the user's login shell where claude lives.
  try {
    const found = execFileSync(process.env['SHELL'] ?? '/bin/zsh', ['-lc', 'command -v claude'], {
      encoding: 'utf-8',
    }).trim()
    if (found) { cachedBinary = found; return found }
  } catch {
    // fall through
  }
  throw new Error('Claude CLI not found. Install Claude Code and ensure it is on your PATH.')
}

export async function launchRun(o: LaunchRunOptions): Promise<{ child: ChildProcess; checkpointId: string | null }> {
    const { prompt, contextFiles, activeFile, safeMode, agent, resumeId, sink } = o
    const id = o.runId
    const cwd = getWorkspaceRoot() ?? os.homedir()

    // MEMORY: retrieve what we know that is relevant to THIS prompt and inject it.
    // A store nothing reads is a diary nobody opens — this is the point of the
    // whole subsystem. Failure here must never block a run: an agent that works
    // without memory is strictly better than one that refuses to start.
    let memoryBlock = ''
    try {
      const memCtx = { root: getWorkspaceRoot(), userDataDir: app.getPath('userData') }
      const recalled = searchMemory(memCtx, retrievalQueryFor(String(prompt)), 12)
      memoryBlock = buildMemoryBlock(recalled)
      if (recalled.length) markUsed(memCtx, recalled.map((m) => m.id))
    } catch {
      /* memory unavailable — run without it */
    }
    // Paths get interpolated into prompt text — reject anything that isn't a
    // clean absolute path (control chars in a "path" could forge prompt lines).
    const openFile = sanitizePromptPath(activeFile)
    const fullPrompt = buildPrompt(prompt, sanitizeContextFiles(contextFiles))
    const provider: ProviderId = o.provider ?? 'claude'
    const binary = provider === 'codex' ? resolveCodexBinary() : resolveClaudeBinary()

    // Snapshot the workspace's artifact-worthy files so we can detect what the
    // agent generates: the newest office file auto-opens (below), and the full
    // classified set is surfaced as artifact cards.
    const beforeFiles = snapshotArtifacts(cwd)

    // Snapshot the workspace BEFORE the agent can write — the claude subprocess
    // bypasses the IPC trash layer, so this checkpoint is its safety net.
    let checkpointId: string | null = null
    if (getWorkspaceRoot() && (await checkpoints.isGitAvailable())) {
      try {
        const cp = await checkpoints.createCheckpoint(`agent: ${prompt.slice(0, 60)}`)
        checkpointId = cp.id
      } catch {
        // A failed checkpoint must not silently drop the safety net.
        sink.output('[warning] could not create a revert checkpoint\n')
      }
    }

    // stream-json emits one JSON event per line as the response is generated,
    // giving true token-by-token streaming (plain -p buffers the whole reply).
    // --settings disableAllHooks keeps the user's personal hooks (e.g. a Stop
    // hook printing "PROGRESS:") from polluting output while preserving keychain
    // OAuth auth (unlike --bare, which breaks auth). stdin must be closed.
    // Prepend the office-docgen venv (so `python3`/`pip` have python-pptx etc.
    // for installed Python skills) and the `wos-gen` shim to the agent's PATH.
    if (provider === 'codex') o.signal?.throwIfAborted()
    const childEnv: Record<string, string> = {
      ...process.env,
      PATH: `${docgenVenvBinDir()}:${docgenBinDir()}:${process.env['PATH'] ?? ''}`,
      // AGENT→ACTION bridge: the `wos-action` CLI (on the PATH above) reaches the
      // app over this local unix socket to EXECUTE non-destructive surface
      // actions. Absent-socket is safe — the CLI just errors, the agent runs on.
      [AGENT_SOCK_ENV]: agentSockPath(),
      // Per-run identity for the bridge: the CLI forwards this token; main
      // refuses any action outside this run's grant. Minted here, never logged.
      [AGENT_TOKEN_ENV]: grants.issue(id, o.capabilities, agent?.name ?? id, provider === 'codex' ? getWorkspaceRoot() ?? undefined : undefined),
    } as Record<string, string>
    // The open workspace, as the shells already get it: the `wos-case` CLI (and
    // any script the agent writes) needs it to find Cases/ and Work/.
    const wsRoot = getWorkspaceRoot()
    if (wsRoot) childEnv['WOS_WORKSPACE'] = wsRoot

    // MCP connectors: for every enabled connector whose secret(s) are present,
    // decrypt them into childEnv, add `--mcp-config <path> --strict-mcp-config`,
    // and extend the allowlist with its `mcp__<id>__*` tools. Decrypt happens
    // ONLY here (main, at spawn); the plaintext lives only in childEnv, never in
    // argv/logs/config. If nothing is enabled/ready, this is a no-op.
    let mcpArgs: string[] = []
    let mcpAllowTools: string[] = []
    let injectedSecretKeys: string[] = []
    try {
      const injection = resolveMcpInjection(
        getConnectorState().enabled(),
        getVault(),
        cwd,
        app.getPath('userData'),
        undefined,
        // Remote-oauth connectors get a `headersHelper` in the .mcp.json that
        // points at wos-mcp-token — the CLI mints a fresh Bearer at connect.
        headersHelperCommand,
      )
      Object.assign(childEnv, injection.env)
      injectedSecretKeys = Object.keys(injection.env)
      mcpArgs = injection.args
      mcpAllowTools = injection.allowTools
    } catch {
      if (provider === 'codex') { grants.revoke(id); throw new Error('Could not load Workspace connectors. Check Settings and retry.') }
      // A vault/keychain failure must not brick a normal (non-MCP) run — proceed
      // without connectors rather than aborting. (No secret is logged.)
      mcpArgs = []
      mcpAllowTools = []
    }

    if (provider === 'codex') {
      let skills: { name: string; path: string }[] = []
      const wanted = [...(agent?.skills ?? [])]
      const requested = /^Use the "([^"\n]+)" skill\./.exec(prompt)
      if (requested) wanted.push(requested[1])
      try {
        const connectors: McpJsonConfig = mcpArgs.length >= 2
          ? JSON.parse(fs.readFileSync(mcpArgs[1], 'utf8')) : { mcpServers: {} }
        const nativeWanted = [...new Set(wanted)].filter((name) => name !== 'office-docgen')
        if (nativeWanted.length) {
          // Skills are advisory (as on the Claude path): a persona naming a
          // Claude-only skill runs without it instead of never starting.
          let available: Awaited<ReturnType<typeof codexSkills>> = []
          try { available = await codexSkills(cwd) } catch { /* the session start reports a broken Codex itself */ }
          const matched = matchCodexSkills(nativeWanted, available)
          skills = matched.skills
          for (const name of matched.missing) sink.output(`\x1b[2m[skill] "${name}" is not a Codex skill; running without it\x1b[0m\n`)
        }
        const child = await launchCodexSession({
          runId: id, cwd, prompt: fullPrompt, model: o.model, effort: getCodexEffort(), resumeId,
          instructions: codexGuidance(cwd, openFile, agent, safeMode, memoryBlock),
          safeMode, env: childEnv, connectors, skills, signal: o.signal, idleTimeoutMs: o.idleTimeoutMs, sink,
          onQuestion: (q) => sendToWindow('codex:question', q),
          onAction: (actionId, args) => invokeGrantedAction({ cmd: 'run', actionId, args, token: childEnv[AGENT_TOKEN_ENV] }),
          onFinish: (code) => {
            try {
              const artifacts = changedArtifacts(cwd, beforeFiles)
              if (artifacts.length) sink.artifacts(artifacts)
              const deliverable = artifacts.find((a) => a.type === 'office') ?? artifacts.find((a) => a.type === 'page')
              if (deliverable) sink.artifact(deliverable.path)
            } finally { grants.revoke(id); sink.done(code, checkpointId) }
          },
        })
        return { child, checkpointId }
      } catch (err) { grants.revoke(id); throw err }
      finally { for (const key of injectedSecretKeys) delete childEnv[key] }
    }

    // In -p mode tools are auto-denied without permission flags. Both modes
    // run scoped allowlists now (full mode additionally denies destructive
    // command classes) — bypassPermissions is gone. The pre-run git checkpoint
    // remains the workspace safety net for anything the lists don't catch.
    // A research-capable agent is pinned to the IN-APP browser: with WebFetch /
    // WebSearch also on the table the model just fetches pages directly, and the
    // user sees an agent that "did research" with nothing happening on screen —
    // no visible tabs, no screenshots, no logged-in session.
    const inAppBrowserOnly = agent?.capabilities?.includes('research') ?? false
    const permArgs = permissionArgs(safeMode ? 'safe' : 'full', mcpAllowTools, { inAppBrowserOnly })

    // First turn establishes the system context (persona + IWE grounding). On a
    // resumed turn the conversation already carries it, so re-appending would
    // bloat it — pass --resume instead and skip the system prompt.
    const continuityArgs = resumeId
      ? ['--resume', resumeId]
      : ['--append-system-prompt', buildSystemPrompt(cwd, openFile, agent?.persona, agent?.capabilities, safeMode, memoryBlock)]

    // On a resumed turn the system prompt (with the original open file) isn't
    // re-sent; nudge the agent with the *current* open file so it stays accurate.
    const turnPrompt = resumeId && openFile ? `(The document now open in the editor is: ${openFile})\n\n${fullPrompt}` : fullPrompt

    const claudeArgs = [
      '--settings', claudeSettings(),
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      ...permArgs,
      ...mcpArgs,
      ...continuityArgs,
      ...modelArgs(o.model),
      '-p', // prompt arrives on stdin — see the security note at the top
    ]
    const providerArgs = claudeArgs
    let child: ChildProcess
    try {
      child = spawn(
        binary,
        providerArgs,
        // stdin is 'pipe' (not 'ignore'): a Finder-launched packaged app can
        // have an invalid parent fd 0, and 'ignore' on stdin then fails with
        // EBADF. The prompt is written to stdin below, then stdin is closed.
        { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] }
      )
    } catch (err) {
      const msg = (err as Error).message
      try {
        fs.appendFileSync(
          path.join(os.homedir(), 'Library', 'Logs', 'workspace-os-agent.log'),
          `[${new Date().toISOString()}] spawn failed: ${(err as Error).stack ?? msg}\n`
        )
      } catch { /* logging is best-effort */ }
      grants.revoke(id)
      throw new Error(`Could not start the agent: ${msg}`)
    }
    // Feed the prompt via stdin (never argv), then EOF so the run starts.
    child.stdin?.on('error', () => { /* EPIPE if the child died early — the close handler reports it */ })
    child.stdin?.write(turnPrompt)
    child.stdin?.end()

    // The child has inherited childEnv at spawn; drop our in-RAM copies of the
    // decrypted secrets so they don't linger on the closure any longer than
    // necessary. Only the freshly-injected connector secrets are cleared (the
    // inherited process.env spread is left intact). Best-effort — GC still owns
    // the underlying strings, but this removes the live references.
    for (const key of injectedSecretKeys) delete childEnv[key]
    injectedSecretKeys = []

    // HEADLESS runs get an IDLE timeout — no output for this long means a hung
    // child, and nobody is watching to notice. Wall-clock limits are wrong for
    // work that legitimately takes an hour; silence is the honest signal.
    let idle: ReturnType<typeof setTimeout> | null = null
    const touch = (): void => {
      if (!o.idleTimeoutMs) return
      if (idle) clearTimeout(idle)
      idle = setTimeout(() => {
        sink.output(`\n[timeout] no output for ${Math.round(o.idleTimeoutMs! / 60_000)} min — stopping the run\n`)
        child.kill('SIGTERM')
      }, o.idleTimeoutMs)
    }
    touch()

    const emit = (text: string): void => {
      if (text) sink.output(text)
    }

    // NDJSON can split mid-line across chunks, so buffer until each newline.
    let buffer = ''
    const failures = new ClaudeFailureTracker()
    const consumeLine = (line: string): void => {
      failures.consume(line)
      const sid = extractSessionId(line)
      if (sid) sink.sessionId?.(sid)
      const meta = extractRunMeta(line)
      if (meta) sink.meta(meta)
      const activity = extractActivity(line)
      if (activity) sink.activity(activity)
      emit(extractDelta(line))
    }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (data: Buffer) => {
      touch()
      buffer += data.toString()
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        consumeLine(line)
      }
    })
    child.stderr?.on('data', (data: Buffer) => emit(data.toString()))
    child.on('error', (err) => {
      failures.failure = { kind: 'provider-error', message: err.message }
      emit(`\n[error] ${err.message}\n`)
    })
    child.on('close', (code) => {
      if (buffer.trim()) consumeLine(buffer)
      // Detect every artifact-worthy file the agent created/changed during the
      // run (one workspace walk). The newest office document auto-opens in the
      // canvas (unchanged behavior); the full classified list feeds the cards.
      const artifacts = changedArtifacts(cwd, beforeFiles)
      if (artifacts.length) sink.artifacts(artifacts)
      // Auto-open the run's DELIVERABLE in the canvas. A built web page counts:
      // the canvas renders it with a live Preview/Code toggle, which is where a
      // finished page belongs — the in-app browser is for the live web, not for
      // previewing a local file the agent just wrote.
      const deliverable = artifacts.find((a) => a.type === 'office') ?? artifacts.find((a) => a.type === 'page')
      if (deliverable) sink.artifact(deliverable.path)
      if (idle) clearTimeout(idle)
      grants.revoke(id)
      sink.done(failures.failure ? (code || 1) : (code ?? 1), checkpointId, failures.failure ?? undefined)
    })

    return { child, checkpointId }
}

function extractDelta(line: string): string {
  const trimmed = line.trim()
  if (!trimmed) return ''
  if (trimmed[0] !== '{') return line + '\n' // plain text/warning line
  try {
    const obj = JSON.parse(trimmed)
    if (
      obj.type === 'stream_event' &&
      obj.event?.type === 'content_block_delta' &&
      obj.event.delta?.type === 'text_delta'
    ) {
      return obj.event.delta.text ?? ''
    }
    if (obj.type === 'result') {
      // Surface auth/usage errors that would otherwise be silent.
      if (obj.is_error) return `\n[error] ${obj.result || (Array.isArray(obj.errors) ? obj.errors.join('\n') : '') || 'agent run failed'}\n`
      // The result event already carries run metadata — surface it as a dim
      // trailer line (the console renders through xterm, so ANSI is fine).
      const parts: string[] = []
      if (typeof obj.num_turns === 'number') parts.push(`${obj.num_turns} turn${obj.num_turns === 1 ? '' : 's'}`)
      if (typeof obj.duration_ms === 'number') parts.push(`${(obj.duration_ms / 1000).toFixed(1)}s`)
      if (typeof obj.total_cost_usd === 'number' && obj.total_cost_usd > 0) parts.push(`$${obj.total_cost_usd.toFixed(4)}`)
      const used = modelsUsed(obj)
      if (used) parts.push(used)
      return parts.length ? `\n\x1b[2m${parts.join(' · ')}\x1b[0m\n` : ''
    }
    return ''
  } catch {
    return '' // partial/incomplete JSON — ignore
  }
}

/**
 * Pulls machine-readable run metadata out of a stream-json `result` line for
 * the session budget ledger. Returns null for every other line. Mirrors the
 * numbers extractDelta renders as the human-facing dim trailer.
 */
export interface AgentRunMeta { costUsd: number; turns: number; durationMs: number }
function extractRunMeta(line: string): AgentRunMeta | null {
  const t = line.trim()
  if (t[0] !== '{') return null
  try {
    const obj = JSON.parse(t)
    if (obj.type !== 'result') return null
    return {
      costUsd: typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : 0,
      turns: typeof obj.num_turns === 'number' ? obj.num_turns : 0,
      durationMs: typeof obj.duration_ms === 'number' ? obj.duration_ms : 0,
      model: modelsUsed(obj) || undefined,
    }
  } catch {
    return null
  }
}

/** Pulls the claude session id out of a stream-json line, if present. The init
 *  and result events both carry it; capturing it lets later turns --resume. */
function extractSessionId(line: string): string | null {
  const t = line.trim()
  if (t[0] !== '{') return null
  try {
    const obj = JSON.parse(t)
    // Only a UUID-shaped id is usable — it later rides argv as `--resume <id>`.
    return isValidClaudeSessionId(obj.session_id) ? obj.session_id : null
  } catch {
    return null
  }
}

/**
 * The IWE system context appended to every agent run. Kept lean (it shares
 * argv with the prompt) — it tells the agent where it is, what's open, and how
 * to produce real office documents via the office-docgen skill.
 */
function buildSystemPrompt(
  workspaceRoot: string,
  activeFile: string | null,
  persona?: string,
  capabilities?: string[],
  safeMode = false,
  memoryBlock = '',
): string {
  const lines = []
  // A selected agent's persona leads, so it shapes behavior; the IWE context follows.
  if (persona && persona.trim()) lines.push(persona.trim(), '')
  // Agent Foundry: a forged agent's granted capabilities become verbatim tool
  // guidance so it actually KNOWS how to exercise what it was given. (Note:
  // this SURFACES capability guidance; per-agent tool ENFORCEMENT beyond the
  // global safe/full gate is a follow-up — see agent-permissions.ts.)
  if (capabilities && capabilities.length) {
    const block = capabilityGuidanceBlock(capabilities)
    if (block) lines.push(block, '')
  }
  lines.push(
    'You are the built-in agent of Workspace OS, an Integrated Workspace Environment (IWE) — a native office suite (Word/Excel/PowerPoint).',
    `The open workspace folder is: ${workspaceRoot}`,
  )
  if (activeFile) lines.push(`The document currently open in the editor is: ${activeFile}`)
  lines.push(
    'You can read and cross-reference any file in the workspace.',
    'To create a presentation, spreadsheet, or document, use the office-docgen skill: write a JSON spec, then run `wos-gen <pptx|xlsx|docx> --spec <spec.json> --out "<workspace>/<Name>.<ext>"`. It is on your PATH. Produce a real file — never paste document contents into chat.',
    'For a STUNNING deck, give each pptx slide a `layout` (`cover`, `section`, `bullets`, `table`, `chart`, `closing`) and set a `theme` (`{"palette":{"bg","ink","primary","accent","muted"},"font":"Inter"}`); bullets accept `{"text","level"}`, tables accept `"numericCols":[..]` to right-align numbers.',
    'Write generated files into the workspace folder. A generated office file opens automatically in the canvas.',
    documentOutputGuidance,
  )
  // AGENT→ACTION bridge guide (surface-aware; empty until the renderer has
  // advertised a manifest). Lets the agent EXECUTE non-destructive UI actions.
  const actionGuide = agentActionGuide()
  if (actionGuide) lines.push(actionGuide)
  lines.push(
    'To read or update LIVE METRICS (named numbers that stay in sync across every linked Excel/Word/PowerPoint file), use `wos-metric` (on your PATH). Key commands: `wos-metric list`; `wos-metric get "<name>"`; `wos-metric set "<name>" <value>` (updates the value and propagates it to every linked file on disk); `wos-metric create "<name>" --value <v>` or `--source <file.xlsx!Sheet!A1>`; `wos-metric link "<name>" --file <deck.pptx|doc.docx|book.xlsx> --target <tag|Sheet!A1>` (bind a metric to an EXISTING anchor on disk); `wos-metric refresh "<name>"` / `wos-metric refresh-all` (re-read sourced metrics from their source cell and propagate); `wos-metric sync-all` (push every metric into every linked file). Add `--json` for machine-readable output. It writes files safely — a locked/formula/missing file is skipped and reported, never corrupted.',
    'To build a LIVE Excel→PowerPoint deck whose numbers stay bound to the spreadsheet, run this ORDERED recipe: (1) `wos-gen xlsx` the model; (2) `wos-metric create "<Name>" --source "<file.xlsx>!Sheet1!B2"` per figure; (3) `wos-gen pptx` with each figure as an anchored shape — put `"metrics":[{"tag":"revenue","text":"1200","label":"Revenue"}]` on a slide (`tag` → shape name `wos-metric-<tag>`); (4) `wos-metric link "<Name>" --file "<deck.pptx>" --target "<tag>"` per figure; (5) `wos-metric sync-all`. Later, `wos-metric refresh-all && wos-metric sync-all` re-flows changed cells into the deck. To only MIRROR values once (no live link), skip steps 2/4/5 and put the numbers straight in the spec.',
    'To work with LIVE COLLECTIONS (typed record sets — e.g. rows of deals/products — that stay in sync as filtered/sorted tables across every linked Excel/Word/PowerPoint file), use `wos-collection` (on your PATH). Key commands: `wos-collection list`; `wos-collection get "<name>"`; `wos-collection records "<name>"`; `wos-collection create "<name>" --source <file.xlsx!Sheet!A1:C20>` (row 0 = field names); `wos-collection view "<name>" [--filter "revenue > 1000"]... [--sort "revenue:desc"]... [--limit N]` (preview a live query); `wos-collection link "<name>" --file <doc> --target <anchorTag|xlsx:Sheet!A1> --columns "field:Header,field2:Header2" [--filter ...] [--sort ...] [--limit N]` (bind a viewed projection to a target block); `wos-collection links [<name>] [--file <doc>]`; `wos-collection refresh "<name>"` / `refresh-all` (re-read sourced collections); `wos-collection sync "<name>"` / `sync-all` (push viewed records into every linked file). Add `--json` for machine-readable output. It UPDATES an existing anchored table/range (a docx/pptx target needs a `wos-collection-<tag>` anchor the app inserted first; an xlsx target can be any range ref) — it cannot insert a NEW table into a closed docx/pptx. Writes are fail-safe: a locked/formula/missing file is skipped and reported, never corrupted.',
  )
  // Recollections go near the END, after the capability guidance: they are
  // context for the task, not instructions that should outrank how the agent
  // works.
  if (memoryBlock) lines.push(memoryBlock)
  lines.push(
    'To REMEMBER something durable for next time, run `wos-action run memory.remember \'{"text":"<the fact>","kind":"decision|fact|preference|entity","source":"<where you learned it>"}\'`. Record only what will still be true later — a decision and its reason, a stable fact, a preference — never this run\'s chatter. Add "scope":"global" for a fact about the PERSON rather than this project. Use `wos-action run memory.search \'{"query":"<topic>"}\'` before asking the user something they may already have told you.',
  )
  // Safe mode's Bash grants are prefix patterns; say so, or the agent writes a
  // compound command, gets denied, and reports the capability as missing.
  if (safeMode) lines.push(safeModeCommandNote())
  return lines.join('\n')
}

/** Prepends the (already sanitized) context-file list to the prompt. */
function buildPrompt(prompt: string, contextFiles: string[]): string {
  if (contextFiles.length > 0) {
    return `Context files (read these if relevant):\n${contextFiles.join('\n')}\n\n${prompt}`
  }
  return prompt
}
