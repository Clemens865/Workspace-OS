import path from 'path'

/**
 * Permission broker (MVP) for agent runs + input sanitizers for the run
 * pipeline. Pure module (no electron imports) so it is unit-testable.
 *
 * Background: `claude -p` cannot show interactive permission prompts — tools
 * are pre-authorized via flags, and anything not allowed is auto-denied.
 * Full mode used to run `--permission-mode bypassPermissions` (everything,
 * unprompted, including MCP tools and any shell command). This module replaces
 * that with scoped allow/deny lists:
 *
 *  - safe mode: read/search + file writes + the office generator only.
 *  - full mode: file edits, web, subagents, skills and shell commands — but
 *    with a deny list for destructive / persistence-creating command classes
 *    (rm -rf, sudo, disk tooling, launchctl/crontab, shutdown).
 *
 * Honest limits: deny patterns are prefix matches on the command string; an
 * indirection like `sh -c "rm -rf …"` is not caught. The pre-run shadow-git
 * checkpoint remains the workspace safety net — this layer's main win is
 * ending blanket bypass. A real interactive approval gate (HITL) needs the
 * PTY / stream-json control-protocol session type (see IWE-GAP-ANALYSIS §4.3).
 */

/**
 * Safe mode: read + generate documents only (unchanged behavior).
 *
 * The two Bash grants are PREFIX patterns — they match a command that *starts*
 * with `wos-gen` / `wos-action`. Anything compound (`cd /w && wos-action …`, a
 * pipe, a `for` loop) does NOT match and is denied, which reads to the agent as
 * "browser permission wasn't granted" with no hint why. The system prompt tells
 * safe-mode agents to invoke them bare (see safeModeCommandNote) — the honest fix,
 * since a prefix grant cannot be made to cover arbitrary shell shapes without
 * giving up the restriction that makes safe mode safe.
 */
const SAFE_ALLOWED = ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash(wos-gen:*)', 'Bash(wos-action:*)']

/**
 * The safe-mode shell caveat, injected into the run system prompt. Without it an
 * agent writes a perfectly reasonable `cd "$WS" && wos-action run browser.map`,
 * gets denied by the prefix pattern, and concludes it has no browser access.
 */
export function safeModeCommandNote(): string {
  return [
    'SHELL LIMITS (safe mode): you may run ONLY `wos-gen` and `wos-action`, and ONLY as the FIRST word of the command.',
    'Run them BARE — no `cd` prefix, no `&&`, no pipes, no subshells, no wrapping loop. `wos-action run browser.map` is allowed; `cd /somewhere && wos-action run browser.map` is DENIED.',
    'Pass absolute paths as arguments instead of changing directory. If a command is denied, do not conclude the capability is missing — reshape it as a single bare command and try once more.',
  ].join('\n')
}

/**
 * Full mode: the tools a workspace agent legitimately needs. Names cover
 * current and older CLI builds (unknown names are ignored by the CLI).
 * Deliberately NOT listed: CronCreate/CronDelete, ScheduleWakeup,
 * RemoteTrigger, Workflow (persistent background effects) — those stay
 * auto-denied in -p mode.
 */
const FULL_ALLOWED = [
  'Read', 'Glob', 'Grep',
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
  // Task/Agent = subagent fan-out. A full-mode LEAD can spawn parallel subagents
  // (the "parallel research" flow, Stage 3): each subagent runs inside the SAME
  // `claude -p` process, so it inherits this run's env — WOS_AGENT_SOCK + the
  // `wos-action`/`wos-gen` PATH (set in handlers/agent.ts childEnv) — and can
  // drive its own browser tab via the bridge. Safe mode (SAFE_ALLOWED) omits
  // Task/Agent, so a safe agent never gains subagents or unscoped tools.
  'TodoWrite', 'Task', 'Agent', 'Skill', 'ToolSearch',
  'WebFetch', 'WebSearch',
  'Bash', 'BashOutput', 'KillShell',
]

