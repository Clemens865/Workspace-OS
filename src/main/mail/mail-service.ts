import { MailAccountStore, type MailAccount, type MailAccountInput } from './account-store'
import { ImapClient, type ImapConnectConfig } from './imap-client'
import type {
  MailFolder,
  MessageSummary,
  FullMessage,
  ListMessagesOptions,
  MailResult,
  OutgoingMessage,
} from './types'
import { err, ok } from './types'
import { triageMessages, toTriageMessage, type NeedsReply } from './triage'
import type { MailRule } from './classify'
import type { TokenManager } from './token-manager'
import { DemoBackend } from './demo/demo-backend'
import { DEMO_DISPLAY_NAME, DEMO_USER } from './demo/demo-store'

/**
 * Orchestration layer + the IPC-facing mail API.
 *
 * Responsibilities:
 *  - Resolve an account id → live IMAP connect config by decrypting the secret
 *    through the account store ONLY at the moment of use (never cached, never
 *    logged, never returned to the renderer).
 *  - Provide a small, short-TTL in-memory cache for folder lists so repeat
 *    sidebar reads don't re-hit the server. Message lists are cached per folder
 *    page too. Everything here is best-effort and cheap to invalidate.
 *  - Return the account store's non-secret metadata for the settings UI.
 */

const FOLDER_TTL_MS = 60_000

interface CacheEntry<T> {
  value: T
  at: number
}

export class MailService {
  private folderCache = new Map<string, CacheEntry<MailFolder[]>>()
  /**
   * Per-demo-account in-memory backends. Kept keyed by account id so a demo send
   * (append to Sent + Inbox echo) survives across reads within a session. Created
   * lazily on first demo access; the real IMAP path never touches this map.
   */
  private demoBackends = new Map<string, DemoBackend>()

  constructor(
    private readonly accounts: MailAccountStore,
    private readonly imap: ImapClient = new ImapClient(),
    /** Optional — required only to resolve xoauth2 access tokens. */
    private readonly tokens?: TokenManager,
  ) {}

  // ── Account management (non-secret metadata crosses IPC) ──────────────────

  listAccounts(): Promise<MailAccount[]> {
    return this.accounts.list()
  }

  async addAccount(input: MailAccountInput, secret: string): Promise<MailAccount> {
    const account = await this.accounts.add(input, secret)
    return account
  }

  /**
   * Adds the built-in DEMO account (one click, no form, no secret). Idempotent —
   * if a demo account already exists it is returned instead of creating another.
   */
  async addDemoAccount(): Promise<MailAccount> {
    const existing = (await this.accounts.list()).find((a) => a.authKind === 'demo')
    if (existing) return existing
    return this.accounts.addDemo({ displayName: DEMO_DISPLAY_NAME, user: DEMO_USER })
  }

  async removeAccount(id: string): Promise<void> {
    this.folderCache.delete(id)
    this.demoBackends.delete(id)
    await this.accounts.remove(id)
  }

  /**
   * Returns the in-memory demo backend for a demo account (creating it once), or
   * null when the account is a normal (basic/xoauth2) account. This is the single
   * routing gate: any op that gets a non-null backend serves from the demo store
   * and NEVER resolves a config or hits `this.imap`.
   */
  private async demoBackend(accountId: string): Promise<DemoBackend | null> {
    const account = await this.accounts.get(accountId)
    if (!account || account.authKind !== 'demo') return null
    let backend = this.demoBackends.get(accountId)
    if (!backend) {
      backend = new DemoBackend()
      this.demoBackends.set(accountId, backend)
    }
    return backend
  }

  /**
   * Validates a set of ad-hoc credentials WITHOUT persisting them — the settings
   * "Test connection" button calls this before the user saves. The password is
   * passed straight through to a one-shot connect and discarded.
   */
  async testConnection(input: MailAccountInput, secret: string): Promise<MailResult<true>> {
    return this.imap.testConnection(toConnectConfig(input, secret))
  }

  // ── Read-only inbox ───────────────────────────────────────────────────────

  async listFolders(accountId: string): Promise<MailResult<MailFolder[]>> {
    const demo = await this.demoBackend(accountId)
    if (demo) return ok(demo.listFolders())
    const cached = this.folderCache.get(accountId)
    if (cached && Date.now() - cached.at < FOLDER_TTL_MS) {
      return { ok: true, value: cached.value }
    }
    const cfg = await this.resolveConfig(accountId)
    if (!cfg.ok) return cfg
    const res = await this.imap.listFolders(cfg.value)
    if (res.ok) this.folderCache.set(accountId, { value: res.value, at: Date.now() })
    return res
  }

  async listMessages(
    accountId: string,
    folder: string,
    opts: ListMessagesOptions = {},
  ): Promise<MailResult<MessageSummary[]>> {
    const demo = await this.demoBackend(accountId)
    if (demo) return ok(demo.listMessages(folder, opts))
    const cfg = await this.resolveConfig(accountId)
    if (!cfg.ok) return cfg
    return this.imap.listMessages(cfg.value, folder, opts)
  }

