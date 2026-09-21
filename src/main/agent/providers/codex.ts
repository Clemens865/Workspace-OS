/**
 * Codex CLI as an agent provider. `codex exec --json` prints JSONL events:
 * thread.started (thread_id = the resume handle), turn.started,
 * item.started/item.completed (agent_message · command_execution ·
 * file_change · mcp_tool_call · reasoning …), turn.completed (usage),
 * error / turn.failed. The prompt goes in on stdin ('-'), never argv — the
 * same rule the Claude path follows. The persona / IWE system prompt rides
 * the `developer_instructions` config override; a resumed thread already has
 * it. Probed against codex-cli 0.153 on 2026-09-06.
 */
import fs from 'fs'
import { isValidModelAlias, parseConversation } from '../modelPick'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { toolToChip, toolToKind, toolToLabel, type AgentActivity } from '../../handlers/agent-activity'
import type { AgentRunMeta } from '../launchRun'

let cachedBinary: string | null = null
// A miss is remembered too: probing runs a login shell on the main thread, and
// the catalog asks on every Settings/agent-form open.
let missedAt = 0
const MISS_TTL_MS = 60_000
const NOT_FOUND = 'Codex CLI not found. Install it (npm i -g @openai/codex) and sign in with `codex login`.'

export function resolveCodexBinary(): string {
  if (cachedBinary) return cachedBinary
  if (missedAt && Date.now() - missedAt < MISS_TTL_MS) throw new Error(NOT_FOUND)
  const candidates = [
    process.env['CODEX_BIN'],
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    path.join(os.homedir(), '.local', 'bin', 'codex'),
  ].filter(Boolean) as string[]
  for (const c of candidates) if (fs.existsSync(c)) { cachedBinary = c; return c }
  try {
    const found = execFileSync(process.env['SHELL'] ?? '/bin/zsh', ['-lc', 'command -v codex'], { encoding: 'utf-8' }).trim()
    if (found) { cachedBinary = found; return found }
  } catch { /* fall through */ }
  missedAt = Date.now()
  throw new Error(NOT_FOUND)
}

/** A TOML basic string (double-quoted, escaped) for a -c override value. */
export function tomlString(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"'
}

export interface CodexArgsInput {
  cwd: string
  safeMode: boolean
  /** Persona + workspace guidance; omitted on a resumed thread (it already has it). */
  systemPrompt: string | null
  resumeId?: string
  model?: string
  /** A per-run Codex profile (`$CODEX_HOME/<name>.config.toml`) carrying the connectors. */
  profile?: string
}

/**
 * Safe = read-only sandbox (read + reply; the wos CLIs still run, they only
 * write through the app's bridge). Full = workspace-write sandbox with network
 * (the bridge socket and the web). Approvals are off in both: nobody is at the
 * keyboard of a -p style run, the pre-run checkpoint is the safety net.
 */
export function codexArgs(i: CodexArgsInput): string[] {
  if (i.model && !isValidModelAlias('codex:' + i.model)) throw new Error('Invalid Codex model')
  if (i.resumeId && !parseConversation('codex:' + i.resumeId)) throw new Error('Invalid Codex thread')
  if (i.profile && !/^wos-run-[A-Za-z0-9_-]+$/.test(i.profile)) throw new Error('Invalid Codex profile')
  const profile = i.profile ? ['-p', i.profile] : []
  const common = [
    '--json', '--skip-git-repo-check',
    '-c', 'approval_policy="never"',
    '-c', 'shell_environment_policy.inherit="all"',
    ...(i.model ? ['-m', i.model] : []),

  ]
  if (i.resumeId) return [...profile, 'exec', 'resume', i.resumeId, ...common,
    '-c', `sandbox_mode=${tomlString(i.safeMode ? 'read-only' : 'workspace-write')}`,
    '-c', `sandbox_workspace_write.network_access=${!i.safeMode}`, '-']
  return [
    ...profile, 'exec',
    ...common,
    '-C', i.cwd,
    '-s', i.safeMode ? 'read-only' : 'workspace-write',
    ...(i.safeMode ? [] : ['-c', 'sandbox_workspace_write.network_access=true']),
    ...(i.systemPrompt ? ['-c', `developer_instructions=${tomlString(i.systemPrompt)}`] : []),
    '-',
  ]
}

