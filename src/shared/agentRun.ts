export interface AgentRunFailure {
  kind: 'output-limit' | 'provider-error'
  message: string
  /** Main confirms that this run captured a session that can be resumed. */
  canResume?: boolean
}

export const documentOutputGuidance = 'For long documents, work in small sections and save each section to the file before continuing. Keep tool calls and generated specifications small too. Verify the finished file, then give a brief chat summary with its path instead of repeating the document.'

/** What a paused run is told when the person resumes it (same session, same conversation). */
export const continuePausedWorkPrompt = [
  'You were paused by the person in the middle of this task; they have now resumed you.',
  'First inspect the existing files, case notes, and completed actions. Preserve completed work and any edits made while you were paused; repair any incomplete last write before proceeding.',
  'Continue from where you stopped. Do not repeat completed external actions, create duplicate files or case attachments, or restart the task from scratch.',
].join('\n')

/**
 * The resume prompt for a paused run. A provider session keeps only finished
 * turns, so whatever the run was writing when it was paused is not in it (seen
 * live: a resumed count restarted from one). The app kept that text, so it is
 * handed back: the agent continues from the actual last words.
 */
export function pausedResumePrompt(tail?: string | null): string {
  // eslint-disable-next-line no-control-regex
  const last = (tail ?? '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim().slice(-800)
  if (!last) return continuePausedWorkPrompt
  return [
    continuePausedWorkPrompt,
    '',
    'Your previous turn was cut off by the pause, so the task is NOT finished. The conversation history does not contain what you wrote in that turn; this is exactly how far you got:',
    `«${last}»`,
    'Continue the task from the very next step after that text. Do not repeat it, and do not say the task is complete unless you have just finished it now.',
  ].join('\n')
}

export const continueUnfinishedWorkPrompt = [
  'Continue the unfinished work from this conversation after the response limit was reached.',
  'First inspect the existing files, case notes, and completed actions. Preserve completed work and user edits; repair any incomplete last write before proceeding.',
  'Finish only what remains. Do not repeat completed external actions, create duplicate files or case attachments, or restart the original task from scratch.',
  documentOutputGuidance,
].join('\n')
