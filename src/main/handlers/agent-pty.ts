import { IpcMain, BrowserWindow } from 'electron'
import os from 'os'
import { randomUUID } from 'crypto'
import path from 'path'
import { IPC } from '../ipc-channels'
import { ipcHandle, registerCleanup } from '../ipc-registry'
import { validateShellInput, validateShellResize, IpcValidationError } from '../ipc-validator'
import { assertMainFrame } from '../security'
import { getWorkspaceRoot } from '../workspace-root'
import { app } from 'electron'
import { docgenBinDir, docgenVenvBinDir } from '../docgen'
import { resolveClaudeBinary, getDefaultAgentModel } from './agent'
import { modelArgs, parseModelPick, isValidModelAlias } from '../agent/modelPick'
import { claudeSettings } from '../agent/claudeSettings'
import { resolveCodexBinary, writeCodexMcpProfile, type CodexMcpProfile, type McpJsonConfig } from '../agent/providers/codex'
import { CodexRpc } from '../agent/providers/codexRpc'
import { codexGuidance } from '../agent/providers/codexGuidance'
import { readAgentForRun } from './agents'
import { grants, AGENT_TOKEN_ENV } from '../agent/grants'
import { agentSockPath, AGENT_SOCK_ENV } from '../agent/actionBridge'
import fs from 'fs'
import { getVault, getConnectorState } from '../secrets'
import { resolveMcpInjection } from '../mcp/mcp-runtime'
import { headersHelperCommand } from '../install-mcp-token-cli'
import { isValidMcpTool } from '../agent-permissions'
import { sendToWindow, setMainWindow } from '../main-window'

/**
 * Agent broker v2: an INTERACTIVE `claude` session hosted in a real PTY.
 *
 * Where handlers/agent.ts runs `claude -p` (tools execute in-process, permissions
 * are pre-set flags — no pre-execution hook), this spawns the full interactive
 * `claude` TUI via node-pty. That gets Claude Code's *native* permission prompts
 * ("Do you want to proceed?" …) for free, which is the unlock the HITL gate needs.
 *
 * The two modes are additive and chosen per session by a renderer toggle; the
 * shipped -p console is untouched. Subscription mechanics are unchanged — this
 * runs the same `claude` binary the user is already authenticated with.
 *
 * The PTY's stdout is already ANSI/VT, so it streams straight into the AgentXterm
 * viewport (this is exactly why the agent console moved to xterm).
 */

// node-pty is a native module loaded at runtime (see shell.ts for the same dance).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pty = require('node-pty')

interface PtySession {
  process: ReturnType<typeof pty.spawn>
  cleanup?: () => void
}

const sessions = new Map<string, PtySession>()

function assertSessionId(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-z0-9-]{4,64}$/i.test(id)) {
    throw new IpcValidationError('Invalid pty session id')
  }
  return id
}

/** Kills every live agent PTY and clears the map — runs on app quit so the
 *  interactive claude sessions never outlive the app. */
export function shutdownAgentPtys(): void {
  for (const session of sessions.values()) {
    try {
      session.cleanup?.()
      session.process.kill()
    } catch {
      /* already dead */
    }
  }
  sessions.clear()
}