export interface CodexLine {
  sessionId?: string
  output?: string
  activity?: AgentActivity
  meta?: AgentRunMeta
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Codex's own tracing on stderr (`2026-… WARN codex_models_manager::manager:
 * failed to refresh available models: timeout …`) is housekeeping, not the
 * run's output. Only its tracing lines are dropped; anything else on stderr
 * (a real failure) still reaches the console.
 */
export function isCodexNoise(line: string): boolean {
  return /\b(WARN|INFO|DEBUG|TRACE)\b\s+codex_[a-z_]+::/i.test(line) || /failed to refresh available models/i.test(line)
}

/** One JSONL line → what the run sink needs. Non-JSON lines pass through as output. */
export function parseCodexLine(line: string, modelLabel = 'codex'): CodexLine | null {
  const t = line.trim()
  if (!t) return null
  if (t[0] !== '{') return isCodexNoise(t) ? null : { output: line + '\n' }
  let obj: Record<string, unknown>
  try { obj = JSON.parse(t) } catch { return null }
  const type = obj.type
  if (type === 'thread.started') {
    const id = obj.thread_id
    return typeof id === 'string' && UUID_RE.test(id) ? { sessionId: id } : null
  }
  if (type === 'item.completed' || type === 'item.started') {
    const item = obj.item as Record<string, unknown> | undefined
    if (!item) return null
    if (item.type === 'agent_message' && type === 'item.completed') {
      const text = typeof item.text === 'string' ? item.text : ''
      return text ? { output: text + '\n' } : null
    }
    if (item.type === 'command_execution' && type === 'item.started') {
      const cmd = (typeof item.command === 'string' ? item.command : '').replace(/^\/bin\/z?sh -lc\s+/, '')
      const input = { command: cmd }
      return { activity: { tool: 'Bash', label: toolToLabel('Bash', input), kind: toolToKind('Bash', input), chip: toolToChip('Bash', input) } }
    }
    if (item.type === 'file_change' && type === 'item.completed') {
      const changes = Array.isArray(item.changes) ? (item.changes as Array<Record<string, unknown>>) : []
      const p = (typeof changes[0]?.path === 'string' ? changes[0].path : '')
      const input = { file_path: p }
      return { activity: { tool: 'Write', label: toolToLabel('Write', input), kind: toolToKind('Write', input), chip: toolToChip('Write', input) } }
    }
    if (item.type === 'mcp_tool_call' && type === 'item.started') {
      const name = `${item.server ?? 'mcp'}.${item.tool ?? 'call'}`
      return { activity: { tool: name, label: `Calling ${name}`, kind: toolToKind(name), chip: undefined } }
    }
    return null
  }
  if (type === 'turn.completed') {
    const u = (obj.usage ?? {}) as Record<string, unknown>
    const count = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0
    const inTok = count(u.input_tokens), outTok = count(u.output_tokens)
    const trailer = `\n\x1b[2m${modelLabel} · ${inTok.toLocaleString('en-US')} in / ${outTok.toLocaleString('en-US')} out\x1b[0m\n`
    return { output: trailer, meta: { costUsd: 0, turns: 1, durationMs: 0, model: modelLabel, provider: 'codex', costKnown: false, inputTokens: inTok, outputTokens: outTok, cachedInputTokens: count(u.cached_input_tokens) } }
  }
  if (type === 'error' || type === 'turn.failed') {
    const raw = (obj.error as Record<string, unknown> | undefined)?.message ?? obj.message
    const msg = typeof raw === 'string' ? raw : 'codex run failed'
    return { output: `\n[error] ${msg}\n` }
  }
  return null
}

/** `$CODEX_HOME` or `~/.codex` — auth, config and the models cache live here. */
export function codexHome(): string {
  return process.env['CODEX_HOME'] || path.join(os.homedir(), '.codex')
}

export interface CodexModel {
  /** The pick id, `codex:<slug>`. */
  id: string
  label: string
  hint: string
  efforts?: string[]
}

/**
 * The models this Codex install can actually use — read from the CLI's own
 * cache (`models_cache.json`, refreshed by Codex itself), never hard-coded:
 * a name typed into source rots (gpt-5 was already gone when this shipped).
 * Hidden entries (auto-review, reserve) stay hidden; order = Codex's priority.
 * The first entry is always "Codex · Default", the model set in config.toml.
 */
export function listCodexModels(home = codexHome()): CodexModel[] {
  let configured = ''
  try {
    const m = /^\s*model\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(path.join(home, 'config.toml'), 'utf-8'))
    configured = m?.[1] ?? ''
  } catch { /* no config → the CLI's built-in default */ }
  const list: CodexModel[] = [{ id: 'codex:', label: 'Codex · Default', hint: configured ? `The Codex CLI's configured model (${configured})` : "The Codex CLI's configured model" }]
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(home, 'models_cache.json'), 'utf-8')) as { models?: unknown }
    const models = Array.isArray(raw.models) ? (raw.models as Array<Record<string, unknown>>) : []
    const shown = models
      .filter((m) => typeof m.slug === 'string' && /^[a-z0-9][a-z0-9.-]{0,60}$/.test(m.slug) && (m.visibility ?? 'list') === 'list')
      .sort((a, b) => Number(a.priority ?? 999) - Number(b.priority ?? 999))
    for (const m of shown) {
      list.push({ id: `codex:${m.slug}`, label: `Codex · ${String(m.display_name ?? m.slug)}`, hint: String(m.description ?? '') })
    }
  } catch { /* no cache yet (never ran codex) → default only */ }
  return list
}

/** The `.mcp.json` shape mcp-config.ts writes for Claude — the source for Codex too. */
export interface McpJsonConfig {
  mcpServers: Record<string, { command?: string; args?: string[]; env?: Record<string, string>; type?: string; url?: string; headersHelper?: string }>
}

