import { ImapFlow } from 'imapflow'
import { log } from '../crash-reporter'
import { parseMessage } from './message-parser'
import type { MailAddress } from './message-parser'
import type {
  MailFolder,
  MessageSummary,
  FullMessage,
  ListMessagesOptions,
  MailResult,
  MailErrorCode,
} from './types'
import { ok, err } from './types'

/**
 * Thin, typed wrapper over imapflow.
 *
 * Design rules:
 *  - Nothing throws raw into IPC: every public method returns a MailResult and
 *    connect errors are classified (bad creds / TLS / host / timeout) into a
 *    typed, SANITIZED MailError. The password is never placed in a log or error.
 *  - The ImapFlow constructor is injectable (`makeClient`) so unit tests drive a
 *    mock and assert we call the right imapflow methods with the right args —
 *    real servers are never hit in tests.
 *  - Connections are short-lived: connect → do work → logout. The service layer
 *    owns any caching; this wrapper stays stateless per call.
 */

/**
 * IMAP auth is EITHER an app-password (`pass`) OR an OAuth2 access token
 * (`accessToken`). Exactly one is set per account; xoauth2 accounts resolve a
 * fresh access token at the moment of connect and never carry a password.
 */
export interface ImapConnectConfig {
  host: string
  port: number
  secure: boolean // true = implicit TLS (993)
  auth: { user: string; pass?: string; accessToken?: string }
}

/** Factory type — production uses `new ImapFlow(opts)`; tests inject a fake. */
export type ImapClientFactory = (config: ImapConnectConfig) => ImapFlowLike

/** The subset of the ImapFlow surface we depend on (keeps the mock small). */
export interface ImapFlowLike {
  connect(): Promise<void>
  logout(): Promise<void>
  list(): Promise<RawFolder[]>
  getMailboxLock(path: string): Promise<{ release(): void }>
  fetch(range: string | object, query: object, options?: object): AsyncIterable<RawMessage>
  fetchOne(seq: string | number, query: object, options?: object): Promise<RawMessage | false>
  mailboxOpen(path: string): Promise<{ exists: number }>
  status(path: string, query: object): Promise<{ messages?: number; unseen?: number }>
  on(event: string, cb: (...args: unknown[]) => void): void
  // ── Mutating operations (added with the undo journal, never before it) ──
  messageMove(range: string | object, dest: string, options?: object): Promise<unknown>
  messageFlagsAdd(range: string | object, flags: string[], options?: object): Promise<boolean>
  messageFlagsRemove(range: string | object, flags: string[], options?: object): Promise<boolean>
  search(query: object, options?: object): Promise<number[] | false>
  append(path: string, content: Buffer | string, flags?: string[], date?: Date): Promise<unknown>
  mailboxCreate(path: string | string[]): Promise<unknown>
  mailboxRename(from: string, to: string): Promise<unknown>
  mailboxDelete(path: string): Promise<unknown>
}

interface RawFolder {
  path: string
  name: string
  specialUse?: string
  subscribed?: boolean
  flags?: Set<string>
  listed?: boolean
}

interface RawMessage {
  uid: number
  flags?: Set<string>
  envelope?: {
    subject?: string
    from?: { name?: string; address?: string }[]
    to?: { name?: string; address?: string }[]
    date?: Date
  }
  bodyStructure?: RawBodyNode
  source?: Buffer
}

interface RawBodyNode {
  type?: string
  disposition?: string
  childNodes?: RawBodyNode[]
}

const defaultFactory: ImapClientFactory = (config) =>
  new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // imapflow uses XOAUTH2 automatically when `accessToken` is present instead
    // of `pass`. We forward exactly one of them (set by the resolver upstream).
    auth: config.auth.accessToken
      ? { user: config.auth.user, accessToken: config.auth.accessToken }
      : { user: config.auth.user, pass: config.auth.pass ?? '' },
    // Silence imapflow's own logger entirely — its debug stream echoes the
    // full IMAP conversation (incl. the LOGIN command) and must never surface.
    logger: false,
    // Bound the handshake so an unreachable host fails fast into a typed error.
    socketTimeout: 30_000,
  }) as unknown as ImapFlowLike

