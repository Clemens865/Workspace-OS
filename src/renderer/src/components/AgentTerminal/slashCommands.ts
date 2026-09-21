/**
 * Slash command registry for the Agent Terminal.
 *
 * A command is either:
 *  - `local`: handled entirely in the renderer (clear, help, status) — returns
 *    system text or performs a terminal action.
 *  - `agent`: builds a prompt that is run through the Claude CLI bridge, with
 *    the current open file passed as context.
 */

export interface CommandContext {
  /** Path of the file currently open in the canvas, if any. */
  activeFile: string | null
  /** Extra files the user dropped into the terminal as context. */
  contextFiles: string[]
}

export type LocalResult = { kind: 'system'; text: string } | { kind: 'clear' } | { kind: 'status' }

export interface SlashCommand {
  name: string
  description: string
  usage?: string
  /** Builds the agent prompt; absent for local-only commands. */
  buildPrompt?: (args: string, ctx: CommandContext) => string
  /** Local handler; absent for agent commands. */
  runLocal?: (args: string, ctx: CommandContext) => LocalResult
}

export const COMMANDS: SlashCommand[] = [
  {
    name: 'summarize',
    description: 'Summarize the current document',
    buildPrompt: (_args, ctx) =>
      `Summarize the document at ${ctx.activeFile} in 5 concise bullet points.`,
  },
  {
    name: 'brief',
    description: 'Briefing from the current document or context files',
    usage: '/brief [topic]',
    buildPrompt: (args, ctx) => {
      const focus = args.trim() ? ` Focus on: ${args.trim()}.` : ''
      return `Prepare a short briefing based on ${ctx.activeFile ?? 'the context files'}.${focus}`
    },
  },
  {
    name: 'extract-todos',
    description: 'Pull every action item from the current document',
    buildPrompt: (_args, ctx) =>
      `Extract every action item, decision, and deadline from ${ctx.activeFile}. List them grouped by owner if possible.`,
  },
  {
    name: 'draft',
    description: 'Draft an email or document from context',
    usage: '/draft <what to draft>',
    buildPrompt: (args, ctx) =>
      `Draft the following based on ${ctx.activeFile ?? 'the open context'}: ${args.trim() || 'a follow-up summary'}.`,
  },
  {
    name: 'translate',
    description: 'Translate the current document',
    usage: '/translate <language>',
    buildPrompt: (args, ctx) =>
      `Translate the document at ${ctx.activeFile} into ${args.trim() || 'English'}.`,
  },
  {
    name: 'compare',
    description: 'Compare the context files',
    usage: '/compare (drop two files first)',
    buildPrompt: (_args, ctx) =>
      `Compare these documents and explain the key differences:\n${ctx.contextFiles.join('\n')}`,
  },
  {
    name: 'agent',
    description: 'Give the agent a free-form task',
    usage: '/agent <task>',
    buildPrompt: (args) => args.trim(),
  },
  {
    name: 'help',
    description: 'List available commands',
    runLocal: () => ({
      kind: 'system',
      text:
        'Commands:\n' +
        COMMANDS.map((c) => `  /${c.name}${c.usage ? ` — ${c.usage}` : ''} — ${c.description}`).join('\n') +
        '\n\nOr just type a question to ask the agent.',
    }),
  },
  {
    name: 'clear',
    description: 'Clear the terminal',
    runLocal: () => ({ kind: 'clear' }),
  },
  {
    name: 'status',
    description: 'Show running agents',
    runLocal: () => ({ kind: 'status' }),
  },
]

export function findCommand(name: string): SlashCommand | undefined {
  return COMMANDS.find((c) => c.name === name)
}

/** Returns command name matches for autocomplete on a partial `/xyz` input. */
export function matchCommands(partial: string): SlashCommand[] {
  const q = partial.toLowerCase()
  return COMMANDS.filter((c) => c.name.startsWith(q))
}
