import { stripAgentTelemetry } from '../agent-output'
import { brandBriefLines, type BrandBriefSource } from './brand-brief'
import { runProviderOneShot } from '../../agent/providerText'

/**
 * Agent-assisted writing for a 1:1 email — the "make it better" affordance in
 * compose. Unlike email-drafter (which drafts a whole message from a one-line
 * brief), this takes the user's CURRENT draft plus a small instruction and
 * returns a REVISED body. It is assistance on one personal message, not campaign
 * generation.
 *
 * Same two-part shape as draft-service:
 *   (a) an INJECTED `assistFn` does the language work — app = `claude -p`, tests =
 *       a deterministic fake.
 *   (b) this module builds the prompt and normalizes the result (never throws to
 *       the caller; the handler maps a rejection to a typed error).
 *
 * It NEVER sends. The revised body flows back into the compose box for the user
 * to review and edit before the user-approved MAIL_SEND path.
 */

/** The assist actions the compose UI offers. */
export type AssistAction = 'draft' | 'tighten' | 'clearer' | 'warmer' | 'add-numbers'

export interface AssistInput {
  /** The action the user picked. */
  action: AssistAction
  /** The current draft body (may be empty for 'draft'). */
  draft: string
  /** Optional free-text instruction / notes to steer the rewrite. */
  instruction?: string
  /** The user's saved Brand kit — when set, the prompt carries a brand brief. */
  brandKit?: BrandBriefSource
}

/** Produces a revised body from the current draft + action. Injected for tests. */
export type AssistFn = (input: AssistInput) => Promise<string>

const MAX_DRAFT_CHARS = 12_000
const MAX_INSTRUCTION_CHARS = 2000
const ASSIST_TIMEOUT_MS = 90_000

/** Per-action guidance appended to the base instruction. */
const ACTION_GUIDANCE: Record<AssistAction, string> = {
  draft:
    'Draft a complete, sendable 1:1 email body from the notes below. Warm, concise, human — one real person to one recipient.',
  tighten:
    'Tighten the draft below: cut filler and redundancy, keep every fact and the meaning. Shorter, sharper, same voice.',
  clearer:
    'Make the draft below clearer: simpler sentences, unambiguous asks, logical order. Do not add new claims.',
  warmer:
    'Make the draft below warmer and more personable while staying professional. Keep it a 1:1 message, not gushing.',
  'add-numbers':
    'Weave the live-data placeholders the user references into the draft below where they read naturally. If the user names a metric as {{metric:id}}, KEEP that token verbatim — it is resolved to a live number later. Do not invent numbers.',
}

/**
 * Build the assist prompt. Output is the revised BODY only — no subject, no
 * quoted original, no commentary. Pure + unit-testable.
 */
export function buildAssistPrompt(input: AssistInput): string {
  const action: AssistAction = ACTION_GUIDANCE[input.action] ? input.action : 'tighten'
  const draft = (input.draft || '').slice(0, MAX_DRAFT_CHARS)
  const lines = [
    'You are a writing assistant helping the account owner with ONE personal email.',
    ACTION_GUIDANCE[action],
    'Return ONLY the email body text — no subject line, no "Re:", no quoted original,',
    'no explanation of what you changed. It will be inserted directly into the',
    'compose box for the user to review and edit before sending.',
    'Preserve any {{metric:id}} tokens verbatim; they are resolved to live numbers later.',
  ]
  if (input.instruction && input.instruction.trim()) {
    lines.push('', 'User instruction / notes:', input.instruction.trim().slice(0, MAX_INSTRUCTION_CHARS))
  }
  lines.push(...brandBriefLines(input.brandKit))
  lines.push('', '--- Current draft ---', draft || '(empty)', '--- end ---')
  return lines.join('\n')
}

/**
 * Run one assist action. Pure orchestration over the injected `assistFn`: builds
 * the prompt, calls the fn, trims the result. Rejections propagate (the handler
 * maps them to a typed error) — this never sends.
 */
export async function runAssist(assistFn: AssistFn, input: AssistInput): Promise<string> {
  const raw = await assistFn(input)
  return typeof raw === 'string' ? stripAgentTelemetry(stripCommentary(raw)) : ''
}

/**
 * Defensive: if a model prefixes a line like "Here's the revised email:" despite
 * the instruction, drop a single leading meta line ending in a colon. Never
 * strips real content (only a first line that is clearly a preamble).
 */
export function stripCommentary(s: string): string {
  const t = s.trim()
  const firstNl = t.indexOf('\n')
  if (firstNl === -1) return t
  const first = t.slice(0, firstNl).trim()
  if (/^(here'?s|here is|sure|certainly|revised|updated)\b.*:$/i.test(first)) {
    return t.slice(firstNl + 1).trim()
  }
  return t
}

/** Builds the app-wired assistFn (`claude -p`, subscription, no API key). */
export function makeAssistFn(): AssistFn {
  return (input) => runClaudeAssist(buildAssistPrompt(input))
}

/** Runs `claude -p` with the prompt on stdin; resolves the full stdout text. */
function runClaudeAssist(prompt: string): Promise<string> {
  return runProviderOneShot(prompt, { timeoutMs: ASSIST_TIMEOUT_MS, label: 'The writing assistant' })
}