  async fetchMessage(
    accountId: string,
    folder: string,
    uid: number,
  ): Promise<MailResult<FullMessage>> {
    const demo = await this.demoBackend(accountId)
    if (demo) {
      const msg = demo.fetchMessage(folder, uid)
      return msg ? ok(msg) : err('not-found', 'The requested message was not found.')
    }
    const cfg = await this.resolveConfig(accountId)
    if (!cfg.ok) return cfg
    return this.imap.fetchMessage(cfg.value, folder, uid)
  }

  /**
   * Envelopes newer than a watermark — the incremental sync read. Falls back to
   * a normal page for the demo backend, which has no uid semantics worth
   * modelling.
   */
  async listMessagesSince(
    accountId: string,
    folder: string,
    sinceUid: number,
    limit = 200,
  ): Promise<MailResult<MessageSummary[]>> {
    const demo = await this.demoBackend(accountId)
    if (demo) return ok(demo.listMessages(folder, { limit }))
    const cfg = await this.resolveConfig(accountId)
    if (!cfg.ok) return cfg
    return this.imap.listMessagesSince(cfg.value, folder, sinceUid, limit)
  }

  /** Unread + total per folder, over one connection. */
  async folderCounts(
    accountId: string,
    folders: string[],
  ): Promise<MailResult<Record<string, { total: number; unseen: number }>>> {
    const demo = await this.demoBackend(accountId)
    if (demo) {
      const out: Record<string, { total: number; unseen: number }> = {}
      for (const f of folders) {
        const msgs = demo.listMessages(f, { limit: 500 })
        out[f] = { total: msgs.length, unseen: msgs.filter((m) => !m.seen).length }
      }
      return ok(out)
    }
    const cfg = await this.resolveConfig(accountId)
    if (!cfg.ok) return cfg
    return this.imap.folderCounts(cfg.value, folders)
  }

  /** Raw source for one message — used to materialise an attachment on demand. */
  async fetchSource(accountId: string, folder: string, uid: number): Promise<MailResult<Buffer>> {
    const cfg = await this.resolveConfig(accountId)
    if (!cfg.ok) return cfg
    return this.imap.fetchSource(cfg.value, folder, uid)
  }

  /** APPENDs raw MIME into a folder (used to save a draft server-side). */
  async appendMessage(
    accountId: string,
    folder: string,
    raw: Buffer,
    flags?: string[],
  ): Promise<MailResult<{ uid: number | null }>> {
    const cfg = await this.resolveConfig(accountId)
    if (!cfg.ok) return cfg
    return this.imap.appendMessage(cfg.value, folder, raw, flags)
  }

  async createFolder(accountId: string, folderPath: string): Promise<MailResult<true>> {
    const cfg = await this.resolveConfig(accountId)
    if (!cfg.ok) return cfg
    this.folderCache.delete(accountId)
    return this.imap.createFolder(cfg.value, folderPath)
  }

  async renameFolder(accountId: string, from: string, to: string): Promise<MailResult<true>> {
    const cfg = await this.resolveConfig(accountId)
    if (!cfg.ok) return cfg
    this.folderCache.delete(accountId)
    return this.imap.renameFolder(cfg.value, from, to)
  }

  async deleteFolder(accountId: string, folderPath: string): Promise<MailResult<true>> {
    const cfg = await this.resolveConfig(accountId)
    if (!cfg.ok) return cfg
    this.folderCache.delete(accountId)
    return this.imap.deleteFolder(cfg.value, folderPath)
  }

  // ── Mutating operations ───────────────────────────────────────────────────
  // Thin pass-throughs; the journalling and undo semantics live in
  // MailActions, which is the only thing that should call these.

  async moveMessage(
    accountId: string,
    folder: string,
    uid: number,
    toFolder: string,
  ): Promise<MailResult<true>> {
    const cfg = await this.resolveConfig(accountId)
    if (!cfg.ok) return cfg
    return this.imap.moveMessage(cfg.value, folder, uid, toFolder)
  }

  async setFlags(
    accountId: string,
    folder: string,
    uid: number,
    flags: string[],
    add: boolean,
  ): Promise<MailResult<true>> {
    const cfg = await this.resolveConfig(accountId)
    if (!cfg.ok) return cfg
    return this.imap.setFlags(cfg.value, folder, uid, flags, add)
  }

  async findByMessageId(
    accountId: string,
    folder: string,
    messageId: string,
  ): Promise<MailResult<number | null>> {
    const cfg = await this.resolveConfig(accountId)
    if (!cfg.ok) return cfg
    return this.imap.findByMessageId(cfg.value, folder, messageId)
  }