export class ImapClient {
  constructor(private readonly makeClient: ImapClientFactory = defaultFactory) {}

  /** Runs `fn` against a freshly connected client, guaranteeing logout. */
  private async withClient<T>(
    config: ImapConnectConfig,
    fn: (client: ImapFlowLike) => Promise<T>,
  ): Promise<MailResult<T>> {
    let client: ImapFlowLike
    try {
      client = this.makeClient(config)
    } catch (e) {
      return err('unknown', sanitize(e))
    }
    // Swallow the 'error' event so a mid-session socket error can't crash main.
    try {
      client.on('error', () => {})
    } catch {
      /* mock without .on — ignore */
    }
    try {
      await client.connect()
    } catch (e) {
      return err(classify(e), sanitize(e))
    }
    try {
      const value = await fn(client)
      return ok(value)
    } catch (e) {
      // The user-facing message is deliberately generic so a password can never
      // ride out in an error string. That also makes failures undiagnosable, so
      // the REAL reason goes to the main log instead — bounded, and never the
      // credentials, which live in `config.auth` and are not touched here.
      logImapFailure(e)
      return err(classify(e), sanitize(e))
    } finally {
      try {
        await client.logout()
      } catch {
        /* best-effort teardown */
      }
    }
  }

  /** Connect + immediately log out — the settings "Test connection" probe. */
  async testConnection(config: ImapConnectConfig): Promise<MailResult<true>> {
    return this.withClient(config, async () => true)
  }

  async listFolders(config: ImapConnectConfig): Promise<MailResult<MailFolder[]>> {
    return this.withClient(config, async (client) => {
      const raw = await client.list()
      return raw.map((f) => ({
        path: f.path,
        name: f.name,
        specialUse: f.specialUse,
        subscribed: f.subscribed ?? false,
        selectable: !(f.flags && f.flags.has('\\Noselect')),
      }))
    })
  }

  /**
   * Unread + total counts for folders, without opening any of them.
   *
   * IMAP STATUS is designed for exactly this and is far cheaper than selecting
   * each mailbox: no mailbox lock, no envelope transfer. One connection covers
   * every folder, because opening a connection per folder is the mistake that
   * throttled Outlook when the indexer did it per message.
   *
   * A folder that fails to report is omitted rather than reported as zero —
   * a wrong count is worse than no badge.
   */
  async folderCounts(
    config: ImapConnectConfig,
    folders: string[],
  ): Promise<MailResult<Record<string, { total: number; unseen: number }>>> {
    return this.withClient(config, async (client) => {
      const out: Record<string, { total: number; unseen: number }> = {}
      for (const folder of folders) {
        try {
          const st = await client.status(folder, { messages: true, unseen: true })
          out[folder] = { total: st?.messages ?? 0, unseen: st?.unseen ?? 0 }
        } catch {
          /* omit — no badge beats a wrong badge */
        }
      }
      return out
    })
  }