export function registerAgentPtyHandlers(ipcMain: IpcMain, win: BrowserWindow): void {
  setMainWindow(win)
  registerCleanup('agent-ptys', shutdownAgentPtys)

  ipcHandle(ipcMain, IPC.AGENT_PTY_SPAWN, async (event, sessionId: unknown, options: unknown) => {
    assertMainFrame(event)
    const id = assertSessionId(sessionId)
    const grantId = `pty-${randomUUID()}`
    // Re-spawning an existing id (e.g. a re-mount) kills the stale PTY first.
    const existing = sessions.get(id)
    if (existing) {
      try { existing.cleanup?.(); existing.process.kill() } catch { /* already dead */ }
      sessions.delete(id)
    }

    // Settings → Models may point the interactive session at Codex instead.
    const opts = (options && typeof options === 'object' ? options : {}) as { model?: unknown; agentName?: unknown; mode?: unknown; activeFile?: unknown }
    const agent = typeof opts.agentName === 'string' ? readAgentForRun(opts.agentName) : null
    const pick = parseModelPick(isValidModelAlias(opts.model) ? opts.model : isValidModelAlias(agent?.model) ? agent.model : getDefaultAgentModel())
    const safeMode = opts.mode === 'safe' || (opts.mode === undefined && agent?.mode === 'safe')
    const binary = pick.provider === 'codex' ? resolveCodexBinary() : resolveClaudeBinary()

    // Seed the same tool dirs the shell/-p pipeline seed: the office-docgen venv
    // (python-pptx/openpyxl/python-docx) and the `wos-gen` shim, so skills work
    // inside the interactive session too.
    const home = os.homedir()
    const seedPath = [
      docgenVenvBinDir(),
      docgenBinDir(),
      path.join(home, '.local', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      process.env['PATH'] ?? '',
    ].join(':')

    // MCP connectors: mirror the -p pipeline. Decrypt enabled connectors'
    // secrets into the PTY env and pass `--mcp-config <path> --strict-mcp-config`
    // + `--allowedTools mcp__<id>__*`. The interactive session still prompts for
    // native permissions, so MCP tools are gated by BOTH the allowlist and the
    // human. Secrets ride env only — never argv, never the config literal.
    const cwd = getWorkspaceRoot() ?? home
    const ptyEnv: Record<string, string> = { ...process.env, PATH: seedPath } as Record<string, string>
    let mcpArgs: string[] = []
    try {
      const injection = resolveMcpInjection(
        getConnectorState().enabled(),
        getVault(),
        cwd,
        app.getPath('userData'),
        undefined,
        headersHelperCommand,
      )
      Object.assign(ptyEnv, injection.env)
      const mcpTools = injection.allowTools.filter(isValidMcpTool)
      if (injection.args.length > 0) {
        mcpArgs = [...injection.args, ...(mcpTools.length ? ['--allowedTools', ...mcpTools] : [])]
      }
    } catch {
      if (pick.provider === 'codex') throw new Error('Could not load Workspace connectors. Check Settings and retry.')
      // Vault/keychain failure must not brick an interactive session.
      mcpArgs = []
    }

    // Plain interactive claude — NO -p, NO bypassPermissions. The default
    // permission mode is exactly what makes the native prompts fire (the whole
    // point of this mode). The pre-run git checkpoint safety net still comes
    // from the -p pipeline; here the human gate is the safety net.
    // Same default model as the dock runs (Settings → Models). Codex gets its
    // interactive TUI with the workspace-write sandbox; its own prompts gate the rest.
    // Codex reads the same connectors from a per-session profile file (see
    // providers/codex.ts — it also carries the env-inheritance setting a
    // layered profile would otherwise reset). Removed when the session ends.
    let codexProfile: CodexMcpProfile | null = null
    if (pick.provider === 'codex') {
      const cfg: McpJsonConfig = mcpArgs.length >= 2 ? JSON.parse(fs.readFileSync(mcpArgs[1], 'utf8')) : { mcpServers: {} }
      // The user's own MCP servers are switched off for the session. If the
      // app-server cannot list them (older CLI, broken config.toml), the TUI
      // still launches with the connector profile alone.
      let disabledServers: string[] = []
      let rpc: CodexRpc | undefined
      try {
        rpc = new CodexRpc({ cwd })
        await rpc.initialize()
        const { config } = await rpc.request('config/read', { cwd, includeLayers: false })
        disabledServers = Object.keys(config?.mcp_servers ?? {})
      } catch { /* launch without the inherited-server list */ }
      finally { rpc?.close() }
      codexProfile = writeCodexMcpProfile(cfg, grantId, {}, { safeMode, interactive: true, disabledServers })
      ptyEnv[AGENT_SOCK_ENV] = agentSockPath()
      ptyEnv[AGENT_TOKEN_ENV] = grants.issue(grantId, agent?.capabilities?.length ? agent.capabilities : 'all', agent?.name ?? id, getWorkspaceRoot() ?? undefined)
    }
    const cleanup = (): void => { codexProfile?.cleanup(); if (pick.provider === 'codex') grants.revoke(grantId) }
    const ptyArgs = pick.provider === 'codex'
      ? ['-s', safeMode ? 'read-only' : 'workspace-write', '-a', 'on-request', '-c', 'notify=[]', '-c', 'features.apps=false', '-c', 'features.hooks=false', '-c', 'shell_environment_policy.inherit="all"',
          '-c', `developer_instructions=${JSON.stringify(codexGuidance(cwd, typeof opts.activeFile === 'string' ? opts.activeFile : null, agent, safeMode, ''))}`,
          ...(pick.model ? ['-m', pick.model] : []), ...(codexProfile ? ['-p', codexProfile.name] : [])]
      : ['--settings', claudeSettings(false), ...mcpArgs, ...modelArgs(pick.model)]
    let proc: ReturnType<typeof pty.spawn>
    try {
      proc = pty.spawn(binary, ptyArgs, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: ptyEnv,
      })
    } catch (err) { cleanup(); throw err }

    proc.onData((data: string) => {
      sendToWindow(IPC.AGENT_PTY_OUTPUT, id, data)
    })
    proc.onExit(({ exitCode }: { exitCode: number }) => {
      cleanup()
      if (sessions.get(id)?.process !== proc) return
      sessions.delete(id)
      sendToWindow(IPC.AGENT_PTY_EXIT, id, exitCode)
    })

    sessions.set(id, { process: proc, cleanup })
    return { pid: proc.pid, provider: pick.provider }
  })

  ipcHandle(ipcMain, IPC.AGENT_PTY_INPUT, (_event, sessionId: unknown, input: unknown) => {
    const id = assertSessionId(sessionId)
    const text = validateShellInput(input)
    sessions.get(id)?.process.write(text)
  })

  ipcHandle(ipcMain, IPC.AGENT_PTY_RESIZE, (_event, sessionId: unknown, cols: unknown, rows: unknown) => {
    const id = assertSessionId(sessionId)
    const { cols: c, rows: r } = validateShellResize(cols, rows)
    sessions.get(id)?.process.resize(c, r)
  })

  ipcHandle(ipcMain, IPC.AGENT_PTY_KILL, (_event, sessionId: unknown) => {
    const id = assertSessionId(sessionId)
    const session = sessions.get(id)
    if (session) {
      try { session.cleanup?.(); session.process.kill() } catch { /* already dead */ }
      sessions.delete(id)
    }
  })
}