/** Destructive / persistence-creating command classes denied in full mode. */
const FULL_DISALLOWED = [
  'Bash(sudo:*)',
  'Bash(rm -rf:*)', 'Bash(rm -fr:*)', 'Bash(rm -Rf:*)', 'Bash(rm -fR:*)',
  'Bash(shutdown:*)', 'Bash(reboot:*)', 'Bash(halt:*)',
  'Bash(mkfs:*)', 'Bash(dd:*)', 'Bash(diskutil:*)',
  'Bash(launchctl:*)', 'Bash(crontab:*)',
]

/**
 * The permission flags for one agent run. Both modes now run under the
 * default permission mode; nothing bypasses the permission system.
 *
 * `mcpTools` are the per-run MCP allowlist entries (`mcp__<server>__*`) for the
 * connectors enabled for this run. They are appended to `--allowedTools` so the
 * agent may reach ONLY the enabled connectors' tools — least privilege. An
 * empty list leaves behavior unchanged. Entries are validated (a non-conforming
 * string can't smuggle a flag into argv).
 */
export function permissionArgs(
  mode: 'safe' | 'full',
  mcpTools: string[] = [],
  opts: { inAppBrowserOnly?: boolean } = {},
): string[] {
  const mcp = mcpTools.filter(isValidMcpTool)
  // A research agent must go through the IN-APP browser, not WebFetch/WebSearch.
  // Given both, a model reaches for the direct tools every time — and that
  // silently loses everything the browser surface is for: the user can SEE the
  // pages being read, tabs fan out in parallel, screenshots can be captured as
  // evidence, and the session inherits Connected-Accounts logins that a bare
  // fetch has no access to. Denying them is what makes "use the built-in
  // browser" true rather than merely requested.
  const web = opts.inAppBrowserOnly ? ['WebFetch', 'WebSearch'] : []
  if (mode === 'safe') {
    return web.length
      ? ['--allowedTools', ...SAFE_ALLOWED, ...mcp, '--disallowedTools', ...web]
      : ['--allowedTools', ...SAFE_ALLOWED, ...mcp]
  }
  return ['--allowedTools', ...FULL_ALLOWED, ...mcp, '--disallowedTools', ...FULL_DISALLOWED, ...web]
}

/**
 * A valid MCP allowlist entry: `mcp__<server>__<tool-or-*>`. Restricting the
 * shape means a tampered connector list can't inject a bare `--flag` into argv.
 */
const MCP_TOOL_RE = /^mcp__[a-z0-9_-]+__[A-Za-z0-9_*]+$/
export function isValidMcpTool(tool: unknown): tool is string {
  return typeof tool === 'string' && MCP_TOOL_RE.test(tool)
}

// ---- input sanitizers for the run pipeline --------------------------------

/** Stable per-tab conversation key shape (renderer-generated). */
export const CONVERSATION_ID_RE = /^[a-z0-9-]{6,60}$/i

/**
 * Claude session ids are UUIDs. They end up on the child argv as the value of
 * `--resume`, so anything else (e.g. a flag smuggled into the persisted
 * agent-conversations.json) must be rejected.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isValidClaudeSessionId(sid: unknown): sid is string {
  return typeof sid === 'string' && UUID_RE.test(sid)
}

export const MAX_CONTEXT_FILES = 32
const MAX_PATH_CHARS = 1024
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/**
 * A file path that is safe to interpolate into the prompt / system prompt:
 * absolute, bounded, and free of control characters (a newline inside a
 * "path" could forge extra prompt lines). Returns null when invalid.
 */
export function sanitizePromptPath(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const p = input.trim()
  if (!p || p.length > MAX_PATH_CHARS) return null
  if (CONTROL_CHARS.test(p)) return null
  if (!path.isAbsolute(p)) return null
  return p
}

/** Sanitizes the dropped context-file list: valid prompt paths, capped. */
export function sanitizeContextFiles(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const f of input) {
    const p = sanitizePromptPath(f)
    if (p && !out.includes(p)) out.push(p)
    if (out.length >= MAX_CONTEXT_FILES) break
  }
  return out
}
