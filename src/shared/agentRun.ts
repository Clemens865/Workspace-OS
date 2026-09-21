export interface AgentRunFailure {
  kind: 'output-limit' | 'provider-error'
  message: string
  /** Main confirms that this run captured a session that can be resumed. */
  canResume?: boolean
}

export const documentOutputGuidance = 'For long documents, work in small sections and save each section to the file before continuing. Keep tool calls and generated specifications small too. Verify the finished file, then give a brief chat summary with its path instead of repeating the document.'

export const continueUnfinishedWorkPrompt = [
  'Continue the unfinished work from this conversation after the response limit was reached.',
  'First inspect the existing files, case notes, and completed actions. Preserve completed work and user edits; repair any incomplete last write before proceeding.',
  'Finish only what remains. Do not repeat completed external actions, create duplicate files or case attachments, or restart the original task from scratch.',
  documentOutputGuidance,
].join('\n')