  /**
   * Lists envelope summaries for a folder, newest first, paged by uid.
   * Fetches envelope + flags + bodyStructure only — never the full body.
   */
  async listMessages(
    config: ImapConnectConfig,
    folder: string,
    opts: ListMessagesOptions = {},
  ): Promise<MailResult<MessageSummary[]>> {
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 200))
    return this.withClient(config, async (client) => {
      const lock = await client.getMailboxLock(folder)
      try {
        // Ask for ONE PAGE, by sequence number.
        //
        // This used to fetch `uid 1:*` — every envelope in the folder — sort the
        // lot, and return the newest 30. On a 400-message mailbox that is 400
        // envelopes transferred to display 30, on every single list call, which
        // is precisely the "it loads all mail every time" symptom.
        //
        // Sequence numbers are ordered oldest→newest and contiguous (unlike
        // uids, which have gaps wherever a message was deleted), so the newest
        // page is simply the last `limit` sequence numbers. `offset` pages
        // backwards from the top.
        const box = await client.mailboxOpen(folder)
        const exists = box?.exists ?? 0
        if (exists === 0) return []

        const offset = Math.max(0, opts.offset ?? 0)
        const top = exists - offset
        if (top < 1) return []
        const from = Math.max(1, top - limit + 1)

        const summaries: MessageSummary[] = []
        for await (const msg of client.fetch(
          `${from}:${top}`,
          { uid: true, flags: true, envelope: true, bodyStructure: true },
        )) {
          summaries.push(toSummary(msg))
        }
        summaries.sort((a, b) => b.uid - a.uid)
        return summaries
      } finally {
        lock.release()
      }
    })
  }

  /**
   * Envelopes for uids ABOVE a watermark — the incremental-sync read.
   *
   * `highestUid` has existed on the index since it was written and nothing ever
   * called it, so every sync re-listed the folder from the top. This is the
   * call that makes a resync fetch only what has arrived since.
   */
  async listMessagesSince(
    config: ImapConnectConfig,
    folder: string,
    sinceUid: number,
    limit = 200,
  ): Promise<MailResult<MessageSummary[]>> {
    return this.withClient(config, async (client) => {
      const lock = await client.getMailboxLock(folder)
      try {
        const summaries: MessageSummary[] = []
        for await (const msg of client.fetch(
          { uid: `${sinceUid + 1}:*` },
          { uid: true, flags: true, envelope: true, bodyStructure: true },
          { uid: true },
        )) {
          summaries.push(toSummary(msg))
        }
        summaries.sort((a, b) => b.uid - a.uid)
        return summaries.slice(0, limit)
      } finally {
        lock.release()
      }
    })
  }

  /** Fetches + parses one full message by uid. */
  async fetchMessage(
    config: ImapConnectConfig,
    folder: string,
    uid: number,
  ): Promise<MailResult<FullMessage>> {
    return this.withClient(config, async (client) => {
      const lock = await client.getMailboxLock(folder)
      try {
        const msg = await client.fetchOne(
          String(uid),
          { uid: true, flags: true, source: true },
          { uid: true },
        )
        if (!msg || !msg.source) throw new NotFound('Message not found')
        return toFullMessage(msg, uid, await parseMessage(msg.source))
      } finally {
        lock.release()
      }
    })
  }

  // ── Mutating operations ───────────────────────────────────────────────────
  //
  // These exist only because the undo journal (mail-journal.ts) exists first.
  // Every one of them is reversible by construction:
  //   move  → move back
  //   flag  → unflag
  // There is deliberately NO delete and NO expunge. Deleting is a move to the
  // Trash folder, which the server keeps and which undo can retrieve. Nothing
  // here can destroy a message.

  /**
   * Moves a message to another folder. Used for Archive, for filing, and for
   * "delete" (a move to Trash).
   *
   * The destination assigns a NEW uid, and not every server reports it
   * (UIDPLUS), so callers must not rely on a returned uid — the journal keys on
   * the Message-ID for exactly this reason.
   */
  async moveMessage(
    config: ImapConnectConfig,
    folder: string,
    uid: number,
    toFolder: string,
  ): Promise<MailResult<true>> {
    return this.withClient(config, async (client) => {
      const lock = await client.getMailboxLock(folder)
      try {
        await client.messageMove(String(uid), toFolder, { uid: true })
        return true as const
      } finally {
        lock.release()
      }
    })
  }

  /** Adds or removes IMAP flags (\\Seen, \\Flagged) on one message. */
  async setFlags(
    config: ImapConnectConfig,
    folder: string,
    uid: number,
    flags: string[],
    add: boolean,
  ): Promise<MailResult<true>> {
    return this.withClient(config, async (client) => {
      const lock = await client.getMailboxLock(folder)
      try {
        if (add) await client.messageFlagsAdd(String(uid), flags, { uid: true })
        else await client.messageFlagsRemove(String(uid), flags, { uid: true })
        return true as const
      } finally {
        lock.release()
      }
    })
  }

  /**
   * Resolves a Message-ID to its uid in a folder — how an undo finds a message
   * that has moved and been re-numbered.
   *
   * Returns null when absent rather than throwing: a message that is no longer
   * where we expect it is a normal outcome (the user may have moved it in
   * another client), and the caller should report that plainly instead of
   * treating it as a failure.
   */
  async findByMessageId(
    config: ImapConnectConfig,
    folder: string,
    messageId: string,
  ): Promise<MailResult<number | null>> {
    return this.withClient(config, async (client) => {
      const lock = await client.getMailboxLock(folder)
      try {
        const found = await client.search({ header: { 'message-id': messageId } }, { uid: true })
        if (!found || found.length === 0) return null
        // Newest match wins if a server somehow reports duplicates.
        return Math.max(...found)
      } finally {
        lock.release()
      }
    })
  }

  /**
   * APPENDs a message into a folder — how a draft reaches the server.
   *
   * Flagged \\Draft so other clients (and the server's own UI) recognise it as
   * one rather than as a stray message sitting in a folder.
   */
  async appendMessage(
    config: ImapConnectConfig,
    folder: string,
    raw: Buffer,
    flags: string[] = ['\\Draft'],
  ): Promise<MailResult<{ uid: number | null }>> {
    return this.withClient(config, async (client) => {
      const res = (await client.append(folder, raw, flags)) as { uid?: number } | undefined
      // UIDPLUS reports the new uid; plenty of servers do not. null is an
      // honest "unknown" — the caller then simply cannot supersede this copy
      // later, which beats guessing a uid and moving the wrong message.
      return { uid: typeof res?.uid === 'number' ? res.uid : null }
    })
  }

  /**
   * Folder management.
   *
   * Creating and renaming are safe. DELETING a folder is the one operation in
   * this codebase that can destroy mail — an IMAP DELETE takes the messages
   * with it and there is no Trash for a mailbox. So it is exposed, because a
   * mail client without it is incomplete, but the caller is expected to have
   * asked the user explicitly, and the handler refuses a folder that still has
   * messages in it.
   */
  async createFolder(config: ImapConnectConfig, path: string): Promise<MailResult<true>> {
    return this.withClient(config, async (client) => {
      await client.mailboxCreate(path)
      return true as const
    })
  }

  async renameFolder(config: ImapConnectConfig, from: string, to: string): Promise<MailResult<true>> {
    return this.withClient(config, async (client) => {
      await client.mailboxRename(from, to)
      return true as const
    })
  }

  async deleteFolder(config: ImapConnectConfig, path: string): Promise<MailResult<true>> {
    return this.withClient(config, async (client) => {
      await client.mailboxDelete(path)
      return true as const
    })
  }

  /** Raw RFC822 source for one message — the input to attachment extraction. */
  async fetchSource(
    config: ImapConnectConfig,
    folder: string,
    uid: number,
  ): Promise<MailResult<Buffer>> {
    return this.withClient(config, async (client) => {
      const lock = await client.getMailboxLock(folder)
      try {
        const msg = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true })
        if (!msg || !msg.source) throw new NotFound('Message not found')
        return msg.source
      } finally {
        lock.release()
      }
    })
  }

  /**
   * Fetches MANY messages over ONE connection.
   *
   * `fetchMessage` opens a fresh connection per call — fine for a single click,
   * ruinous for indexing: deepening a 400-message mailbox that way is 400
   * connect/authenticate/logout cycles, which is slow everywhere and gets
   * throttled hard by Outlook and Gmail. This does one connect, one mailbox
   * lock, and streams the set.
   *
   * Returns only what the server actually produced. A uid missing from the
   * result is reported as missing rather than faked, so callers can leave it
   * for a later pass instead of recording an empty message.
   */
  async fetchMessages(
    config: ImapConnectConfig,
    folder: string,
    uids: number[],
  ): Promise<MailResult<FullMessage[]>> {
    if (uids.length === 0) return ok([])
    return this.withClient(config, async (client) => {
      const lock = await client.getMailboxLock(folder)
      try {
        const out: FullMessage[] = []
        for await (const msg of client.fetch(
          { uid: uids.join(',') },
          { uid: true, flags: true, source: true },
          { uid: true },
        )) {
          if (!msg?.source) continue
          out.push(toFullMessage(msg, msg.uid, await parseMessage(msg.source)))
        }
        return out
      } finally {
        lock.release()
      }
    })
  }
}

