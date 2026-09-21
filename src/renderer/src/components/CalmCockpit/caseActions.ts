import type { NoteSignal } from '../../types/workspace-api'
import { documentOutputGuidance } from '../../../../shared/agentRun'

/**
 * The prompts behind a case's offers.
 *
 * Kept pure and separate because this is where the quality lives. Wiring a
 * button to `agent.run` is trivial; what decides whether the answer is worth
 * reading is what the agent is told, and that deserves to be reviewable and
 * testable rather than buried in a click handler.
 *
 * Two rules run through all of them:
 *
 * 1. THE CASE IS THE CONTEXT. The whole case file goes in. That is the point of
 *    storing it as markdown — the agent gets what was sent, what was decided
 *    and what happened last time, instead of starting cold from one line.
 *
 * 2. THE AGENT WRITES BACK. Every prompt ends by telling it to record what it
 *    learned with `cases.note`. A run whose findings live only in a transcript
 *    has not helped the case; the next run would start cold again, which is the
 *    exact failure cases exist to end.
 */

export interface CaseAgentTask {
  /** The prompt sent to the agent. */
  prompt: string
  /** Shown while it runs. */
  label: string
}

/**
 * The run id for a case's agent hand-off.
 *
 * Main validates run ids against /^[a-z0-9-]{6,40}$/ (handlers/agent.ts), and a
 * case id is a title slug of up to SIXTY characters — so `case-<id>-<ts>` blew
 * the cap for any realistically-titled case and every hand-off was rejected
 * before the agent started. Silently, which is its own bug, fixed where the
 * calls are made. A slice of the slug stays for legibility in run listings;
 * the timestamp and sequence distinguish simultaneous handoffs.
 */
let runSequence = 0
export function caseRunId(caseId: string, now = Date.now()): string {
  const slug = caseId.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16) || 'case'
  runSequence = (runSequence + 1) % 46656
  return `case-${slug}-${now}-${runSequence.toString(36)}`
}

const WRITE_BACK = (caseId: string): string =>
  [
    '',
    documentOutputGuidance,
    'WHEN YOU ARE DONE — record it on the case, or this run helped nobody:',
    `  wos-action run cases.note --id "${caseId}" --text "<what you found, in one or two sentences>"`,
    'Write what a person would want to know later, not a summary of your process.',
    'If you found nothing useful, say that in the note. An honest blank is worth more',
    'than a confident guess, and the next run needs to know the ground was covered.',
  ].join('\n')

/**
 * Builds the task for one offer.
 *
 * `caseMarkdown` is the whole case file, from `cases.asContext(id)`.
 */
/**
 * A free instruction, carrying the whole case.
 *
 * This is the general form, and the three fixed offers are shortcuts to it.
 * Guessing intent from a note only ever covers what we anticipated — "write the
 * follow-up", "compare this to the other two", "draft a polite withdrawal" are
 * all things a person will want and none of them is a button. A box that takes
 * any sentence and hands over the full context covers them all.
 */
export function buildAskTask(instruction: string, caseId: string, caseMarkdown: string): CaseAgentTask {
  return {
    label: instruction.length > 48 ? `${instruction.slice(0, 45)}…` : instruction,
    prompt: [
      instruction.trim(),
      '',
      'THE CASE — everything known so far. Read it before doing anything; it is',
      'what was actually sent, what was decided, and what happened last time.',
      '',
      caseMarkdown.trim(),
      '',
      'The artifacts listed above are workspace-relative paths — open them rather',
      'than assuming what they say. If you produce a document, attach it:',
      `  wos-action run cases.attach --id "${caseId}" --path "<workspace-relative path>"`,
      WRITE_BACK(caseId),
    ].join('\n'),
  }
}

export function buildCaseTask(
  signal: NoteSignal,
  caseId: string,
  caseMarkdown: string,
): CaseAgentTask {
  const context = ['THE CASE — everything known so far:', '', caseMarkdown.trim(), ''].join('\n')

  if (signal.kind === 'research-person') {
    return {
      label: `Researching ${signal.value}`,
      prompt: [
        `Find out who ${signal.value} is, for the conversation this case is about.`,
        '',
        context,
        'What is worth knowing before meeting them:',
        '  - their role, and how it relates to the job in this case',
        '  - how long they have been there, and what they did before',
        '  - anything they have written or said publicly about the work',
        '  - anything genuinely in common with the applicant',
        '',
        'Use the browser to look them up. Search the company site and LinkedIn.',
        `Be careful about identity: "${signal.value}" is a common enough name that you may`,
        'find the wrong person. Prefer someone verifiably at the company in this case, and',
        'if you cannot confirm it is the right person, say so rather than guessing.',
        '',
        'Do not speculate about their character or their private life. Stick to what is',
        'professionally relevant and publicly stated.',
        WRITE_BACK(caseId),
      ].join('\n'),
    }
  }

  return {
    label: 'Preparing for the conversation',
    prompt: [
      'Prepare the applicant for the conversation this case is about.',
      '',
      context,
      'Read the CV and cover letter listed under artifacts — they are workspace-relative',
      'paths, and what was actually sent matters more than what could have been.',
      '',
      'Produce a short prep document (one page, no more) with:',
      '  - the three things this role most obviously needs, from the posting',
      '  - for each, the strongest evidence in the CV as it was actually written',
      '  - the two or three questions most likely to be difficult, and an honest answer',
      '    to each — including any gap between the posting and the real experience',
      '  - two questions worth asking them',
      '',
      'Write it into the workspace and attach it to the case:',
      `  wos-action run cases.attach --id "${caseId}" --path "<workspace-relative path>"`,
      '',
      'Do not invent experience the CV does not claim. If the fit is weak somewhere, say',
      'so plainly — being told the truth beforehand is the whole value of this.',
      WRITE_BACK(caseId),
    ].join('\n'),
  }
}