const TOML_KEY_RE = /^[A-Za-z0-9_-]+$/
const PROFILE_PREFIX = 'wos-run-'
const STALE_PROFILE_MS = 6 * 60 * 60 * 1000

/**
 * The same connectors, as Codex reads them: a `[mcp_servers.<id>]` table per
 * server in a per-run profile file, layered by `-p <name>`. stdio servers keep
 * command + args and FORWARD their secret env vars (`env_vars`, the value
 * stays in the child env — no secret is written to disk); remote servers get
 * `url` + `bearer_token_env_var` (only when a caller mints one; App Server
 * sessions use a refreshable headers helper instead). Every tool is pre-approved: nobody is at the
 * keyboard of a headless run, and Codex's approval policy is "never" anyway.
 * The file is 0600, deleted when the run ends; stale ones (a crash) are swept.
 */
export interface CodexProfileOptions {
  interactive?: boolean
  disabledServers?: string[]
  /** Full mode needs the sandbox's network switch for the bridge socket and the web. */
  safeMode: boolean
}

export function codexMcpProfileToml(cfg: McpJsonConfig, bearerEnvVarByServer: Record<string, string> = {}, opts: CodexProfileOptions = { safeMode: true }): string {
  // MEASURED (codex 0.153): layering a profile file resets shell_environment_policy
  // to its default — the agent's shell then lost the app's PATH (wos-action
  // "command not found") although `-c shell_environment_policy.inherit=all` was
  // on argv. The run-wide settings therefore live IN the profile too; the -c
  // overrides on argv still apply on top (developer_instructions verified).
  const out: string[] = [
    '# Workspace OS — per-run connector profile (deleted after the run)',
    `approval_policy = "${opts.interactive ? 'on-request' : 'never'}"`,
    '',
    '[shell_environment_policy]',
    'inherit = "all"',
    ...(opts.safeMode ? [] : ['', '[sandbox_workspace_write]', 'network_access = true']),
  ]
  for (const id of opts.disabledServers ?? []) if (TOML_KEY_RE.test(id) && !cfg.mcpServers[id]) out.push('', `[mcp_servers.${id}]`, 'enabled = false')
  for (const [id, srv] of Object.entries(cfg.mcpServers ?? {})) {
    if (!TOML_KEY_RE.test(id)) continue
    if (srv.type === 'http' || srv.url) {
      const envVar = bearerEnvVarByServer[id]
      if (opts.interactive && srv.url && srv.headersHelper) {
        out.push('', `[mcp_servers.${id}]`, `url = ${tomlString(srv.url)}`, `http_headers_helper = ${tomlString(srv.headersHelper)}`, 'default_tools_approval_mode = "prompt"')
        continue
      }
      if (!srv.url || !envVar) continue // no bearer minted → the server would only fail auth
      out.push('', `[mcp_servers.${id}]`, `url = ${tomlString(srv.url)}`, `bearer_token_env_var = ${tomlString(envVar)}`, 'default_tools_approval_mode = "approve"')
      continue
    }
    if (!srv.command) continue
    out.push('', `[mcp_servers.${id}]`, `command = ${tomlString(srv.command)}`, `args = [${(srv.args ?? []).map(tomlString).join(', ')}]`)
    const vars = Object.keys(srv.env ?? {}).filter((k) => /^[A-Z_][A-Z0-9_]*$/.test(k))
    if (vars.length) out.push(`env_vars = [${vars.map(tomlString).join(', ')}]`)
    out.push(`default_tools_approval_mode = "${opts.interactive ? 'prompt' : 'approve'}"`)
  }
  return out.join('\n') + '\n'
}

export interface CodexMcpProfile {
  /** The `-p` value. */
  name: string
  path: string
  cleanup: () => void
}

export function writeCodexMcpProfile(cfg: McpJsonConfig, runId: string, bearerEnvVarByServer: Record<string, string> = {}, opts: CodexProfileOptions = { safeMode: true }, home = codexHome()): CodexMcpProfile | null {
  const toml = codexMcpProfileToml(cfg, bearerEnvVarByServer, opts)
  if (!/\[mcp_servers\./.test(toml)) return null
  const name = PROFILE_PREFIX + runId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 48)
  const file = path.join(home, `${name}.config.toml`)
  fs.mkdirSync(home, { recursive: true })
  sweepStaleProfiles(home)
  fs.writeFileSync(file, toml, { encoding: 'utf-8', mode: 0o600 })
  try { fs.chmodSync(file, 0o600) } catch { /* best-effort */ }
  return { name, path: file, cleanup: () => { try { fs.unlinkSync(file) } catch { /* already gone */ } } }
}

function sweepStaleProfiles(home: string): void {
  let names: string[] = []
  try { names = fs.readdirSync(home) } catch { return }
  const cutoff = Date.now() - STALE_PROFILE_MS
  for (const n of names) {
    if (!n.startsWith(PROFILE_PREFIX) || !n.endsWith('.config.toml')) continue
    const f = path.join(home, n)
    try { if (fs.statSync(f).mtimeMs < cutoff) fs.unlinkSync(f) } catch { /* best-effort */ }
  }
}
