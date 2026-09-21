import { IpcMain, dialog, shell, app, BrowserWindow } from 'electron'
import { IPC } from '../ipc-channels'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError } from '../ipc-validator'
import { MailRuleStore } from '../mail/rule-store'
import { classify, classifyFrom } from '../mail/classify'
import { siftItems, type SiftItem } from '../mail/sift'
import { runProviderOneShot } from '../agent/providerText'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { MailIndex } from '../mail/mail-index'
import { syncEnvelopes, deepenBatch } from '../mail/mail-sync'
import { MailJournal, describeAction } from '../mail/mail-journal'
import { MailActions } from '../mail/mail-actions'
import { extractAttachment } from '../mail/message-parser'
import { loadRemoteImages, netImageFetch, LIMITS as IMG_LIMITS } from '../mail/remote-images'
import { getWorkspaceRoot } from '../workspace-root'
import { extractSheets } from '../mail/rich-email/sheet-extract'
import { buildFromFilePrompt, parseBlocksReply, INTENTS, type FromFileIntent } from '../mail/rich-email/from-file-prompt'
import { runEmailPrompt } from '../mail/rich-email/email-agent-drafter'
import { toBlock } from '../mail/rich-email/coerce-blocks'
import { resolveSavePath, uniqueName, safeFilename } from '../mail/attachments'
import { readSignatures, saveSignature } from '../mail/signature'
import { log } from '../crash-reporter'
import { buildDraftMime, findDraftsFolder } from '../mail/draft-mime'
import { SendQueue } from '../mail/send-queue'
import { buildQuickReplyPrompt, type Stance } from '../mail/quick-reply'
import { buildFilingPlan, type FilingWindow, type FilingPlan } from '../mail/filing-plan'
import { buildNewsletterSweep, NEWSLETTER_FOLDER } from '../mail/newsletter-sweep'
import {
  initialState, onConnecting, onConnected, onFailure, onStop,
  shouldRetry, newUidsSince, type WatcherState,
} from '../mail/idle-watcher'
import { userDataDir } from '../userdata-path'
import { MailAccountStore, type MailAccountInput } from '../mail/account-store'
import { safeSecretStore } from '../mail/safe-secret-store'
import { MailService } from '../mail/mail-service'
import { SendService, buildOutgoing, type DraftInput, type ComposeContext } from '../mail/send-service'
import { DraftService } from '../mail/draft-service'
import { makeAgentDraftFn } from '../mail/mail-drafter'
import { draftRichEmail, type EmailDraftFn } from '../mail/rich-email/email-drafter'
import { makeEmailAgentDraftFn } from '../mail/rich-email/email-agent-drafter'
import { buildRichEmail, metricInsertBlock, rangeInsertBlock } from '../mail/rich-email/compose-build'
import { toBuildInput } from '../mail/rich-email/coerce-blocks'
import { runAssist, makeAssistFn, type AssistFn, type AssistAction } from '../mail/rich-email/assist-drafter'
import { metrics } from '../metrics'
import { ranges } from '../ranges'
import { brandStore } from '../brand'
import type { BrandBriefSource } from '../mail/rich-email/brand-brief'
import type { BrandThemeSource } from '../mail/rich-email/themes'
import type { OutAddress, OutAttachment, FullMessage } from '../mail/types'
import { TokenManager } from '../mail/token-manager'
import {
  resolveGoogleClientId,
  isGoogleOAuthConfigured,
  resolveMicrosoftClientId,
  isMicrosoftOAuthConfigured,
  saveClientId,
  looksLikeClientId,
  type OAuthProvider,
} from '../mail/oauth/client-config'
import { runGoogleOAuthFlow, runMicrosoftOAuthFlow } from '../mail/oauth/oauth-flow'
import type { FetchFn } from '../mail/oauth/google-oauth'
import { resolveAutoconfig, type AutoconfigFetch } from '../mail/autoconfig'

/**
 * IPC surface for the native mail client (Phase 1: read-only inbox).
 *
 * SECURITY at the boundary:
 *  - The password crosses IPC exactly once, on add/test, from a secure password
 *    field. It is handed straight to the account store (safeStorage-encrypted)
 *    or a one-shot connect and is NEVER echoed back, cached in the renderer, or
 *    logged. This handler must never console.log an input payload.
 *  - Every renderer-supplied value is validated/coerced here before it reaches
 *    the service. Bad input yields a typed error result, not a thrown raw error.
 */

let service: MailService | null = null
let sender: SendService | null = null
let drafter: DraftService | null = null
let sharedStore: MailAccountStore | null = null
let tokens: TokenManager | null = null

function ensureStore(): MailAccountStore {
  if (!sharedStore) sharedStore = new MailAccountStore(userDataDir(), safeSecretStore)
  return sharedStore
}

/**
 * Adapts the runtime global `fetch` to the narrow FetchFn the OAuth token logic
 * expects. Kept here (not in the pure module) so google-oauth.ts stays testable
 * with an injected fake and never depends on a global.
 */
const nodeFetch: FetchFn = (url, init) =>
  fetch(url, { method: init.method, headers: init.headers, body: init.body })

/**
 * GET-only fetch adapter for autoconfig (public ISPDB XML). Bounded by an
 * AbortController so a slow lookup can never wedge the dialog. Never carries a
 * secret — it requests a public document only.
 */
const autoconfigFetch: AutoconfigFetch = async (url) => {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal })
    return { ok: res.ok, status: res.status, text: () => res.text() }
  } finally {
    clearTimeout(timer)
  }
}

/** The mail account store, for the Connectors page (list + remove; never a secret). */
export function mailAccountStore(): MailAccountStore {
  return ensureStore()
}

/**
 * Can this OAuth mail account still get an access token? For the Connectors
 * page. `unconfigured` when the provider has no client id in this build;
 * `skip` for accounts that have nothing to refresh.
 */
export async function probeMailAccount(accountId: string): Promise<'ok' | 'fail' | 'unconfigured' | 'skip'> {
  const account = await ensureStore().get(accountId)
  if (!account || account.authKind !== 'xoauth2') return 'skip'
  const clientId = account.authProvider === 'microsoft' ? resolveMicrosoftClientId(userDataDir()) : resolveGoogleClientId(userDataDir())
  if (!clientId) return 'unconfigured'
  const res = await ensureTokens().getAccessToken(accountId)
  return res.ok ? 'ok' : 'fail'
}

/** Shared TokenManager: caches xoauth2 access tokens; resolves the client id lazily. */
function ensureTokens(): TokenManager {
  if (!tokens) {
    tokens = new TokenManager(ensureStore(), {
      fetchFn: nodeFetch,
      getClientId: () => resolveGoogleClientId(userDataDir()),
      getMicrosoftClientId: () => resolveMicrosoftClientId(userDataDir()),
    })
  }
  return tokens
}

/**
 * The local mail index lives in userData beside search-index.db — NOT in the
 * workspace, which is copyable and shareable. Same reasoning that split personal
 * memory from workspace memory.
 */
let mailIndex: MailIndex | null = null
function ensureIndex(): MailIndex {
  if (!mailIndex) mailIndex = new MailIndex(path.join(userDataDir(), 'mail-index.db'))
  return mailIndex
}

/**
 * The undo journal and the mutating-action layer.
 *
 * Both live in userData beside the index — a mailbox's action history is
 * personal, and must not ride along in a workspace folder that gets copied or
 * shared.
 */
let mailJournal: MailJournal | null = null
function ensureJournal(): MailJournal {
  if (!mailJournal) mailJournal = new MailJournal(path.join(userDataDir(), 'mail-journal.db'))
  return mailJournal
}

let mailActions: MailActions | null = null
function ensureActions(): MailActions {
  if (!mailActions) {
    const svc = ensureService()
    mailActions = new MailActions(
      {
        moveMessage: (a, f, uid, to) => svc.moveMessage(a, f, uid, to),
        setFlags: (a, f, uid, flags, add) => svc.setFlags(a, f, uid, flags, add),
        findByMessageId: (a, f, mid) => svc.findByMessageId(a, f, mid),
      },
      ensureJournal(),
    )
  }
  return mailActions
}

/** The two IMAP reads the sync layer needs, bound to the live service. */
function syncDeps() {
  const svc = ensureService()
  return {
    listMessages: (a: string, f: string, o: { limit?: number; beforeUid?: number; offset?: number }) =>
      svc.listMessages(a, f, o),
    listMessagesSince: (a: string, f: string, since: number, limit?: number) =>
      svc.listMessagesSince(a, f, since, limit),
    fetchMessage: (a: string, f: string, uid: number) => svc.fetchMessage(a, f, uid),
    fetchMessages: (a: string, f: string, uids: number[]) => svc.fetchMessages(a, f, uids),
  }
}

