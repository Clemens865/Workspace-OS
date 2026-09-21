import type { MailResult, MessageSummary, FullMessage } from './types'
import { isListMail, isMachineSent, hasUnsubscribeLink } from './classify'
import type { MailIndex, EnvelopeRow, IndexedMessage } from './mail-index'

/**
 * Drives IMAP → the local index, in two tiers.
 *
 * Tier 1 (`syncEnvelopes`) writes what `listMessages` already returns — subject,
 * sender, date, flags, snippet. One round-trip, no per-message fetch, so the
 * list paints immediately.
 *
 * Tier 2 (`deepenBatch`) fetches full messages for rows still marked shallow,
 * filling in the body (full-text search) and the threading headers. It is
 * bounded and resumable: it takes a batch, reports what it did, and can be
 * called again until `pendingDeepCount` reaches zero.
 *
 * The I/O lives here; the decisions live in `mail-index.ts` and `threading.ts`,
 * both of which are pure or storage-only. Dependencies are injected so this
 * whole module is unit-testable without a mailbox.
 */

/** The two IMAP reads sync needs, injected so tests can supply fakes. */
export interface SyncDeps {
  listMessages(
    accountId: string,
    folder: string,
    opts: { limit?: number; beforeUid?: number; offset?: number },
  ): Promise<MailResult<MessageSummary[]>>
  /** Envelopes above a uid watermark — used for every sync after the first. */
  listMessagesSince?(
    accountId: string,
    folder: string,
    sinceUid: number,
    limit?: number,
  ): Promise<MailResult<MessageSummary[]>>
  fetchMessage(accountId: string, folder: string, uid: number): Promise<MailResult<FullMessage>>
  /**
   * Optional batch read over a single connection. When present, deepening uses
   * it — one connect per BATCH instead of one per message. Optional so existing
   * callers and tests keep working with the single-message path.
   */
  fetchMessages?(
    accountId: string,
    folder: string,
    uids: number[],
  ): Promise<MailResult<FullMessage[]>>
}

export interface EnvelopeSyncReport {
  indexed: number
  pruned: number
  /** Set when the IMAP read failed; the index is left untouched. */
  error: string | null
}

export interface DeepSyncReport {
  deepened: number
  failed: number
  /** Rows still awaiting a full fetch after this batch. */
  remaining: number
}

/** Joins addresses into the flat string the index stores for recipient search. */
function joinAddresses(list: { name?: string; address: string }[]): string {
  return list.map((a) => a.address).filter(Boolean).join(', ')
}

/** Parses an IMAP date string to epoch ms, or null when it is absent/unparseable. */
export function toEpoch(date: string | null): number | null {
  if (!date) return null
  const t = Date.parse(date)
  return Number.isFinite(t) ? t : null
}

/** Maps an IMAP envelope summary to the index's envelope row. */
export function toEnvelopeRow(
  accountId: string,
  folder: string,
  m: MessageSummary,
): EnvelopeRow {
  const first = m.from[0]
  return {
    accountId,
    folder,
    uid: m.uid,
    subject: m.subject ?? '',
    fromName: first?.name ?? '',
    fromAddress: first?.address ?? '',
    toAddresses: joinAddresses(m.to ?? []),
    date: toEpoch(m.date),
    seen: m.seen,
    hasAttachments: m.hasAttachments,
    snippet: m.snippet ?? '',
  }
}

/** Maps a fully-fetched message to the index's full row. */
export function toIndexedMessage(
  accountId: string,
  folder: string,
  m: FullMessage,
): IndexedMessage {
  const first = m.from[0]
  return {
    accountId,
    folder,
    uid: m.uid,
    messageId: m.messageId,
    inReplyTo: m.headers?.['in-reply-to'] ?? null,
    references: parseReferences(m.headers?.references),
    subject: m.subject ?? '',
    fromName: first?.name ?? '',
    fromAddress: first?.address ?? '',
    toAddresses: joinAddresses([...(m.to ?? []), ...(m.cc ?? [])]),
    date: toEpoch(m.date),
    seen: m.seen,
    hasAttachments: (m.attachments?.length ?? 0) > 0,
    snippet: (m.text || '').slice(0, 200).replace(/\s+/g, ' ').trim(),
    text: m.text || '',
    /*
     * Recorded here because this is the only place the whole message exists.
     * The body is thrown away after indexing, so an unsubscribe link that is
     * only in the HTML can never be found again from the index — deciding
     * later would mean re-fetching the mailbox over the network.
     */
    signals: {
      list: isListMail(m.headers),
      unsubscribe: hasUnsubscribeLink({ subject: m.subject ?? '', from: m.from, text: m.text, html: m.html }),
      machine: isMachineSent({ subject: m.subject ?? '', from: m.from, headers: m.headers }),
    },
  }
}

