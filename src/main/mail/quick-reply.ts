/**
 * Quick replies — reply by STANCE rather than by picking a canned sentence.
 *
 * The usual "smart reply" offers three finished sentences and you pick the
 * least wrong one. That fails for real correspondence because the sentences
 * are generated from the incoming mail alone, with no idea what you actually
 * want to say.
 *
 * Here you supply the one thing only you know — yes, no, or not yet — and the
 * agent writes from that intent, in context, in your voice. The stance is the
 * input, not the output.
 *
 * Everything below is pure prompt construction. Sending stays behind the
 * existing draft gate: a quick reply produces a DRAFT, and `canArmSend` still
 * requires the human to open it before Send arms. Nothing here bypasses that,
 * and nothing here sends.
 */

export type Stance = 'positive' | 'neutral' | 'negative'

export interface StanceOption {
  id: Stance
  /** Button label. Deliberately about intent, not tone. */
  label: string
  /** What the user is committing to by choosing it — shown as a tooltip. */
  meaning: string
}

/**
 * The three stances.
 *
 * "Neutral" is not a weaker yes: it is the genuinely common case of
 * acknowledging without committing, which is what most business mail needs and
 * what a two-button yes/no forces people to fake.
 */
export const STANCES: StanceOption[] = [
  { id: 'positive', label: 'Yes', meaning: 'Agree, accept, or confirm you will do it' },
  { id: 'neutral', label: 'Acknowledge', meaning: 'Received and understood, without committing yet' },
  { id: 'negative', label: 'Decline', meaning: 'Say no, or that you cannot do it' },
]

const STANCE_INSTRUCTION: Record<Stance, string> = {
  positive:
    'The user AGREES / ACCEPTS / CONFIRMS. Write a reply that says yes clearly and without hedging. ' +
    'If the message asked for a commitment, confirm it plainly. Do not invent a date, a number, a price ' +
    'or any other specific the user did not give — if one is needed, say you will follow up with it.',
  neutral:
    'The user ACKNOWLEDGES but is NOT committing yet. Confirm receipt and understanding, and be honest ' +
    'that a decision or an answer will follow. Do not imply agreement. Do not invent a timeline the user ' +
    'did not give.',
  negative:
    'The user DECLINES. Write a polite, unambiguous no. Do not leave false hope or suggest it might ' +
    'change later unless the user said so. Do not invent a reason — if none was given, decline without ' +
    'explaining why.',
}

export interface QuickReplyInput {
  stance: Stance
  /** Subject of the message being replied to. */
  subject: string
  /** Sender display name, for addressing the reply. */
  fromName: string
  /** Plain-text body of the original, already truncated by the caller. */
  body: string
  /** The user's own name, for signing off. */
  selfName?: string
  /** Optional brand-kit voice guidance. */
  voice?: string
}

/** Hard cap on how much of the original we quote into the prompt. */
export const MAX_CONTEXT_CHARS = 4000

/**
 * Builds the drafting prompt.
 *
 * Two constraints appear in every stance because they are the failure modes
 * that make an AI reply worse than no reply: inventing specifics the user never
 * supplied, and writing at a length nobody asked for.
 */
export function buildQuickReplyPrompt(input: QuickReplyInput): string {
  const body = (input.body || '').slice(0, MAX_CONTEXT_CHARS)
  const lines = [
    'Write a short email reply on the user\'s behalf.',
    '',
    `STANCE: ${STANCE_INSTRUCTION[input.stance]}`,
    '',
    'RULES:',
    '- Two to four sentences. Nobody wants a longer reply than the message they sent.',
    '- Never invent facts, dates, numbers, prices or commitments the user did not supply.',
    '- Match the language of the original message.',
    '- Output ONLY the reply body. No subject line, no "Here is a draft", no quoted original.',
  ]
  if (input.selfName) lines.push(`- Sign off as ${input.selfName}.`)
  if (input.voice) lines.push(`- Voice: ${input.voice}`)
  lines.push(
    '',
    `The message being replied to, from ${input.fromName || 'the sender'}:`,
    `Subject: ${input.subject || '(no subject)'}`,
    '---',
    body,
    '---',
  )
  return lines.join('\n')
}

/** True when there is enough of an original to reply to meaningfully. */
export function canQuickReply(body: string, subject: string): boolean {
  return (body || '').trim().length > 0 || (subject || '').trim().length > 0
}