function ensureService(): MailService {
  if (!service) service = new MailService(ensureStore(), undefined, ensureTokens())
  return service
}

let rules: MailRuleStore | null = null
function ruleStore(): MailRuleStore {
  if (!rules) rules = new MailRuleStore(app.getPath('userData'))
  return rules
}


/**
 * Applies an approved plan: create folders, move each message, count failures.
 *
 * Shared by the filing plan and the newsletter sweep so there is exactly one
 * path that moves mail — the one that resolves the Message-ID a move needs to
 * be undoable and records every move as a single agent action, so a whole pass
 * reverts in one gesture.
 */
async function applyFilingPlan(
  id: string,
  p: FilingPlan,
): Promise<
  | { ok: true; value: { moved: number; failed: number; created: number } }
  | { ok: false; error: { code: string; message: string } }
> {
    if (!p?.folders?.length) return { ok: true as const, value: { moved: 0, failed: 0, created: 0 } }

    const existing = await ensureService().listFolders(id)
    if (!existing.ok) return existing
    const known = new Set(existing.value.map((f) => f.path))

    let moved = 0
    let failed = 0
    let created = 0

    for (const group of p.folders) {
      const target = asString(group.name, 200).trim()
      if (!target) continue
      if (!known.has(target)) {
        const mk = await ensureService().createFolder(id, target)
        if (!mk.ok) { failed += group.messages.length; continue }
        known.add(target)
        created++
      }
      for (const m of group.messages) {
        // Resolve the Message-ID now: the plan is built from the index, which
        // does not carry one until a row has been deepened. Without it the
        // action layer refuses — correctly, since the move could not be undone.
        const full = await ensureService().fetchMessage(id, m.folder, m.uid)
        if (!full.ok || !full.value.messageId) { failed++; continue }

        const res = await ensureActions().move(
          { accountId: id, folder: m.folder, uid: m.uid, messageId: full.value.messageId, label: m.subject },
          target,
          'agent',
        )
        if (res.ok) moved++
        else failed++
      }
    }
    return { ok: true as const, value: { moved, failed, created } }
}

function ensureSender(): SendService {
  if (!sender) sender = new SendService(ensureStore(), undefined, ensureTokens())
  return sender
}

function ensureDrafter(): DraftService {
  if (!drafter) drafter = new DraftService(makeAgentDraftFn())
  return drafter
}

let emailDraftFn: EmailDraftFn | null = null
function ensureEmailDraftFn(): EmailDraftFn {
  if (!emailDraftFn) emailDraftFn = makeEmailAgentDraftFn()
  return emailDraftFn
}

let assistFn: AssistFn | null = null
function ensureAssistFn(): AssistFn {
  if (!assistFn) assistFn = makeAssistFn()
  return assistFn
}

function asString(v: unknown, max = 512): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

function asPort(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback
}

/** Coerces a renderer payload into a validated, non-secret account input. */
function toAccountInput(raw: unknown): MailAccountInput {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const imap = (o.imap && typeof o.imap === 'object' ? o.imap : {}) as Record<string, unknown>
  const smtpRaw = (o.smtp && typeof o.smtp === 'object' ? o.smtp : null) as Record<string, unknown> | null
  return {
    displayName: asString(o.displayName, 200) || asString(o.user, 200),
    user: asString(o.user, 320),
    authKind: 'basic',
    imap: {
      host: asString(imap.host, 255),
      port: asPort(imap.port, 993),
      tls: imap.tls !== false,
    },
    smtp: smtpRaw
      ? { host: asString(smtpRaw.host, 255), port: asPort(smtpRaw.port, 465), tls: smtpRaw.tls !== false }
      : null,
  }
}

/** Coerce one address (rejects entries without a plausible address). */
function toAddress(raw: unknown): OutAddress | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const address = asString(o.address, 320).trim()
  if (!address || !address.includes('@')) return null
  const name = asString(o.name, 200).trim()
  return name ? { name, address } : { address }
}

/** Coerce an address list, dropping invalid entries and capping the count. */
function toAddressList(raw: unknown, max = 100): OutAddress[] {
  if (!Array.isArray(raw)) return []
  const out: OutAddress[] = []
  for (const item of raw.slice(0, max)) {
    const a = toAddress(item)
    if (a) out.push(a)
  }
  return out
}

/** Max total attachment bytes accepted across IPC (guards main-process memory). */
const MAX_ATTACH_BYTES = 25 * 1024 * 1024

/** Coerce attachments; content arrives base64 and is decoded to a bounded Buffer. */
function toAttachments(raw: unknown): OutAttachment[] {
  if (!Array.isArray(raw)) return []
  const out: OutAttachment[] = []
  let total = 0
  for (const item of raw.slice(0, 50)) {
    const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const filename = asString(o.filename, 255).trim() || 'attachment'
    const b64 = typeof o.content === 'string' ? o.content : ''
    let content: Buffer
    try {
      content = Buffer.from(b64, 'base64')
    } catch {
      continue
    }
    total += content.length
    if (total > MAX_ATTACH_BYTES) break
    const contentType = asString(o.contentType, 255).trim() || undefined
    // Inline images ride as CID attachments; the id is bounded to what can
    // legally appear inside the html's `cid:` reference.
    const cid = asString(o.cid, 120).replace(/[^a-zA-Z0-9._-]/g, '') || undefined
    out.push({ filename, content, ...(contentType ? { contentType } : {}), ...(cid ? { cid } : {}) })
  }
  return out
}

/** Coerce a renderer draft payload into a validated DraftInput. */
function toDraft(raw: unknown): DraftInput {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    to: toAddressList(o.to),
    cc: toAddressList(o.cc),
    bcc: toAddressList(o.bcc),
    subject: asString(o.subject, 998),
    text: asString(o.text, 5_000_000),
    html: typeof o.html === 'string' ? o.html.slice(0, 5_000_000) : undefined,
    attachments: toAttachments(o.attachments),
  }
}

/** Coerce the compose context. A malformed source falls back to a plain 'new'. */
function toContext(raw: unknown): ComposeContext {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const kind = asString(o.kind, 16)
  if (kind === 'reply' || kind === 'forward') {
    const src = o.source
    if (src && typeof src === 'object') {
      const source = src as unknown as FullMessage
      if (kind === 'reply') return { kind: 'reply', source, replyAll: o.replyAll === true }
      return { kind: 'forward', source }
    }
  }
  return { kind: 'new' }
}

/** The brand fields that steer the agent's WORDS (name/voice/tagline/palette). */
function currentBrandBrief(): BrandBriefSource {
  const b = brandStore().get()
  return {
    name: b.name,
    tagline: b.tagline,
    voice: b.voice,
    palette: { primary: b.palette.primary, accent: b.palette.accent },
  }
}

/** The brand fields the 'brand' email theme derives from (palette + fonts). */
function currentBrandTheme(): BrandThemeSource {
  const b = brandStore().get()
  return {
    palette: { accent: b.palette.accent, background: b.palette.background, text: b.palette.text },
    fonts: { heading: b.fonts.heading, body: b.fonts.body },
  }
}