/** Splits a References header into its Message-IDs. */
export function parseReferences(raw: string | undefined): string[] {
  if (!raw) return []
  const ids = raw.match(/<[^>]+>/g)
  return ids ?? []
}

/**
 * TIER 1 — refresh a folder's envelopes into the index.
 *
 * `prune` defaults to FALSE and that default is load-bearing. `pruneFolder`
 * deletes every indexed row whose uid is absent from the list it is given, so
 * calling it with a single PAGE of results would wipe the rest of the folder
 * from the cache. Only pass `prune: true` when `messages` is the complete uid
 * set for the folder — i.e. an unpaged listing that came back short of `limit`.
 * This function enforces that rather than trusting the caller.
 */
export async function syncEnvelopes(
  index: MailIndex,
  deps: SyncDeps,
  accountId: string,
  folder: string,
  opts: { limit?: number; prune?: boolean } = {},
): Promise<EnvelopeSyncReport> {
  const limit = opts.limit ?? 200

  // INCREMENTAL: after the first sync, ask only for what arrived since the
  // highest uid we already hold. The watermark has been available on the index
  // since it was written and nothing called it, so every sync re-listed the
  // folder from the top — the "it reloads everything" symptom.
  //
  // A full listing is still needed when pruning, because pruning decides what
  // to DELETE from the cache and an incremental read cannot see absences.
  const watermark = index.highestUid(accountId, folder)
  const incremental = watermark > 0 && !opts.prune && Boolean(deps.listMessagesSince)

  const res = incremental
    ? await deps.listMessagesSince!(accountId, folder, watermark, limit)
    : await deps.listMessages(accountId, folder, { limit })
  if (!res.ok) return { indexed: 0, pruned: 0, error: res.error.message }

  const messages = res.value
  index.upsertEnvelopes(messages.map((m) => toEnvelopeRow(accountId, folder, m)))

  // A full page means there is probably more behind it, so the uid set is
  // incomplete and pruning would delete live mail from the cache.
  const complete = messages.length < limit
  let pruned = 0
  if (opts.prune && complete && !incremental) {
    pruned = index.pruneFolder(accountId, folder, messages.map((m) => m.uid))
  }

  return { indexed: messages.length, pruned, error: null }
}

/**
 * TIER 2 — fetch full messages for rows still marked shallow.
 *
 * Bounded and resumable. A single message failing does not abort the batch:
 * one unreadable mail must not stop the rest of the mailbox from indexing, and
 * the row simply stays shallow for the next pass to retry.
 */
export async function deepenBatch(
  index: MailIndex,
  deps: SyncDeps,
  accountId: string,
  opts: { limit?: number } = {},
): Promise<DeepSyncReport> {
  const pending = index.needsDeepFetch(accountId, opts.limit ?? 25)
  let deepened = 0
  let failed = 0

  // Group by folder: one mailbox lock and one connection per folder, not per
  // message. Falls back to the single-message path when no batch reader exists.
  const byFolder = new Map<string, number[]>()
  for (const { folder, uid } of pending) {
    const list = byFolder.get(folder) ?? []
    list.push(uid)
    byFolder.set(folder, list)
  }

  for (const [folder, uids] of byFolder) {
    if (deps.fetchMessages) {
      const res = await deps.fetchMessages(accountId, folder, uids)
      if (!res.ok) {
        failed += uids.length
        continue
      }
      if (res.value.length > 0) {
        index.upsertMany(res.value.map((m) => toIndexedMessage(accountId, folder, m)))
      }
      deepened += res.value.length
      // A uid the server did not return stays shallow for a later pass rather
      // than being recorded as an empty message.
      failed += uids.length - res.value.length
      continue
    }

    for (const uid of uids) {
      const res = await deps.fetchMessage(accountId, folder, uid)
      if (!res.ok) {
        failed++
        continue
      }
      index.upsertMany([toIndexedMessage(accountId, folder, res.value)])
      deepened++
    }
  }

  return { deepened, failed, remaining: index.pendingDeepCount(accountId) }
}