/** Builds the FullMessage wire shape from a raw fetch + its parsed body. */
function toFullMessage(
  msg: RawMessage,
  fallbackUid: number,
  parsed: Awaited<ReturnType<typeof parseMessage>>,
): FullMessage {
  const flags = msg.flags ? [...msg.flags] : []
  return {
    uid: msg.uid ?? fallbackUid,
    subject: parsed.subject,
    from: parsed.from,
    to: parsed.to,
    cc: parsed.cc,
    date: parsed.date,
    messageId: parsed.messageId,
    text: parsed.text,
    html: parsed.html,
    hasBlockedRemoteContent: parsed.hasBlockedRemoteContent,
    attachments: parsed.attachments,
    flags,
    seen: flags.includes('\\Seen'),
    headers: parsed.headers,
  }
}

/**
 * Logs the real IMAP failure to the main log — never to the UI, and never with
 * anything from `config.auth`. Bounded so a chatty server cannot flood the log.
 *
 * This exists because `sanitize()` maps every failure to one of five fixed
 * sentences. That is correct for the user (a server can echo the attempted
 * LOGIN back in an error) and useless for debugging: "not found" could be a
 * missing folder, a throttled connection, or a uid the server refused.
 */
function logImapFailure(e: unknown): void {
  const raw = (e as { code?: string; responseText?: string; message?: string }) || {}
  const detail = `${raw.code ?? ''} ${raw.responseText ?? ''} ${raw.message ?? ''}`
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
  log('warn', `[imap] ${classify(e)} — ${detail || 'no detail'}`)
}

