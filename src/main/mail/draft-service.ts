import { buildOutgoing } from './send-service'
import type { OutgoingMessage, OutAddress, FullMessage } from './types'
import type { MailAddress } from './message-parser'

/**
 * Turns a source message into a SUGGESTED REPLY the user can approve/edit/send.
 *
 * Two cleanly separated jobs, both proven-by-reuse:
 *   (a) ENVELOPE — recipients, In-Reply-To / References threading and the `Re:`
 *       subject come from the existing, exhaustively-tested `buildOutgoing`
 *       (kind: 'reply' | 'reply-all'). This service NEVER re-implements threading.
 *   (b) BODY — a suggested reply body is produced by an INJECTED `draftFn`. In
 *       the app that's wired to the agent-invoke mechanism (the same `claude -p`
 *       pipeline the IWE agent uses); in tests it's a deterministic fake. The
 *       drafter receives message CONTENT only — never the account secret.
 *
 * HARD INVARIANT: drafting NEVER sends. It returns a DraftedReply; the SMTP send
 * happens only later, on explicit user approval, through the Phase-2 send path.
 */

/**
 * Produces a suggested reply body from the source's content + reply context.
 * Injected so unit tests use a fake (no real Claude call) and the app wires the
 * agent. Must be side-effect-free w.r.t. sending. May throw; callers guard it.
 */
export type DraftFn = (input: DraftFnInput) => Promise<string>

/** Everything the drafter is given — CONTENT ONLY, no credentials. */
export interface DraftFnInput {
  /** Who the reply is from (the account's display identity), for tone/sign-off. */
  self: OutAddress
  /** The message being replied to (subject/sender/body) — the drafting context. */
  source: {
    subject: string
    from: MailAddress[]
    to: MailAddress[]
    cc: MailAddress[]
    date: string | null
    text: string
  }
  /** True when this is a reply-all (the drafter may address multiple people). */
  replyAll: boolean
  /** Optional extra instruction from the user ("keep it short", "decline"). */
  instruction?: string
}

/** The result of drafting: a ready-to-review reply. Not yet sent. */
export interface DraftedReply {
  /** Fully-specified outgoing message (recipients + threading + Re: subject). */
  envelope: OutgoingMessage
  /** The agent-suggested reply body (the editable draft tier's initial text). */
  suggestedBody: string
  /** The RFC Message-ID of the source, for provenance / de-dup. */
  sourceMessageId: string | null
  /** True when this envelope widened recipients to reply-all. */
  replyAll: boolean
}

export interface DraftReplyOptions {
  /** reply-all widens Cc to the original To+Cc (minus self). Default false. */
  replyAll?: boolean
  /** Optional user steering passed through to the drafter. */
  instruction?: string
}

/**
 * Drafts a reply to `source` on behalf of `self`. Pure orchestration: it calls
 * the injected `draftFn` for the body and `buildOutgoing` for the envelope, then
 * returns both. It performs NO network I/O and — critically — DOES NOT SEND.
 */
export class DraftService {
  constructor(private readonly draftFn: DraftFn) {}

  async draftReply(
    self: OutAddress,
    source: FullMessage,
    opts: DraftReplyOptions = {},
  ): Promise<DraftedReply> {
    const replyAll = opts.replyAll === true

    // The suggested body first — the drafter sees content only.
    const suggestedBody = await this.draftFn({
      self,
      source: {
        subject: source.subject,
        from: source.from,
        to: source.to,
        cc: source.cc,
        date: source.date,
        text: source.text,
      },
      replyAll,
      instruction: opts.instruction,
    })

    // The envelope from the PROVEN builder — the reply body is the agent's text
    // (buildOutgoing appends the quoted original + sets subject/threading). The
    // primary recipient is the source's sender; reply-all widens Cc.
    const to: OutAddress[] = toReplyTo(source.from)
    const envelope = buildOutgoing(
      self,
      { to, subject: '', text: suggestedBody },
      { kind: 'reply', source, replyAll },
    )

    return {
      envelope,
      suggestedBody,
      sourceMessageId: source.messageId,
      replyAll,
    }
  }
}

/** Primary recipient(s) of a reply: the source's sender(s), as OutAddresses. */
function toReplyTo(from: MailAddress[]): OutAddress[] {
  return from
    .filter((a) => a.address)
    .map((a) => (a.name ? { name: a.name, address: a.address } : { address: a.address }))
}
