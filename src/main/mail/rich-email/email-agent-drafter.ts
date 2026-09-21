import { buildEmailDraftPrompt, type EmailDraftFn } from './email-drafter'
import { runProviderOneShot } from '../../agent/providerText'

/**
 * APP wiring of the email-drafter's injected `draftFn`: it runs the same
 * `claude -p` subscription pipeline the IWE agent / mail-drafter use (no API key,
 * no extra cost) to turn a one-line brief into MJML source for a 1:1 email.
 *
 * Security / discipline (mirrors mail-drafter.ts):
 *  - The prompt is fed via STDIN, never argv (a brief starting with `--` must not
 *    parse as flags; argv is visible to `ps`).
 *  - Read-only: no permission flags → in -p mode the model cannot use tools, it
 *    just writes text (here, MJML). A safe default for "design an email".
 *  - It DRAFTS, it does not send. Sending is the user-approved MAIL_SEND path.
 */

const DRAFT_TIMEOUT_MS = 120_000

/** Builds the agent-backed draftFn. Kept out of the IPC handler for testability. */
export function makeEmailAgentDraftFn(): EmailDraftFn {
  return (input) => runClaudeDraft(buildEmailDraftPrompt(input))
}

/**
 * Runs an already-built prompt through the same subscription pipeline.
 *
 * The from-a-file path builds its own prompt (it carries spreadsheet data and
 * asks for blocks rather than MJML) but wants identical execution: stdin not
 * argv, no tools, drafts only. Exposing the runner rather than copying it keeps
 * that one place — the security notes above apply to both callers.
 */
export function runEmailPrompt(prompt: string): Promise<string> {
  return runClaudeDraft(prompt)
}

/** Runs `claude -p` with the prompt on stdin and resolves the full stdout text. */
function runClaudeDraft(prompt: string): Promise<string> {
  return runProviderOneShot(prompt, { timeoutMs: DRAFT_TIMEOUT_MS, label: 'The writing assistant' })
}