class NotFound extends Error {}

function toAddr(list: { name?: string; address?: string }[] | undefined): MailAddress[] {
  if (!list) return []
  return list.filter((a) => a.address).map((a) => ({ name: a.name || '', address: a.address! }))
}

function toSummary(msg: RawMessage): MessageSummary {
  const flags = msg.flags ? [...msg.flags] : []
  const env = msg.envelope ?? {}
  return {
    uid: msg.uid,
    subject: env.subject ?? '',
    from: toAddr(env.from),
    to: toAddr(env.to),
    date: env.date ? new Date(env.date).toISOString() : null,
    flags,
    seen: flags.includes('\\Seen'),
    hasAttachments: hasAttachments(msg.bodyStructure),
    snippet: '',
  }
}

/** Walks the BODYSTRUCTURE for any attachment disposition. */
function hasAttachments(node: RawBodyNode | undefined): boolean {
  if (!node) return false
  if (node.disposition === 'attachment') return true
  return (node.childNodes ?? []).some(hasAttachments)
}

/** Maps a thrown error to a typed code WITHOUT leaking the message verbatim. */
function classify(e: unknown): MailErrorCode {
  if (e instanceof NotFound) return 'not-found'
  const raw = (e as { code?: string; responseText?: string; message?: string }) || {}
  const text = `${raw.code ?? ''} ${raw.responseText ?? ''} ${raw.message ?? ''}`.toLowerCase()
  if (/auth|login|credential|password|invalid|denied/.test(text)) return 'auth'
  if (/cert|tls|ssl|self[- ]?signed/.test(text)) return 'tls'
  if (/enotfound|eai_again|ehostunreach|econnrefused|dns/.test(text)) return 'host'
  if (/timeout|etimedout/.test(text)) return 'timeout'
  return 'unknown'
}

/**
 * Produces a safe, generic human message. We deliberately do NOT echo the raw
 * error text (which some IMAP servers pad with the attempted login) — we map to
 * a fixed sentence per class so a password can never ride out in an error.
 */
function sanitize(e: unknown): string {
  switch (classify(e)) {
    case 'auth':
      return 'Authentication failed — the server rejected these credentials. Gmail / Yahoo / iCloud need an app-specific password; Outlook / Hotmail now require “Sign in with Microsoft” (Microsoft disabled password sign-in in 2024).'
    case 'tls':
      return 'Secure connection failed — the server’s TLS certificate could not be verified.'
    case 'host':
      return 'Could not reach the mail server — check the host and port.'
    case 'timeout':
      return 'The connection timed out.'
    case 'not-found':
      return 'The requested folder or message was not found.'
    default:
      return 'The mail server returned an unexpected error.'
  }
}