  /**
   * Fetches many messages over ONE connection — the indexer's path.
   *
   * Deepening a mailbox through `fetchMessage` would open a connection per
   * message; Outlook and Gmail throttle that hard, and the user's own clicks
   * then start failing while the indexer hogs the account.
   */
  async fetchMessages(
    accountId: string,
    folder: string,
    uids: number[],
  ): Promise<MailResult<FullMessage[]>> {
    const demo = await this.demoBackend(accountId)
    if (demo) {
      const out: FullMessage[] = []
      for (const uid of uids) {
        const m = demo.fetchMessage(folder, uid)
        if (m) out.push(m)
      }
      return ok(out)
    }
    const cfg = await this.resolveConfig(accountId)
    if (!cfg.ok) return cfg
    return this.imap.fetchMessages(cfg.value, folder, uids)
  }

  /**
   * Scans a folder and returns the messages that plausibly NEED A HUMAN REPLY,
   * ranked (see triage.ts). We list envelope summaries, keep only UNREAD ones
   * (already-read mail is assumed handled — the cheapest, strongest gate), then
   * fetch the full message for that bounded candidate set so triage can see the
   * sender, recipients and list/bulk headers. The classification itself is the
   * PURE triage module; this method is just the I/O around it.
   */
  async triageFolder(
    accountId: string,
    folder: string,
    opts: { limit?: number; maxCandidates?: number; rules?: MailRule[] } = {},
  ): Promise<MailResult<NeedsReply[]>> {
    const account = await this.accounts.get(accountId)
    if (!account) return err('not-found', 'Mail account not found.')

    const demo = await this.demoBackend(accountId)
    const maxCandidates = Math.max(1, Math.min(opts.maxCandidates ?? 25, 50))

    // Demo path: same PURE triage, fed from the in-memory store's full messages.
    if (demo) {
      const listed = demo.listMessages(folder, { limit: opts.limit ?? 50 })
      const candidates = listed.filter((m) => !m.seen).slice(0, maxCandidates)
      const triageable = []
      for (const summary of candidates) {
        const full = demo.fetchMessage(folder, summary.uid)
        if (full) triageable.push(toTriageMessage(full, folder))
      }
      return ok(triageMessages(triageable, account.user, opts.rules ?? []))
    }

    const cfg = await this.resolveConfig(accountId)
    if (!cfg.ok) return cfg

    const listed = await this.imap.listMessages(cfg.value, folder, { limit: opts.limit ?? 50 })
    if (!listed.ok) return listed

    // Cheapest gate first: only UNREAD messages can need a reply. Bound the
    // number we deep-fetch so a huge inbox can't fan out into many fetches.
    const candidates = listed.value.filter((m) => !m.seen).slice(0, maxCandidates)

    const triageable = []
    for (const summary of candidates) {
      const full = await this.imap.fetchMessage(cfg.value, folder, summary.uid)
      if (full.ok) triageable.push(toTriageMessage(full.value, folder))
    }
    return ok(triageMessages(triageable, account.user, opts.rules ?? []))
  }

  /**
   * Demo-only send: append a built OutgoingMessage to the demo mailbox's Sent
   * folder and echo a copy into the Inbox. In-memory, no SMTP, no network. Returns
   * the Sent record. Callers (the send handler) route here when the account is a
   * demo account; real accounts stay on the SMTP {@link SendService} path.
   */
  async demoSend(
    accountId: string,
    message: OutgoingMessage,
  ): Promise<MailResult<FullMessage>> {
    const demo = await this.demoBackend(accountId)
    if (!demo) return err('not-found', 'Not a demo account.')
    const { sent } = demo.send(message, { echoToInbox: true })
    return ok(sent)
  }

  /** Clears cached folder lists (e.g. after adding/removing an account). */
  invalidate(): void {
    this.folderCache.clear()
  }

  /**
   * Resolves a stored account + its decrypted secret into a live connect config.
   * The plaintext secret is created here, used immediately by the caller, and
   * never stored on `this` or returned across IPC.
   */
  private async resolveConfig(accountId: string): Promise<MailResult<ImapConnectConfig>> {
    const account = await this.accounts.get(accountId)
    if (!account) return err('not-found', 'Mail account not found.')

    // xoauth2: obtain a fresh access token (never a password) at the moment of use.
    if (account.authKind === 'xoauth2') {
      if (!this.tokens) return err('unavailable', 'Google sign-in is not available.')
      const tok = await this.tokens.getAccessToken(accountId)
      if (!tok.ok) return tok
      return ok({
        host: account.imap.host,
        port: account.imap.port,
        secure: account.imap.tls,
        auth: { user: account.user, accessToken: tok.value },
      })
    }

    let secret: string | null
    try {
      secret = await this.accounts.getSecret(accountId)
    } catch {
      return err('unavailable', 'Secure credential storage is unavailable on this system.')
    }
    if (!secret) return err('unavailable', 'No saved password for this account.')
    return ok({
      host: account.imap.host,
      port: account.imap.port,
      secure: account.imap.tls,
      auth: { user: account.user, pass: secret },
    })
  }
}

function toConnectConfig(input: MailAccountInput, secret: string): ImapConnectConfig {
  return {
    host: input.imap.host,
    port: input.imap.port,
    secure: input.imap.tls,
    auth: { user: input.user, pass: secret },
  }
}
