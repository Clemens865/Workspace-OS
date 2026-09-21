import type { DraftFn, DraftFnInput } from './draft-service'
import { runProviderOneShot } from '../agent/providerText'

/**
 * The APP wiring of the draft-service's injected `draftFn`: it runs the same
 * `claude -p` subscription pipeline the IWE agent uses (no API key, no extra
 * cost) to produce a suggested reply body from the source message's CONTENT.
 *
 * Security / discipline:
 *  - The prompt is fed via STDIN, never argv (a body starting with `--` must not
 *    be parsed as flags, and argv is visible to `ps`). Mirrors handlers/agent.ts.
 *  - The drafter is given message CONTENT only — never the account secret.
 *  - It DRAFTS, it does not send. Sending is the user-approved Phase-2 path.
 *  - Runs read-only: no permission flags are granted, so in -p mode the model
 *    cannot use tools — it just writes text. A safe default for "suggest a reply".
 */

/** Max characters of source body we hand the drafter (keeps the prompt bounded). */
const MAX_SOURCE_CHARS = 8000
/** Hard cap on how long we wait for the model before giving up. */
const DRAFT_TIMEOUT_MS = 90_000

/** Builds the agent-backed draftFn. Kept out of the IPC handler for testability. */
export function makeAgentDraftFn(): DraftFn {
  return (input: DraftFnInput) => runClaudeDraft(buildDraftPrompt(input))
}

/** Composes the drafting instruction from the reply context (content only). */
export function buildDraftPrompt(input: DraftFnInput): string {
  const src = input.source
  const fromLine = src.from.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ')
  const body = (src.text || '').slice(0, MAX_SOURCE_CHARS)
  const lines = [
    'You are drafting a reply to an email on behalf of the account owner.',
    `You are: ${input.self.name ? `${input.self.name} <${input.self.address}>` : input.self.address}.`,
    'Write ONLY the reply body — no subject line, no quoted original, no "Re:", no commentary about what you are doing. It will be inserted directly into the compose box for the user to review and edit before sending.',
    input.replyAll
      ? 'This is a reply-all; you may address the group where natural.'
      : 'This is a direct reply to the sender.',
    'Keep it concise, professional and in the sender\'s language. If the email asks questions, address them. If information is missing, write a sensible placeholder in [brackets] for the user to fill in.',
  ]
  if (input.instruction && input.instruction.trim()) {
    lines.push(`Additional instruction from the user: ${input.instruction.trim()}`)
  }
  lines.push(
    '',
    '--- The email you are replying to ---',
    `From: ${fromLine}`,
    `Subject: ${src.subject}`,
    src.date ? `Date: ${src.date}` : '',
    '',
    body,
    '--- end of email ---',
  )
  return lines.filter((l) => l !== undefined).join('\n')
}

/** Runs `claude -p` with the prompt on stdin and resolves the full stdout text. */
function runClaudeDraft(prompt: string): Promise<string> {
  return runProviderOneShot(prompt, { timeoutMs: DRAFT_TIMEOUT_MS, label: 'The drafting agent' })
}
