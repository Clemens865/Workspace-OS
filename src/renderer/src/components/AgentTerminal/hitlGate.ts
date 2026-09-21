/**
 * HITL approval gate for the interactive PTY `claude` session (broker v2).
 *
 * Adapted from Chrome_Buddy's `src/agent/hitl.ts` pure resolver pattern: the
 * decision core owns no UI and does no I/O. The difference is the transport —
 * Chrome_Buddy gated tool calls *inside* its own runtime; here `claude` runs
 * in a PTY and emits its OWN native permission prompt to the terminal, so this
 * module (a) DETECTS that prompt in the PTY byte stream and (b) maps the user's
 * allow / allow-for-session / deny decision to the keystrokes written back to
 * the PTY. Both halves are pure functions so they unit-test without a PTY, auth,
 * or a real claude run.
 *
 * Prompt format (empirically confirmed against claude 2.1.199 by scanning the
 * binary's strings — a full run needs auth + a tool call, which can't be driven
 * headlessly). The interactive TUI renders an ink select menu:
 *
 *   Do you want to proceed?                       ← header (varies by tool; see HEADERS)
 *   ❯ 1. Yes                                       ← default-highlighted = allow once
 *     2. Yes, and don't ask again for <cmd>        ← allow for session (label varies)
 *     3. No, and tell Claude what to do differently ← deny (constant across tools)
 *
 * Detection fires only once BOTH the "Do you want to…" header and the constant
 * deny line are present in the recent output — i.e. the menu is fully drawn and
 * awaiting a choice (a partial redraw won't false-trigger).
 */

/** The user's decision, mirroring Chrome_Buddy's allow / allow-session / deny. */
export type HitlDecision = 'allow-once' | 'allow-session' | 'deny'

/** What kind of action claude is asking to perform (best-effort classification). */
export type PermissionKind = 'edit' | 'command' | 'fetch' | 'connection' | 'generic'

export interface PermissionPrompt {
  kind: PermissionKind
  /** The header line as shown (e.g. "Do you want to proceed?"). */
  question: string
}

/** The constant deny option — present in every tool-permission prompt. Its
 *  presence is what tells us the menu is fully rendered and awaiting input. */
const DENY_MARKER = 'No, and tell Claude what to do differently'

/** Header → kind classification. Order matters: first match wins. */
const HEADERS: { re: RegExp; kind: PermissionKind }[] = [
  { re: /Do you want to make this edit to/i, kind: 'edit' },
  { re: /Do you want to allow Claude to fetch this content/i, kind: 'fetch' },
  { re: /Do you want to allow this connection/i, kind: 'connection' },
  { re: /Do you want to (create|run)/i, kind: 'command' },
  { re: /Do you want to proceed\?/i, kind: 'generic' },
]

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

/** Strips ANSI/VT escape sequences so the prompt text can be pattern-matched. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

/**
 * Detects a fully-rendered claude permission prompt in a window of recent PTY
 * output. Pure: pass the accumulated (ANSI-included) tail; returns the prompt
 * descriptor when the menu is awaiting a decision, else null.
 */
export function detectPermissionPrompt(recentOutput: string): PermissionPrompt | null {
  const text = stripAnsi(recentOutput)
  // The menu isn't actionable until the deny option has been drawn.
  if (!text.includes(DENY_MARKER)) return null

  for (const { re, kind } of HEADERS) {
    const m = re.exec(text)
    if (m) {
      // Report the matched header line (trimmed to the sentence) as the question.
      const line = extractLine(text, m.index)
      return { kind, question: line }
    }
  }
  return null
}

/** Returns the trimmed line of `text` containing offset `at`. */
function extractLine(text: string, at: number): string {
  const start = text.lastIndexOf('\n', at) + 1
  const end = text.indexOf('\n', at)
  return text.slice(start, end === -1 ? undefined : end).trim()
}

/**
 * Maps a decision to the keystrokes written to the PTY. The claude ink menu
 * defaults its cursor to option 1 ("Yes"), so:
 *   - allow-once   → Enter (accept the highlighted first option)
 *   - allow-session→ Down then Enter (move to the 2nd option, then accept)
 *   - deny         → Escape (rejects the action without the follow-up prompt)
 *
 * Arrow+Enter is chosen over numeric hotkeys deliberately: it's robust whether
 * or not the build honours "1/2/3" hotkeys, and Escape denies safely regardless
 * of how many options a given tool's prompt has.
 */
export function decisionToKeys(decision: HitlDecision): string {
  switch (decision) {
    case 'allow-once':
      return '\r'
    case 'allow-session':
      return '\x1b[B\r'
    case 'deny':
      return '\x1b'
  }
}

/** A human label for the prompt kind, for the approve/deny affordance. */
export function describePrompt(prompt: PermissionPrompt): string {
  switch (prompt.kind) {
    case 'edit':
      return 'Claude wants to edit a file'
    case 'command':
      return 'Claude wants to run a command'
    case 'fetch':
      return 'Claude wants to fetch web content'
    case 'connection':
      return 'Claude wants to open a connection'
    case 'generic':
      return 'Claude is asking for permission'
  }
}
