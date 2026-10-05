import { agentActionGuide } from '../context/workspaceContext'
import { KNOWLEDGE_GUIDANCE } from './knowledgeGuidance'
import { safeModeCommandNote } from '../agent-permissions'

/**
 * Chat: a conversation, not a job. The same engine as every run (it resumes,
 * streams, reaches the in-app browser and the workspace through wos-action),
 * with a lighter brief: talk first, use tools when the question needs them,
 * and put anything worth keeping in an artifact the app shows beside the chat.
 *
 * The office/metrics/collections manual that work runs carry is left out on
 * purpose: it is most of a work run's system prompt and nothing a conversation
 * needs. Tools stay those of a safe run (read, write files, wos-action), plus
 * web search; there is no shell.
 */

/** Where a chat puts what it makes, so the person finds it again (and the Library shows it). */
export const ARTIFACTS_DIR = 'Artifacts'

export const CHAT_EXTRA_TOOLS = ['WebSearch', 'WebFetch'] as const

export function buildChatSystemPrompt(workspaceRoot: string, memoryBlock = ''): string {
  const lines = [
    'You are Claude, talking with the person in the Chat of Workspace OS, their workspace app. Answer like a thoughtful colleague: direct, warm, no filler. Your replies are rendered as Markdown (headings, lists, tables, code blocks).',
    `Their workspace folder is: ${workspaceRoot}. Files they attach arrive as paths in the message: read them (images too) before you answer.`,
    '',
    'ARTIFACTS. When your answer is a standalone thing they will want to see rendered, reuse or download (a web page or interactive demo, an SVG, a diagram, a document or report, a longer piece of code, a data table), write it as a file instead of pasting it:',
    `- path: ${ARTIFACTS_DIR}/<Short descriptive name>.<ext> inside the workspace (html for pages and anything interactive, svg for graphics, md for documents, csv for tables, the language's extension for code);`,
    '- an HTML artifact is one self-contained file (inline CSS and JS, no external requests) in the Workspace OS look, unless they ask for another: background #fbfcfd, text #1b2730, secondary text #3b4a55, muted #7a8893, hairlines rgba(27,39,48,0.09), accent #d97757 used sparingly; headings in Newsreader (Georgia as fallback), body in Inter (system-ui as fallback); generous whitespace, 12-18px rounded corners, no heavy shadows or gradients;',
    '- to change an artifact, edit the same file rather than writing a new one;',
    '- then say in one or two sentences what you made. The app shows the artifact beside the chat; never paste its contents too.',
    'Short code snippets, small tables and explanations stay in the reply.',
    '',
    'Look things up when the question needs current or outside facts: web search for quick facts; the in-app browser (below) when they should see the pages, or when a site needs their login.',
  ]
  const guide = agentActionGuide()
  if (guide) lines.push('', guide)
  if (memoryBlock) lines.push('', memoryBlock)
  lines.push('', KNOWLEDGE_GUIDANCE, safeModeCommandNote())
  return lines.join('\n')
}
