/**
 * Turns raw stream-json `tool_use` events into calm, human-readable activity
 * labels for the agent tab's "what it's doing" indicator. This is pure parsing
 * of output we ALREADY receive from the streaming run — it spawns nothing and
 * costs no extra Claude tokens.
 */

/** The icon family a step belongs to — the trace renders by kind, not tool name. */
export type ActivityKind = 'think' | 'read' | 'write' | 'run' | 'web' | 'search' | 'app'

export interface AgentActivity {
  /** The underlying tool name (Bash, Read, Write, WebSearch, Task, …). */
  tool: string
  /** A short, friendly present-tense label, e.g. "Reading a file: notes.md". */
  label: string
  /** Icon family for the run trace. */
  kind: ActivityKind
  /** The compact mono detail — a file basename, a command, a domain — split
   *  from the label so the trace can render `Reading a file  [notes.md]`. */
  chip?: string
}

/** The basename of a path-ish string, for compact "Reading a file: <name>". */
function baseName(p: unknown): string {
  if (typeof p !== 'string' || !p.trim()) return ''
  const clean = p.trim().replace(/[/\\]+$/, '')
  const parts = clean.split(/[/\\]/)
  return parts[parts.length - 1] || clean
}

/**
 * Maps a tool name + its input to a friendly activity label. Pure and total:
 * always returns a sensible label, even for unknown tools. Kept deliberately
 * small — this is a light enrichment, not a full tool taxonomy.
 */
export function toolToLabel(tool: string, input: Record<string, unknown> = {}): string {
  const name = String(tool || '').trim()
  const cmd = typeof input['command'] === 'string' ? (input['command'] as string) : ''

  switch (name) {
    case 'Read':
      return input['file_path'] ? `Reading a file: ${baseName(input['file_path'])}` : 'Reading a file'
    case 'Write':
      return input['file_path'] ? `Writing a document: ${baseName(input['file_path'])}` : 'Writing a document'
    case 'Edit':
    case 'MultiEdit':
      return input['file_path'] ? `Editing a file: ${baseName(input['file_path'])}` : 'Editing a file'
    case 'WebSearch':
      return 'Searching the web'
    case 'WebFetch':
      return 'Reading a web page'
    case 'Task':
    case 'Agent':
      return 'Delegating to a helper'
    case 'Glob':
    case 'Grep':
      return 'Searching the workspace'
    case 'TodoWrite':
      return 'Planning the steps'
    case 'Bash': {
      // Route by the shim/command the agent is running.
      if (/\bbrowser\.deepRead\b/.test(cmd)) return 'Deep-reading a site'
      if (/wos-action\s+browser\./.test(cmd)) return 'Browsing the web'
      if (/\bwos-gen\b/.test(cmd)) return 'Writing a document'
      if (/\bwos-metric\b/.test(cmd)) return 'Updating live metrics'
      if (/\bwos-collection\b/.test(cmd)) return 'Updating a live collection'
      if (/\bwos-action\b/.test(cmd)) return 'Working in the app'
      return 'Running a command'
    }
    default:
      // MCP tools arrive as mcp__<server>__<tool>; surface the server name.
      if (name.startsWith('mcp__')) {
        const server = name.split('__')[1] ?? ''
        return server ? `Using ${server}` : 'Using a connector'
      }
      return name ? `Using ${name}` : 'Working'
  }
}

/** The icon family for a tool + input — how the trace picks its glyph. */
export function toolToKind(tool: string, input: Record<string, unknown> = {}): ActivityKind {
  const cmd = typeof input['command'] === 'string' ? (input['command'] as string) : ''
  switch (tool) {
    case 'Read': return 'read'
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'TodoWrite': return 'write'
    case 'WebSearch':
    case 'WebFetch': return 'web'
    case 'Glob':
    case 'Grep': return 'search'
    case 'Bash':
      if (/wos-action\s+browser\.|\bbrowser\.deepRead\b/.test(cmd)) return 'web'
      if (/\bwos-gen\b/.test(cmd)) return 'write'
      if (/\bwos-action\b|\bwos-metric\b|\bwos-collection\b/.test(cmd)) return 'app'
      return 'run'
    default:
      return tool.startsWith('mcp__') ? 'app' : 'run'
  }
}

/** The compact mono detail for a tool call — what the trace shows in its chip. */
export function toolToChip(tool: string, input: Record<string, unknown> = {}): string | undefined {
  const file = baseName(input['file_path'])
  if (file) return file
  if (typeof input['query'] === 'string' && input['query']) return String(input['query']).slice(0, 60)
  if (typeof input['url'] === 'string' && input['url']) {
    try { return new URL(String(input['url'])).hostname } catch { return String(input['url']).slice(0, 60) }
  }
  if (typeof input['pattern'] === 'string' && input['pattern']) return String(input['pattern']).slice(0, 60)
  if (tool === 'Bash' && typeof input['command'] === 'string') {
    // First meaningful token run — enough to recognise, short enough to chip.
    return String(input['command']).replace(/\s+/g, ' ').trim().slice(0, 60) || undefined
  }
  return undefined
}

function fromToolUse(block: Record<string, unknown>): AgentActivity | null {
  const tool = String(block['name'] ?? '')
  if (!tool) return null
  const inp = (block['input'] as Record<string, unknown>) ?? {}
  const activity: AgentActivity = { tool, label: toolToLabel(tool, inp), kind: toolToKind(tool, inp) }
  const chip = toolToChip(tool, inp)
  if (chip) activity.chip = chip
  return activity
}

/**
 * Detects a `tool_use` in one stream-json line and returns its activity signal,
 * or null for every other line. The CLI's stream-json emits tool_use both as a
 * `content_block_start` on a `stream_event` and inside `assistant` message
 * content — we handle both shapes so the label appears as early as possible.
 * A `thinking` block surfaces too: the trace's first row is usually thought.
 */
export function extractActivity(line: string): AgentActivity | null {
  const t = line.trim()
  if (t[0] !== '{') return null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(t)
  } catch {
    return null
  }

  // Shape A: streamed content_block_start carrying a tool_use block.
  const ev = obj['event'] as Record<string, unknown> | undefined
  if (obj['type'] === 'stream_event' && ev && ev['type'] === 'content_block_start') {
    const block = ev['content_block'] as Record<string, unknown> | undefined
    if (block && block['type'] === 'tool_use') return fromToolUse(block)
    if (block && block['type'] === 'thinking') {
      return { tool: 'Thinking', label: 'Thinking', kind: 'think' }
    }
    return null
  }

  // Shape B: a complete assistant message whose content includes tool_use.
  if (obj['type'] === 'assistant') {
    const msg = obj['message'] as Record<string, unknown> | undefined
    const content = msg?.['content']
    if (Array.isArray(content)) {
      for (const b of content) {
        const block = b as Record<string, unknown>
        if (block?.['type'] === 'tool_use') return fromToolUse(block)
      }
    }
  }

  return null
}