export function registerMailHandlers(ipcMain: IpcMain): void {
  /**
   * Opt-in remote images for the reader.
   *
   * The renderer cannot fetch these itself: its srcdoc body inherits the
   * app-wide CSP, whose img-src has no `https:`, and an inherited policy can
   * only be narrowed from inside. Main fetches them with no cookies and no
   * referrer and returns data: URIs, which the existing policy already allows —
   * so the button works without widening security for every other surface.
   */
  ipcHandle(ipcMain, IPC.MAIL_REMOTE_IMAGES, async (_e, urls: unknown) => {
    if (!Array.isArray(urls)) return { ok: true, value: { images: {}, requested: 0, loaded: 0, failed: 0 } }
    // Bound what crosses IPC before any network work: the list comes from
    // message markup and is therefore attacker-chosen in both length and size.
    const list = urls
      .filter((u): u is string => typeof u === 'string' && u.length <= 2048)
      .slice(0, IMG_LIMITS.maxImages)
    const value = await loadRemoteImages(list, netImageFetch)
    return { ok: true, value }
  })

  // Non-secret account metadata only (never the password).
  ipcHandle(ipcMain, IPC.MAIL_ACCOUNTS_LIST, () => ensureService().listAccounts())

  ipcHandle(ipcMain, IPC.MAIL_ACCOUNTS_ADD, async (_e, payload: unknown, secret: unknown) => {
    const input = toAccountInput(payload)
    const pass = asString(secret, 1024)
    const account = await ensureService().addAccount(input, pass)
    ensureService().invalidate()
    return account // secret intentionally absent from the record
  })

  ipcHandle(ipcMain, IPC.MAIL_ACCOUNTS_REMOVE, async (_e, id: unknown) => {
    await ensureService().removeAccount(asString(id, 64))
    return { ok: true }
  })

  // Validate credentials WITHOUT saving — the settings "Test connection" button.
  ipcHandle(ipcMain, IPC.MAIL_ACCOUNTS_TEST, (_e, payload: unknown, secret: unknown) => {
    const input = toAccountInput(payload)
    const pass = asString(secret, 1024)
    return ensureService().testConnection(input, pass)
  })

  ipcHandle(ipcMain, IPC.MAIL_FOLDERS, (_e, accountId: unknown) =>
    ensureService().listFolders(asString(accountId, 64)),
  )

  ipcHandle(ipcMain, IPC.MAIL_MESSAGES, (_e, accountId: unknown, folder: unknown, opts: unknown) => {
    const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>
    const limit = typeof o.limit === 'number' ? o.limit : undefined
    const beforeUid = typeof o.beforeUid === 'number' ? o.beforeUid : undefined
    const offset = typeof o.offset === 'number' ? o.offset : undefined
    return ensureService().listMessages(asString(accountId, 64), asString(folder, 512), { limit, beforeUid, offset })
  })

  ipcHandle(ipcMain, IPC.MAIL_MESSAGE, (_e, accountId: unknown, folder: unknown, uid: unknown) => {
    const n = typeof uid === 'number' ? uid : Number(uid)
    return ensureService().fetchMessage(
      asString(accountId, 64),
      asString(folder, 512),
      Number.isFinite(n) ? n : 0,
    )
  })

  // ── Local index: cache-first list, real search, background deepening ──────

  /**
   * Refreshes a folder into the local index, then deepens one bounded batch of
   * bodies. Returns what it did so the UI can show honest progress rather than
   * an indeterminate spinner.
   *
   * `prune` is on because this call lists the folder itself — syncEnvelopes
   * still refuses to act on it unless the listing came back complete.
   */
  ipcHandle(ipcMain, IPC.MAIL_SYNC, async (_e, accountId: unknown, folder: unknown) => {
    const a = asString(accountId, 64)
    const f = asString(folder, 512)
    const idx = ensureIndex()
    const env = await syncEnvelopes(idx, syncDeps(), a, f, { limit: 200, prune: true })
    if (env.error) return { ok: false as const, error: { code: 'unknown' as const, message: env.error } }
    const deep = await deepenBatch(idx, syncDeps(), a, { limit: 25 })
    return {
      ok: true as const,
      value: { indexed: env.indexed, pruned: env.pruned, deepened: deep.deepened, remaining: deep.remaining },
    }
  })

  /**
   * Materialises one attachment and writes it where the user chooses.
   *
   * Content is fetched on demand rather than carried through every parse — the
   * reader opens messages constantly and holding attachment Buffers in main for
   * mail nobody wants to save is how a mail client ends up using a gigabyte.
   *
   * The filename comes from the SENDER, so it is treated as hostile: it never
   * reaches the filesystem un-normalised, and the resolved path is verified to
   * be a direct child of the chosen directory (see mail/attachments.ts).
   */
  async function materialise(accountId: string, folder: string, uid: number, index: number) {
    const src = await ensureService().fetchSource(accountId, folder, uid)
    if (!src.ok) return src
    const att = await extractAttachment(src.value, index)
    if (!att) return { ok: false as const, error: { code: 'not-found' as const, message: 'That attachment is no longer part of this message.' } }
    return { ok: true as const, value: att }
  }

  ipcHandle(ipcMain, IPC.MAIL_ATTACHMENT_SAVE, async (_e, accountId, folder, uid, index) => {
    const got = await materialise(asString(accountId, 64), asString(folder, 512), Number(uid) || 0, Number(index) || 0)
    if (!got.ok) return got

    const suggested = safeFilename(got.value.filename)
    const choice = await dialog.showSaveDialog({
      defaultPath: path.join(app.getPath('downloads'), suggested),
    })
    if (choice.canceled || !choice.filePath) return { ok: true as const, value: { saved: false as const } }

    // The user picked the path, but the FILENAME still originated with the
    // sender, so it is re-normalised against the chosen directory rather than
    // trusted because a dialog was involved.
    const dir = path.dirname(choice.filePath)
    const target = resolveSavePath(dir, path.basename(choice.filePath))
    if (!target) return { ok: false as const, error: { code: 'unknown' as const, message: 'That location could not be used.' } }

    fs.writeFileSync(target, got.value.content)
    return { ok: true as const, value: { saved: true as const, path: target } }
  })

  /**
   * Opens an attachment with the OS default application, from a temp copy.
   *
   * Written into a per-run temp directory rather than beside anything of the
   * user's, and the name is normalised the same way — an attachment called
   * "../../x" must not be able to reach outside that directory either.
   */
  ipcHandle(ipcMain, IPC.MAIL_ATTACHMENT_OPEN, async (_e, accountId, folder, uid, index) => {
    const got = await materialise(asString(accountId, 64), asString(folder, 512), Number(uid) || 0, Number(index) || 0)
    if (!got.ok) return got

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-att-'))
    const name = uniqueName(safeFilename(got.value.filename), (c) => fs.existsSync(path.join(dir, c)))
    const target = resolveSavePath(dir, name)
    if (!target) return { ok: false as const, error: { code: 'unknown' as const, message: 'That attachment name could not be used.' } }

    fs.writeFileSync(target, got.value.content)
    const problem = await shell.openPath(target)
    if (problem) return { ok: false as const, error: { code: 'unknown' as const, message: problem } }
    return { ok: true as const, value: { opened: true as const } }
  })

  /**
   * Exports a message to PDF.
   *
   * Renders in an OFFSCREEN window rather than printing the reader's iframe:
   * the reader iframe is sandboxed with no privileges by design, and granting
   * it printing rights to reuse it would trade a security boundary for
   * convenience. The offscreen window gets the same locked-down CSP.
   */
  ipcHandle(ipcMain, IPC.MAIL_EXPORT_PDF, async (_e, html: unknown, subject: unknown) => {
    const body = asString(html, 5_000_000)
    const title = safeFilename(asString(subject, 200) || 'message')

    const choice = await dialog.showSaveDialog({
      defaultPath: path.join(app.getPath('downloads'), `${title}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (choice.canceled || !choice.filePath) return { ok: true as const, value: { saved: false as const } }

    const win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
    })
    try {
      const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;"
      const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>body{font:13px/1.55 -apple-system,system-ui,sans-serif;padding:24px;color:#111}img{max-width:100%}</style></head><body>${body}</body></html>`
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(doc)}`)
      const pdf = await win.webContents.printToPDF({ printBackground: true })
      fs.writeFileSync(choice.filePath, pdf)
      return { ok: true as const, value: { saved: true as const, path: choice.filePath } }
    } finally {
      win.destroy()
    }
  })

  /** The raw RFC822 source of a message — "show original", for debugging a mail. */
  ipcHandle(ipcMain, IPC.MAIL_RAW_SOURCE, async (_e, accountId: unknown, folder: unknown, uid: unknown) => {
    const res = await ensureService().fetchSource(asString(accountId, 64), asString(folder, 512), Number(uid) || 0)
    if (!res.ok) return res
    // Bounded: a message with a large attachment would otherwise ship megabytes
    // of base64 into the renderer for a viewer nobody scrolls to the end of.
    return { ok: true as const, value: res.value.toString('utf-8').slice(0, 200_000) }
  })

  ipcHandle(ipcMain, IPC.MAIL_FOLDER_CREATE, (_e, accountId: unknown, folderPath: unknown) =>
    ensureService().createFolder(asString(accountId, 64), asString(folderPath, 512)),
  )

  ipcHandle(ipcMain, IPC.MAIL_FOLDER_RENAME, (_e, accountId: unknown, from: unknown, to: unknown) =>
    ensureService().renameFolder(asString(accountId, 64), asString(from, 512), asString(to, 512)),
  )

  /**
   * Deletes a folder — the ONE operation here that can destroy mail.
   *
   * IMAP DELETE takes the messages with it and there is no Trash for a mailbox,
   * so this refuses a folder that still holds anything. Emptying it first is a
   * deliberate act the user performs message by message, with undo available at
   * every step; deleting a full folder in one click is not.
   */
  ipcHandle(ipcMain, IPC.MAIL_FOLDER_DELETE, async (_e, accountId: unknown, folderPath: unknown) => {
    const id = asString(accountId, 64)
    const target = asString(folderPath, 512)

    const counts = await ensureService().folderCounts(id, [target])
    if (!counts.ok) return counts
    const total = counts.value[target]?.total ?? 0
    if (total > 0) {
      return {
        ok: false as const,
        error: {
          code: 'unavailable' as const,
          message: `“${target}” still holds ${total} message${total === 1 ? '' : 's'}. Deleting a folder deletes its mail permanently, so empty it first.`,
        },
      }
    }
    return ensureService().deleteFolder(id, target)
  })

  /**
   * New-mail watching.
   *
   * Polls the INBOX watermark on the schedule the pure policy dictates
   * (idle-watcher.ts) rather than holding an IMAP IDLE socket open. A poll is
   * one cheap STATUS-equivalent read; an IDLE socket is a persistent connection
   * whose failure modes we would then own on every provider. The policy — when
   * to retry, when to stop, when to give up — is the part that matters and it
   * is unit-tested; swapping the transport for true IDLE later changes nothing
   * above this line.
   *
   * Everything is torn down on stop. A watcher that outlives a logout keeps
   * polling with credentials the user believes they revoked.
   */
  const watchers = new Map<string, { timer: NodeJS.Timeout | null; state: WatcherState; watermark: number }>()

  function stopWatch(accountId: string, reason = 'Stopped.'): void {
    const w = watchers.get(accountId)
    if (!w) return
    if (w.timer) clearTimeout(w.timer)
    w.timer = null
    w.state = onStop(w.state, reason)
    watchers.delete(accountId)
  }

  async function pollOnce(accountId: string, folder: string): Promise<void> {
    const w = watchers.get(accountId)
    if (!w || w.state.state === 'stopped') return

    w.state = onConnecting(w.state)
    const res = await ensureService().listMessagesSince(accountId, folder, w.watermark, 50)

    // The account may have been removed while the read was in flight.
    if (!watchers.has(accountId)) return

    if (!res.ok) {
      w.state = onFailure(w.state, { code: res.error.code })
      if (shouldRetry(w.state)) {
        w.timer = setTimeout(() => void pollOnce(accountId, folder), w.state.nextDelayMs ?? 30_000)
      } else {
        log('warn', `[mail-watch] stopped: ${w.state.stoppedReason ?? 'unknown'}`)
        watchers.delete(accountId)
      }
      return
    }

    w.state = onConnected(w.state)
    const fresh = newUidsSince(res.value.map((m) => m.uid), w.watermark)
    if (fresh.length > 0) {
      w.watermark = Math.max(w.watermark, ...fresh)
      const summaries = res.value.filter((m) => fresh.includes(m.uid))
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.MAIL_NEW_MAIL, {
          accountId,
          folder,
          count: fresh.length,
          // Enough for a notification line; never the body.
          latest: summaries[0]
            ? { subject: summaries[0].subject, from: summaries[0].from[0]?.name || summaries[0].from[0]?.address || '' }
            : null,
        })
      }
    }
    w.timer = setTimeout(() => void pollOnce(accountId, folder), 60_000)
  }

  ipcHandle(ipcMain, IPC.MAIL_WATCH_START, async (_e, accountId: unknown, folder: unknown) => {
    const id = asString(accountId, 64)
    const f = asString(folder, 512)
    stopWatch(id, 'restarting')

    // Start from what we already hold, so the first poll does not announce the
    // entire existing mailbox as "new".
    const watermark = ensureIndex().highestUid(id, f)
    watchers.set(id, { timer: null, state: initialState(), watermark })
    void pollOnce(id, f)
    return { ok: true as const, value: { watching: true } }
  })

  ipcHandle(ipcMain, IPC.MAIL_WATCH_STOP, (_e, accountId: unknown) => {
    stopWatch(asString(accountId, 64), 'stopped by request')
    return { ok: true as const }
  })

  /** Unread + total per folder, for the rail badges. One connection, no locks. */
  ipcHandle(ipcMain, IPC.MAIL_FOLDER_COUNTS, async (_e, accountId: unknown, folders: unknown) => {
    const list = Array.isArray(folders) ? folders.slice(0, 100).map((f) => asString(f, 512)) : []
    return ensureService().folderCounts(asString(accountId, 64), list)
  })

  /**
   * The folder as the local index already knows it — conversations, newest
   * first. Returns instantly because it touches no network.
   *
   * This is what the list paints from on open; the IMAP read then refreshes
   * behind it. Empty is a normal answer for a folder never synced, and the
   * caller falls back to the network rather than showing an empty mailbox.
   */
  ipcHandle(ipcMain, IPC.MAIL_CACHED, (_e, accountId: unknown, folder: unknown, limit: unknown) => {
    const rows = ensureIndex().listThreads(
      asString(accountId, 64),
      asString(folder, 512),
      typeof limit === 'number' ? Math.min(limit, 200) : 50,
    )
    return { ok: true as const, value: rows }
  })

  /**
   * Recipient suggestions from people you have actually corresponded with.
   * Derived from the index — no contact store, no sync, no extra permission.
   */
  ipcHandle(ipcMain, IPC.MAIL_CONTACTS, (_e, query: unknown, limit: unknown) => ({
    ok: true as const,
    value: ensureIndex().suggestContacts(
      asString(query, 200),
      typeof limit === 'number' ? Math.min(limit, 20) : 8,
    ),
  }))

  /**
   * Saves a compose draft to the server's Drafts folder.
   *
   * Server-side rather than local, so the draft is there from your phone and
   * from Outlook — which is the entire point of a draft, and what makes losing
   * one when a window closes feel like a bug rather than a missing feature.
   *
   * `replaceUid` lets a re-save supersede the previous copy: the old one is
   * MOVED TO TRASH rather than deleted, because this codebase has no
   * destructive verb and drafts are not an exception worth carving out.
   */
  ipcHandle(ipcMain, IPC.MAIL_SAVE_DRAFT, async (_e, accountId: unknown, draft: unknown, context: unknown, replaceUid: unknown) => {
    const id = asString(accountId, 64)
    const account = (await ensureService().listAccounts()).find((a) => a.id === id)
    if (!account) return { ok: false as const, error: { code: 'not-found' as const, message: 'Mail account not found.' } }

    const folders = await ensureService().listFolders(id)
    if (!folders.ok) return folders
    const drafts = findDraftsFolder(folders.value)
    if (!drafts) {
      return { ok: false as const, error: { code: 'not-found' as const, message: 'This account has no Drafts folder, so the draft could not be saved to the server.' } }
    }

    const message = buildOutgoing(
      { name: account.displayName, address: account.user },
      toDraft(draft),
      toContext(context),
    )
    const raw = await buildDraftMime(message)
    const appended = await ensureService().appendMessage(id, drafts, raw)
    if (!appended.ok) return appended

    // Supersede the previous copy, so re-saving does not litter Drafts.
    const prev = Number(replaceUid) || 0
    if (prev > 0) {
      const trash = folders.value.find((f) => (f.specialUse || '').toLowerCase() === '\\trash')
        ?? folders.value.find((f) => /^(trash|deleted|gel[oö]scht)/i.test(f.name))
      if (trash) await ensureService().moveMessage(id, drafts, prev, trash.path)
    }

    return { ok: true as const, value: { folder: drafts, uid: appended.value.uid } }
  })

  /** The signature for one account (empty string when none is set). */
  ipcHandle(ipcMain, IPC.MAIL_SIGNATURE_GET, (_e, accountId: unknown) => ({
    ok: true as const,
    value: readSignatures(userDataDir())[asString(accountId, 64)] ?? '',
  }))

  ipcHandle(ipcMain, IPC.MAIL_SIGNATURE_SET, (_e, accountId: unknown, signature: unknown) => {
    saveSignature(userDataDir(), asString(accountId, 64), asString(signature, 4000))
    return { ok: true as const }
  })

  /** Full-text search over the local index — the thing the filter box faked. */
  ipcHandle(ipcMain, IPC.MAIL_SEARCH, (_e, query: unknown, opts: unknown) => {
    const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>
    // Structured: `from:ana budget is:unread` — free text still goes to FTS,
    // operators become predicates. An unrecognised operator searches literally.
    const rows = ensureIndex().searchStructured(asString(query, 512), {
      accountId: typeof o.accountId === 'string' ? o.accountId : undefined,
      folder: typeof o.folder === 'string' ? o.folder : undefined,
      limit: typeof o.limit === 'number' ? o.limit : 50,
      sort: typeof o.sort === 'string' ? (o.sort as never) : undefined,
    })
    return { ok: true as const, value: rows }
  })

  ipcHandle(ipcMain, IPC.MAIL_INDEX_STATS, () => ({ ok: true as const, value: ensureIndex().stats() }))

  // ── Mutating verbs ────────────────────────────────────────────────────────
  //
  // Every one journals its inverse before reporting success, so anything done
  // here can be taken back. There is no delete channel — deleting is a move to
  // Trash — and no expunge anywhere in the codebase.
  //
  // These are USER actions. The agent's capability set (capabilityCatalog.ts)
  // still grants only mail.triage / mail.draftReply / mail.read, and wiring it
  // to these is a separate, deliberate decision.

  const asTarget = (accountId: unknown, folder: unknown, uid: unknown, messageId: unknown, label: unknown) => ({
    accountId: asString(accountId, 64),
    folder: asString(folder, 512),
    uid: Number(uid) || 0,
    messageId: asString(messageId, 998),
    label: typeof label === 'string' ? label.slice(0, 300) : '',
  })

  ipcHandle(ipcMain, IPC.MAIL_MOVE, async (_e, accountId, folder, uid, messageId, toFolder, label) =>
    ensureActions().move(asTarget(accountId, folder, uid, messageId, label), asString(toFolder, 512), 'user'),
  )

  ipcHandle(ipcMain, IPC.MAIL_SET_READ, async (_e, accountId, folder, uid, messageId, read, label) =>
    ensureActions().setRead(asTarget(accountId, folder, uid, messageId, label), Boolean(read), 'user'),
  )

  ipcHandle(ipcMain, IPC.MAIL_SET_FLAGGED, async (_e, accountId, folder, uid, messageId, flagged, label) =>
    ensureActions().setFlagged(asTarget(accountId, folder, uid, messageId, label), Boolean(flagged), 'user'),
  )

  ipcHandle(ipcMain, IPC.MAIL_UNDO, async (_e, accountId: unknown, actionId: unknown) =>
    ensureActions().undo(asString(accountId, 64), Number(actionId) || 0),
  )

  /**
   * Undo everything the AGENT did to the mailbox since a moment.
   *
   * This is what makes granting the agent filing rights survivable. Not "review
   * each of the forty things it moved" — one action that puts the mailbox back.
   * The journal replays newest-first, which is a correctness requirement:
   * oldest-first moves a message out from under a later undo.
   *
   * Scoped to the agent, so a bad agent run cannot take the user's own filing
   * with it.
   */
  ipcHandle(ipcMain, IPC.MAIL_UNDO_AGENT, async (_e, accountId: unknown, sinceMs: unknown) => {
    const id = asString(accountId, 64)
    const since = Number(sinceMs)
    return ensureActions().undoSince(id, Number.isFinite(since) ? since : 0, 'agent')
  })

  /**
   * Propose a filing plan for recent mail. PROPOSES — moves nothing.
   *
   * Reads from the local index rather than IMAP, so analysing 90 days costs no
   * network at all and the proposal appears instantly.
   */
  ipcHandle(ipcMain, IPC.MAIL_FILING_PROPOSE, (_e, accountId: unknown, folder: unknown, days: unknown) => {
    const id = asString(accountId, 64)
    const f = asString(folder, 512)
    const n = Number(days)
    const windowDays: FilingWindow = n === 7 || n === 30 || n === 90 ? n : 30

    // A generous page: the plan filters by window anyway, and reading more from
    // a local index is free.
    const rows = ensureIndex().listFolder(id, f, 2000)
    const plan = buildFilingPlan(
      rows.map((r) => ({
        accountId: id,
        folder: r.folder,
        uid: r.uid,
        messageId: '', // filled below only for rows we have deepened
        subject: r.subject,
        fromName: r.fromName,
        fromAddress: r.fromAddress,
        date: r.date,
        seen: r.seen,
      })),
      windowDays,
      Date.now(),
    )
    return { ok: true as const, value: plan }
  })

  /**
   * Apply an APPROVED plan.
   *
   * Every move is recorded as an AGENT action, so "undo everything the agent
   * filed" puts the whole pass back in one gesture. Folders are created as
   * needed. Failures are counted, never thrown: one message that has moved
   * since the proposal must not abandon the other forty.
   */
  ipcHandle(ipcMain, IPC.MAIL_FILING_APPLY, (_e, accountId: unknown, plan: unknown) =>
    applyFilingPlan(asString(accountId, 64), plan as FilingPlan),
  )

  /** The undo stack, newest first, with a plain-language line for each entry. */
  ipcHandle(ipcMain, IPC.MAIL_UNDOABLE, (_e, accountId: unknown) => {
    const rows = ensureJournal().undoable(asString(accountId, 64), { limit: 20 })
    return {
      ok: true as const,
      value: rows.map((a) => ({ id: a.id, at: a.at, description: describeAction(a) })),
    }
  })

  // ── Phase 2: compose / reply / forward / send ─────────────────────────────

  // Validate SMTP credentials WITHOUT saving — the SMTP "Test connection" probe.
  ipcHandle(ipcMain, IPC.MAIL_SMTP_TEST, (_e, payload: unknown, secret: unknown) => {
    const input = toAccountInput(payload)
    if (!input.smtp) return { ok: false, error: { code: 'unavailable', message: 'No SMTP server given.' } }
    const pass = asString(secret, 1024)
    return ensureSender().testSmtp(input.smtp, input.user, pass)
  })

  // Add the built-in DEMO mailbox (one click, no form, no secret, no network).
  ipcHandle(ipcMain, IPC.MAIL_ACCOUNTS_ADD_DEMO, async () => {
    const account = await ensureService().addDemoAccount()
    ensureService().invalidate()
    return account
  })

  // Send a composed message. The draft + optional source are validated/coerced
  // here; the SMTP secret is decrypted only inside the service at send-time.
  // A DEMO account never hits SMTP — its send appends locally to the demo store.
  /**
   * The actual delivery, shared by the immediate and the held paths.
   *
   * MAIL_SEND stays immediate because the agent-reply flow and the review cards
   * depend on its existing contract; the undo-send hold is an ADDITIVE channel
   * that compose opts into. Changing the shared one in place would have made
   * every approve-and-send wait eight seconds before reporting back.
   */
  async function doSend(accountId: unknown, draft: unknown, context: unknown) {
    const id = asString(accountId, 64)
    const account = (await ensureService().listAccounts()).find((a) => a.id === id)
    if (account?.authKind === 'demo') {
      const message = buildOutgoing(
        { name: account.displayName, address: account.user },
        toDraft(draft),
        toContext(context),
      )
      const res = await ensureService().demoSend(id, message)
      if (!res.ok) return res
      // Match the SMTP SendResult shape so the renderer is agnostic to the path.
      return {
        ok: true as const,
        value: { messageId: res.value.messageId ?? '', accepted: [account.user], rejected: [] },
      }
    }
    return ensureSender().send(id, toDraft(draft), toContext(context))
  }

  ipcHandle(ipcMain, IPC.MAIL_SEND, async (_e, accountId: unknown, draft: unknown, context: unknown) =>
    doSend(accountId, draft, context),
  )

  /**
   * The undo-send hold.
   *
   * A message waits briefly in memory before SMTP ever sees it — the only
   * honest way to offer undo on the one irreversible action in this client. A
   * delivered mail cannot be recalled by anyone, whatever a "recall" button
   * elsewhere implies.
   *
   * In memory on purpose: a queued send must NOT survive a quit. A message that
   * silently posts itself on the next launch, hours later, is worse than one
   * that was never sent — the user has moved on and no longer expects it.
   */
  const sendQueue = new SendQueue<{ accountId: unknown; draft: unknown; context: unknown }>(
    async ({ accountId, draft, context }) => {
      const res = await doSend(accountId, draft, context)
      return res.ok ? { ok: true } : { ok: false, error: res.error.message }
    },
    { holdMs: 8000 },
  )

  /** Queues a send behind the hold window; returns immediately with its id. */
  ipcHandle(ipcMain, IPC.MAIL_SEND_QUEUED, (_e, accountId: unknown, draft: unknown, context: unknown) => {
    const item = sendQueue.enqueue({ accountId, draft, context })
    return { ok: true as const, value: { id: item.id, holdMs: Math.max(0, item.dueAt - Date.now()) } }
  })

  ipcHandle(ipcMain, IPC.MAIL_SEND_CANCEL, (_e, id: unknown) => ({
    ok: true as const,
    value: { cancelled: sendQueue.cancel(asString(id, 64)) },
  }))

  ipcHandle(ipcMain, IPC.MAIL_SEND_NOW, async (_e, id: unknown) => {
    const item = await sendQueue.sendNow(asString(id, 64))
    sendQueue.prune()
    if (!item) return { ok: false as const, error: { code: 'not-found' as const, message: 'That message is no longer waiting to send.' } }
    if (item.state === 'failed') return { ok: false as const, error: { code: 'unknown' as const, message: item.error ?? 'Sending failed.' } }
    return { ok: true as const, value: { state: item.state } }
  })

  // ── Phase 3: fuse inbound mail into the Agent Review / Living Feed ─────────

  // Scan a folder → the messages that plausibly need a human reply (ranked).
  // Pure triage runs inside the service; here we just coerce the inputs.
  ipcHandle(ipcMain, IPC.MAIL_TRIAGE, async (_e, accountId: unknown, folder: unknown, opts: unknown) => {
    const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>
    const limit = typeof o.limit === 'number' ? o.limit : undefined
    const maxCandidates = typeof o.maxCandidates === 'number' ? o.maxCandidates : undefined
    return ensureService().triageFolder(asString(accountId, 64), asString(folder, 512), {
      limit,
      maxCandidates,
      // The person's rules outrank every signal — see classify.ts.
      rules: await ruleStore().list(),
    })
  })

  /**
   * The Morning Sift — stage 2 classification over what's NEW in a folder.
   *
   * Reads the LOCAL index only (no IMAP round-trips): unread rows, capped at
   * 60, each carrying sender/subject/snippet plus the stage-1 verdict from its
   * stored signals. One batched model call returns zone + priority + a one-line
   * summary per mail; a failed or garbled model reply degrades to stage 1
   * (sift.ts heals it), so this handler can never return an empty morning.
   *
   * The model is the person's SETTING passed through — no model name in
   * source; absent means the CLI default. Case titles come from the renderer,
   * which already holds the open cases; the parser only accepts assignments
   * to titles in this list.
   */
  ipcHandle(ipcMain, IPC.MAIL_SIFT, async (_e, accountId: unknown, folder: unknown, opts: unknown) => {
    const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>
    const id = asString(accountId, 64)
    const f = asString(folder, 512)
    const model = typeof o.model === 'string' && o.model.trim() ? o.model.trim().slice(0, 64) : undefined
    const caseTitles = Array.isArray(o.caseTitles)
      ? (o.caseTitles as unknown[])
          .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
          .slice(0, 30)
          .map((t) => t.slice(0, 120))
      : []
    // Uids the caller has ALREADY-JUDGED verdicts for (its cache). Skipping
    // them makes the sift incremental: flipping to the view when nothing is
    // new sends an empty batch, which never calls the model at all.
    const exclude = new Set(
      Array.isArray(o.excludeUids)
        ? (o.excludeUids as unknown[]).filter((u): u is number => typeof u === 'number').slice(0, 1000)
        : [],
    )
    const rules = await ruleStore().list()
    const unreadRows = ensureIndex().listFolder(id, f, 400).filter((r) => !r.seen)
    const rows = unreadRows.filter((r) => !exclude.has(r.uid)).slice(0, 60)
    const items: SiftItem[] = rows.map((r) => ({
      uid: r.uid,
      folder: r.folder,
      fromName: r.fromName,
      fromAddress: r.fromAddress,
      subject: r.subject,
      snippet: r.snippet,
      heuristic: classifyFrom(
        // Envelope-tier rows synced before deepening carry no signals yet;
        // all-false reads as "nothing proven", and the model verdict decides.
        r.signals ?? { list: false, unsubscribe: false, machine: false },
        r.subject,
        [{ name: r.fromName, address: r.fromAddress }],
        rules,
      ).category,
    }))
    const result = await siftItems(items, caseTitles, (prompt) =>
      runProviderOneShot(prompt, { timeoutMs: 120_000, label: 'The mail sift', model }),
    )
    // The view shows sender and subject next to each verdict; the rows are
    // already in hand, so ship them together instead of a second lookup.
    const rowByUid = new Map(rows.map((r) => [r.uid, r]))
    return {
      ...result,
      verdicts: result.verdicts.map((v) => {
        const r = rowByUid.get(v.uid)
        return {
          ...v,
          fromName: r?.fromName || r?.fromAddress || '',
          fromAddress: r?.fromAddress || '',
          subject: r?.subject || '',
          date: r?.date ?? null,
          messageId: r?.messageId ?? null,
        }
      }),
      scanned: items.length,
      // Everything currently unread, judged or not — the caller prunes its
      // cache against this so mails read elsewhere fall out of the sift.
      unreadUids: unreadRows.map((r) => r.uid),
    }
  })

  /**
   * Propose filing the newsletters. PROPOSES — moves nothing.
   *
   * Reads the local index, so it costs no network and appears instantly.
   */
  ipcHandle(ipcMain, 'mail:newsletters:propose', async (_e, accountId: unknown, folder: unknown, days: unknown) => {
    const id = asString(accountId, 64)
    const f = asString(folder, 512)
    const n = Number(days)
    /*
     * Read what has not been read yet, before answering.
     *
     * A message the index only has an envelope for cannot be sorted, and a
     * mailbox synced before the signal columns existed has thousands of them.
     * Without this the button honestly reports "478 could not be checked" and
     * then reports it again forever, because nothing else in the app is going
     * to go and look. Bounded per press: it does real work, says what is left,
     * and converges if pressed again.
     */
    const idx = ensureIndex()
    const rules = await ruleStore().list()
    let deepened = 0
    if (idx.pendingDeepCount(id) > 0) {
      const pass = await deepenBatch(idx, syncDeps(), id, { limit: 150 })
      deepened = pass.deepened
    }

    const rows = idx.listFolder(id, f, 2000)
    const sweep = buildNewsletterSweep(rows, rules, {
      // Ten years rather than one: a mailbox that has never been swept has
      // years of them, and quietly shrinking the window the caller asked for
      // would report "no newsletters" about a period never examined.
      days: Number.isFinite(n) && n > 0 ? Math.min(n, 3650) : 30,
    })
    return { ok: true as const, value: { ...sweep, deepened } }
  })

  /**
   * File an APPROVED sweep, through the same path the filing plan uses.
   *
   * Deliberately not its own mover: that path already creates the folder,
   * resolves the Message-ID a move needs to be undoable, records every move as
   * one agent action so the whole pass reverts in a single gesture, and counts
   * failures instead of abandoning the batch. A second implementation would
   * have to earn all of that again, and would be the one that got it wrong.
   */
  ipcHandle(ipcMain, 'mail:newsletters:file', async (_e, accountId: unknown, sweep: unknown) => {
    const s = sweep as { folder?: string; messages?: { folder: string; uid: number; subject: string }[] }
    if (!s?.messages?.length) return { ok: true as const, value: { moved: 0, failed: 0, created: 0 } }
    const plan = {
      windowDays: 30 as const,
      folders: [
        {
          name: asString(s.folder ?? NEWSLETTER_FOLDER, 200),
          reason: 'newsletters',
          messages: s.messages,
        },
      ],
      leftInInbox: 0,
    }
    return applyFilingPlan(asString(accountId, 64), plan as unknown as FilingPlan)
  })

  /* ── how mail is sorted, and the rules that override it ─────────────────── */

  ipcHandle(ipcMain, 'mail:rules:list', () => ruleStore().list())
  ipcHandle(ipcMain, 'mail:rules:add', (_e, rule: unknown) => ruleStore().add(rule))
  ipcHandle(ipcMain, 'mail:rules:update', (_e, id: unknown, patch: unknown) =>
    ruleStore().update(asString(id, 80), patch),
  )
  ipcHandle(ipcMain, 'mail:rules:remove', async (_e, id: unknown) => {
    await ruleStore().remove(asString(id, 80))
    return { ok: true }
  })
  ipcHandle(ipcMain, 'mail:rules:reorder', (_e, id: unknown, delta: unknown) =>
    ruleStore().reorder(asString(id, 80), Number(delta) < 0 ? -1 : 1),
  )

  /**
   * What the app thinks a message is, and why.
   *
   * Exposed so the reader can SHOW the verdict rather than silently acting on
   * it. A classifier the person cannot see is one they cannot correct, and the
   * correction is the whole point of the rules.
   */
  ipcHandle(ipcMain, 'mail:classify', async (_e, accountId: unknown, folder: unknown, uid: unknown) => {
    const res = await ensureService().fetchMessage(asString(accountId, 64), asString(folder, 512), Number(uid))
    if (!res.ok) return res
    const m = res.value
    const verdict = classify(
      { subject: m.subject, from: m.from, headers: m.headers, text: m.text, html: m.html },
      await ruleStore().list(),
    )
    return { ok: true, value: verdict }
  })

  // Draft a reply for one source message. Fetches the full source, then the
  // DraftService builds the envelope (proven buildOutgoing) + an agent-suggested
  // body. This NEVER sends — the send happens later via MAIL_SEND on approval.
  ipcHandle(ipcMain, IPC.MAIL_DRAFT_REPLY, async (_e, accountId: unknown, payload: unknown) => {
    const o = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
    const id = asString(accountId, 64)
    const folder = asString(o.folder, 512)
    const n = typeof o.uid === 'number' ? o.uid : Number(o.uid)
    const uid = Number.isFinite(n) ? n : 0
    const replyAll = o.replyAll === true
    let instruction = asString(o.instruction, 2000).trim() || undefined

    /**
     * A quick reply is a STANCE, not a canned sentence: the user supplies the
     * one thing only they know — yes, acknowledge, or decline — and the agent
     * writes from that intent.
     *
     * Deliberately routed through the SAME drafter as every other agent reply,
     * so it lands as a draft behind the existing gate (`canArmSend` still
     * requires the human to open it before Send arms). A second, faster path to
     * sending is exactly what should not exist here.
     */
    const stance = asString(o.stance, 16) as Stance | ''
    if (stance === 'positive' || stance === 'neutral' || stance === 'negative') {
      const src = await ensureService().fetchMessage(id, folder, uid)
      if (src.ok) {
        instruction = buildQuickReplyPrompt({
          stance,
          subject: src.value.subject,
          fromName: src.value.from[0]?.name || src.value.from[0]?.address || '',
          body: src.value.text,
          selfName: (await ensureService().listAccounts()).find((a) => a.id === id)?.displayName,
        })
      }
    }

    const account = (await ensureService().listAccounts()).find((a) => a.id === id)
    if (!account) return { ok: false as const, error: { code: 'not-found' as const, message: 'Mail account not found.' } }

    const source = await ensureService().fetchMessage(id, folder, uid)
    if (!source.ok) return source

    try {
      const drafted = await ensureDrafter().draftReply(
        { name: account.displayName, address: account.user },
        source.value,
        { replyAll, instruction },
      )
      return { ok: true as const, value: drafted }
    } catch (e) {
      // Never leak internals; the drafter's messages are already safe (no secret).
      const message = e instanceof Error ? e.message : 'The drafting agent failed.'
      return { ok: false as const, error: { code: 'unknown' as const, message } }
    }
  })

  // ── Advanced 1:1 email — richer than a plain-text box ──────────────────────

  // Assemble a chosen theme + structured blocks (text/table/metric/CTA) into a
  // responsive HTML message + plain-text fallback, with live {{metric:<id>}}
  // tokens resolved true at build time. NEVER sends — the renderer previews, then
  // reuses MAIL_SEND with html + text set. Always resolves (never throws).
  ipcHandle(ipcMain, IPC.MAIL_RICH_BUILD, async (_e, payload: unknown) => {
    try {
      // Load the current brand so the 'brand' theme derives from the user's saved
      // palette + fonts (ignored by the built-in themes).
      const input = { ...toBuildInput(payload), brand: currentBrandTheme() }
      const built = await buildRichEmail(input, metrics)
      return { ok: true as const, value: built }
    } catch {
      return { ok: false as const, error: { code: 'unknown' as const, message: 'Could not build the message.' } }
    }
  })

  // Draft a whole 1:1 email from a one-line brief (the "Draft from my notes"
  // assist that starts from scratch). The agent emits MJML; we resolve live
  // tokens, compile and derive a subject. NEVER sends.
  ipcHandle(ipcMain, IPC.MAIL_RICH_DRAFT, async (_e, payload: unknown) => {
    const o = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
    const brief = asString(o.brief, 6000).trim()
    if (!brief) {
      return { ok: false as const, error: { code: 'unknown' as const, message: 'Tell the assistant what to write.' } }
    }
    const brand = asString(o.brand, 1000).trim() || undefined
    try {
      // The saved Brand kit rides along as a brand brief so the draft comes out
      // on-brand in one shot (voice/name/palette), on top of any ad-hoc hint.
      const drafted = await draftRichEmail(ensureEmailDraftFn(), brief, metrics, {
        brand,
        brandKit: currentBrandBrief(),
      })
      return { ok: true as const, value: drafted }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The writing assistant failed.'
      return { ok: false as const, error: { code: 'unknown' as const, message } }
    }
  })

  /**
   * Native picker for the workbook an email is built from.
   *
   * Defaults to the workspace so the common case is one click, but does not
   * FORCE it: people keep the model they want to write about outside the
   * workspace, and refusing to read it would be an arbitrary limit. The path is
   * only ever read, never written.
   */
  ipcHandle(ipcMain, IPC.MAIL_PICK_WORKBOOK, async () => {
    const root = getWorkspaceRoot()
    const res = await dialog.showOpenDialog({
      title: 'Build an email from a spreadsheet',
      defaultPath: root ?? undefined,
      properties: ['openFile'],
      filters: [{ name: 'Spreadsheets', extensions: ['xlsx'] }],
    })
    if (res.canceled || res.filePaths.length === 0) return { ok: true as const, value: null }
    return { ok: true as const, value: res.filePaths[0] }
  })

  /**
   * A spreadsheet + an intent → validated email blocks.
   *
   * The agent runs with NO tools (see email-agent-drafter), so it cannot open
   * the file itself — the sheet is extracted here and travels in the prompt.
   * That is deliberate: it bounds what the model sees to the file the user
   * picked, rather than handing a drafting task the run of the filesystem.
   *
   * Output goes through the same `toBlock` coercion the compose surface uses, so
   * a model reply is never trusted further than a renderer payload would be.
   */
  ipcHandle(ipcMain, IPC.MAIL_DRAFT_FROM_FILE, async (_e, payload: unknown) => {
    const o = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
    const filePath = asString(o.filePath, 4096).trim()
    const intent = asString(o.intent, 32) as FromFileIntent
    const instruction = asString(o.instruction, 2000).trim() || undefined
    if (!filePath) {
      return { ok: false as const, error: { code: 'unknown' as const, message: 'Pick a file first.' } }
    }
    if (!INTENTS[intent]) {
      return { ok: false as const, error: { code: 'unknown' as const, message: 'Choose what the email should do.' } }
    }

    const extracted = await extractSheets(filePath)
    if (!extracted.ok || !extracted.sheets) {
      // The reader's reasons are machine-readable; say something a person can act on.
      const why: Record<string, string> = {
        'not-xlsx': 'That is not a .xlsx file.',
        missing: 'That file no longer exists.',
        'too-large': 'That workbook is too large to read.',
        unreadable: 'That workbook could not be opened — is it still being written?',
        empty: 'That workbook has no data in it.',
      }
      const message = why[extracted.reason ?? ''] ?? 'That file could not be read.'
      return { ok: false as const, error: { code: 'unknown' as const, message } }
    }

    try {
      const prompt = buildFromFilePrompt({
        intent,
        fileName: extracted.fileName ?? 'the spreadsheet',
        sheets: extracted.sheets,
        instruction,
        brandKit: currentBrandBrief(),
      })
      const reply = await runEmailPrompt(prompt)
      const blocks = parseBlocksReply(reply).map(toBlock).filter(Boolean)
      if (blocks.length === 0) {
        return {
          ok: false as const,
          error: { code: 'unknown' as const, message: 'The assistant did not return anything usable. Try again, or a different intent.' },
        }
      }
      return {
        ok: true as const,
        value: {
          blocks,
          sheetNames: extracted.sheets.map((s) => s.name),
          truncated: extracted.sheets.some((s) => s.truncated),
        },
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The writing assistant failed.'
      return { ok: false as const, error: { code: 'unknown' as const, message } }
    }
  })

  // Assist an existing draft: the current body + an action → a revised body.
  // 1:1 writing help (tighten/clearer/warmer/add-numbers), not campaign gen.
  ipcHandle(ipcMain, IPC.MAIL_RICH_ASSIST, async (_e, payload: unknown) => {
    const o = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
    const action = asString(o.action, 24) as AssistAction
    const draft = asString(o.draft, 12_000)
    const instruction = asString(o.instruction, 2000).trim() || undefined
    try {
      const body = await runAssist(ensureAssistFn(), {
        action,
        draft,
        instruction,
        brandKit: currentBrandBrief(),
      })
      return { ok: true as const, value: { body } }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The writing assistant failed.'
      return { ok: false as const, error: { code: 'unknown' as const, message } }
    }
  })

  // The "insert live data" picker source: the workspace's metrics + ranges, and
  // (when an id is given) the block to drop in. No secrets — workspace data only.
  ipcHandle(ipcMain, IPC.MAIL_LIVE_DATA, (_e, payload: unknown) => {
    const o = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
    const metricId = asString(o.metricId, 64).trim()
    const rangeId = asString(o.rangeId, 64).trim()
    if (metricId) return { ok: true as const, value: { block: metricInsertBlock(metricId, metrics) } }
    if (rangeId) return { ok: true as const, value: { block: rangeInsertBlock(rangeId, ranges) } }
    // No id → list what's available for the picker.
    return {
      ok: true as const,
      value: {
        metrics: metrics.list().map((m) => ({ id: m.id, name: m.name, value: m.value })),
        ranges: ranges.list().map((r) => ({ id: r.id, name: r.name, rows: r.values.length, cols: r.values[0]?.length ?? 0 })),
      },
    }
  })

  // ── Autoconfig — email address → resolved IMAP/SMTP settings ───────────────

  // Resolve server settings for an email address: curated table → ISPDB → guess.
  // Returns non-secret connection metadata + the source so the UI can flag a
  // guessed/ISPDB result as "please verify". Never touches credentials.
  ipcHandle(ipcMain, IPC.MAIL_AUTOCONFIG, async (_e, email: unknown) => {
    const addr = asString(email, 320).trim()
    const result = await resolveAutoconfig(addr, autoconfigFetch)
    if (!result) return { ok: false as const, error: { code: 'not-found' as const, message: 'Enter a full email address to auto-detect servers.' } }
    return { ok: true as const, value: result }
  })

  // ── OAuth (Google XOAUTH2) — alternative auth path; app-password stays default ─

  // Cheap probe so the UI can show/hide "Sign in with Google" and, when it's not
  // configured, point the user at where to set the client id.
  ipcHandle(ipcMain, IPC.MAIL_OAUTH_CONFIGURED, () => ({
    configured: isGoogleOAuthConfigured(userDataDir()),
  }))

  // Run the loopback OAuth flow, then persist an xoauth2 account whose stored
  // secret is the REFRESH TOKEN (safeStorage-encrypted). No token is ever logged
  // or returned to the renderer — only the non-secret account record.
  ipcHandle(ipcMain, IPC.MAIL_OAUTH_GOOGLE, async (_e, payload: unknown) => {
    const clientId = resolveGoogleClientId(userDataDir())
    if (!clientId) {
      return {
        ok: false as const,
        error: {
          code: 'unavailable' as const,
          message:
            'Google sign-in is not configured. Set GOOGLE_OAUTH_CLIENT_ID or add a client id to google-oauth.json in the app data folder.',
        },
      }
    }
    const o = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
    const imapRaw = (o.imap && typeof o.imap === 'object' ? o.imap : {}) as Record<string, unknown>
    const smtpRaw = (o.smtp && typeof o.smtp === 'object' ? o.smtp : null) as Record<string, unknown> | null

    const flow = await runGoogleOAuthFlow({ clientId, fetchFn: nodeFetch })
    if (!flow.ok) return flow

    const refreshToken = flow.value.tokens.refreshToken
    if (!refreshToken) {
      return {
        ok: false as const,
        error: {
          code: 'auth' as const,
          message: 'Google did not return a refresh token. Remove the app under Google Account → Security and try again.',
        },
      }
    }

    // The account user comes from the renderer (the Gmail address the user typed);
    // Gmail hosts are fixed presets. authKind is xoauth2; the secret is the token.
    const user = asString(o.user, 320).trim()
    const account = await ensureStore().add(
      {
        displayName: asString(o.displayName, 200) || user,
        user,
        authKind: 'xoauth2',
        imap: {
          host: asString(imapRaw.host, 255) || 'imap.gmail.com',
          port: asPort(imapRaw.port, 993),
          tls: imapRaw.tls !== false,
        },
        smtp: {
          host: smtpRaw ? asString(smtpRaw.host, 255) || 'smtp.gmail.com' : 'smtp.gmail.com',
          port: smtpRaw ? asPort(smtpRaw.port, 465) : 465,
          tls: smtpRaw ? smtpRaw.tls !== false : true,
        },
      },
      refreshToken,
    )
    ensureService().invalidate()
    return { ok: true as const, value: account }
  })

  // ── OAuth (Microsoft XOAUTH2) — REQUIRED for consumer Outlook/Hotmail/Live/MSN ─
  // Microsoft disabled basic-auth IMAP/SMTP (passwords AND app-passwords) in 2024,
  // so this is the ONLY working path for those accounts. Mirrors the Google pair.

  // Cheap probe so the UI can show/hide "Sign in with Microsoft" and, when it's
  // not configured, point the user at where to set the client id.
  // Save an OAuth client id from the UI, so connecting Outlook/Gmail no longer
  // requires hand-creating a JSON file in a folder the user cannot see.
  ipcHandle(ipcMain, IPC.MAIL_OAUTH_SET_CLIENT_ID, (_e, provider: unknown, clientId: unknown) => {
    if (provider !== 'google' && provider !== 'microsoft') {
      throw new IpcValidationError('Unknown OAuth provider')
    }
    if (typeof clientId !== 'string' || !clientId.trim()) {
      throw new IpcValidationError('Client id must not be empty')
    }
    if (!looksLikeClientId(provider, clientId)) {
      throw new IpcValidationError(
        provider === 'microsoft'
          ? 'That does not look like an Azure Application (client) ID — it should be a GUID like 11111111-2222-3333-4444-555555555555'
          : 'That does not look like a Google client id — it should end in .apps.googleusercontent.com',
      )
    }
    saveClientId(userDataDir(), provider as OAuthProvider, clientId)
    return { ok: true }
  })

  ipcHandle(ipcMain, IPC.MAIL_OAUTH_MICROSOFT_CONFIGURED, () => ({
    configured: isMicrosoftOAuthConfigured(userDataDir()),
  }))

  // Run the loopback OAuth flow, then persist an xoauth2 account (authProvider:
  // 'microsoft') whose stored secret is the REFRESH TOKEN (safeStorage-encrypted).
  // No token is ever logged or returned to the renderer — only the account record.
  ipcHandle(ipcMain, IPC.MAIL_OAUTH_MICROSOFT, async (_e, payload: unknown) => {
    const clientId = resolveMicrosoftClientId(userDataDir())
    if (!clientId) {
      return {
        ok: false as const,
        error: {
          code: 'unavailable' as const,
          message:
            'Microsoft sign-in is not configured. Set MICROSOFT_OAUTH_CLIENT_ID or add a client id to microsoft-oauth.json in the app data folder.',
        },
      }
    }
    const o = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
    const imapRaw = (o.imap && typeof o.imap === 'object' ? o.imap : {}) as Record<string, unknown>
    const smtpRaw = (o.smtp && typeof o.smtp === 'object' ? o.smtp : null) as Record<string, unknown> | null

    const flow = await runMicrosoftOAuthFlow({ clientId, fetchFn: nodeFetch })
    if (!flow.ok) return flow

    const refreshToken = flow.value.tokens.refreshToken
    if (!refreshToken) {
      return {
        ok: false as const,
        error: {
          code: 'auth' as const,
          message:
            'Microsoft did not return a refresh token. Remove the app under your Microsoft account privacy settings and try again.',
        },
      }
    }

    // The account user is the Outlook address the user typed; consumer hosts are
    // fixed presets. authKind xoauth2 + authProvider microsoft; secret = the token.
    const user = asString(o.user, 320).trim()
    const account = await ensureStore().add(
      {
        displayName: asString(o.displayName, 200) || user,
        user,
        authKind: 'xoauth2',
        authProvider: 'microsoft',
        imap: {
          host: asString(imapRaw.host, 255) || 'outlook.office365.com',
          port: asPort(imapRaw.port, 993),
          tls: imapRaw.tls !== false,
        },
        smtp: {
          host: smtpRaw ? asString(smtpRaw.host, 255) || 'smtp-mail.outlook.com' : 'smtp-mail.outlook.com',
          port: smtpRaw ? asPort(smtpRaw.port, 587) : 587,
          tls: smtpRaw ? smtpRaw.tls !== false : true,
        },
      },
      refreshToken,
    )
    ensureService().invalidate()
    return { ok: true as const, value: account }
  })
}
