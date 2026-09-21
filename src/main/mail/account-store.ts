import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'

/**
 * Persistent store for IMAP/SMTP account configuration.
 *
 * SECURITY — the single most important invariant in this file:
 *   The account record persisted to userData JSON holds ONLY non-secret
 *   connection metadata (host/port/user/tls/displayName/folders). The password
 *   or OAuth token is NEVER written into that JSON. Secrets are handed to a
 *   pluggable {@link SecretStore} (backed by Electron `safeStorage` in the app —
 *   OS-keychain-encrypted) and stored in a SEPARATE file as opaque ciphertext,
 *   keyed by account id. The record and the secret can therefore only ever be
 *   correlated through the account id, and the plaintext secret exists on disk
 *   in no form.
 *
 * The store takes its userData directory and secret backend by injection so it
 * is pure-testable against a temp dir with a mocked SecretStore — no Electron.
 */

/** How the account authenticates. `basic` = password/app-password.
 *  `xoauth2` = OAuth2 refresh-token flow (Google or Microsoft).
 *  `demo` = a built-in, seeded in-memory mailbox with NO secret and NO network —
 *  it never resolves a config, never calls getSecret, and never hits a server. */
export type MailAuthKind = 'basic' | 'xoauth2' | 'demo'

/**
 * Which OAuth identity provider an xoauth2 account refreshes against. Determines
 * the token endpoint + client id used by the token manager. Absent on `basic`
 * accounts. EXISTING xoauth2 accounts (written before this tag) have no value —
 * callers MUST default a missing/unknown value to 'google' so no migration is
 * needed and no signed-in Gmail account breaks.
 */
export type MailAuthProvider = 'google' | 'microsoft'

/**
 * A non-secret account record. This is EXACTLY the shape persisted to JSON —
 * note the deliberate absence of any password/secret/token field. Adding one
 * here would be the bug this whole design exists to prevent.
 */
export interface MailAccount {
  id: string
  displayName: string
  /** The email address / login username. Not itself a secret, but never logged. */
  user: string
  authKind: MailAuthKind
  /**
   * For xoauth2 accounts: which identity provider to refresh against. Optional so
   * pre-existing records (all Google) stay valid — a missing value means 'google'.
   */
  authProvider?: MailAuthProvider
  imap: { host: string; port: number; tls: boolean }
  /** SMTP config is stored now (compose phase wires it); send is NOT built yet. */
  smtp?: { host: string; port: number; tls: boolean } | null
  createdAt: number
  updatedAt: number
}

/** Input for creating/updating an account. The secret is separate on purpose. */
export interface MailAccountInput {
  displayName: string
  user: string
  authKind?: MailAuthKind
  /** Only meaningful for xoauth2; defaults to 'google' on read when absent. */
  authProvider?: MailAuthProvider
  imap: { host: string; port: number; tls: boolean }
  smtp?: { host: string; port: number; tls: boolean } | null
}

/**
 * Backend that encrypts/decrypts a secret at rest. In the app this is Electron
 * `safeStorage` (OS keychain). In tests it is a mock. The store never sees a
 * keychain directly — only this narrow, swappable interface.
 */
export interface SecretStore {
  /** True when encryption is actually available (keychain unlocked etc.). */
  isAvailable(): boolean
  /** Plaintext secret → opaque ciphertext buffer (safeStorage.encryptString). */
  encrypt(plaintext: string): Buffer
  /** Ciphertext buffer → plaintext secret (safeStorage.decryptString). */
  decrypt(ciphertext: Buffer): string
}

const ACCOUNTS_FILE = 'mail-accounts.json'
const SECRETS_FILE = 'mail-secrets.json'

/** On-disk secrets map: { [accountId]: base64(ciphertext) }. Opaque — never plaintext. */
type SecretsMap = Record<string, string>

export class MailAccountStore {
  constructor(
    private readonly userDataDir: string,
    private readonly secrets: SecretStore,
  ) {}

  private accountsPath(): string {
    return path.join(this.userDataDir, ACCOUNTS_FILE)
  }

  private secretsPath(): string {
    return path.join(this.userDataDir, SECRETS_FILE)
  }

  private async readAccounts(): Promise<MailAccount[]> {
    try {
      const raw = await fs.readFile(this.accountsPath(), 'utf-8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as MailAccount[]) : []
    } catch {
      return []
    }
  }

  private async writeAccounts(accounts: MailAccount[]): Promise<void> {
    await fs.mkdir(this.userDataDir, { recursive: true })
    // 0o600: readable only by the owner. Belt-and-braces even though it holds no secret.
    await fs.writeFile(this.accountsPath(), JSON.stringify(accounts, null, 2), { encoding: 'utf-8', mode: 0o600 })
  }

  private async readSecrets(): Promise<SecretsMap> {
    try {
      const raw = await fs.readFile(this.secretsPath(), 'utf-8')
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? (parsed as SecretsMap) : {}
    } catch {
      return {}
    }
  }

  private async writeSecrets(map: SecretsMap): Promise<void> {
    await fs.mkdir(this.userDataDir, { recursive: true })
    await fs.writeFile(this.secretsPath(), JSON.stringify(map, null, 2), { encoding: 'utf-8', mode: 0o600 })
  }

  /** All accounts (non-secret metadata only), most recently added first. */
  async list(): Promise<MailAccount[]> {
    const accounts = await this.readAccounts()
    return accounts.sort((a, b) => b.createdAt - a.createdAt)
  }

  async get(id: string): Promise<MailAccount | null> {
    const accounts = await this.readAccounts()
    return accounts.find((a) => a.id === id) ?? null
  }

  /**
   * Adds an account. The plaintext `secret` is encrypted via the SecretStore and
   * persisted to the SEPARATE secrets file — it is never placed on the returned
   * record nor written into the accounts JSON.
   */
  async add(input: MailAccountInput, secret: string): Promise<MailAccount> {
    if (!this.secrets.isAvailable()) {
      throw new Error('Secure credential storage is unavailable on this system')
    }
    const now = Date.now()
    const authKind = input.authKind ?? 'basic'
    const account: MailAccount = {
      id: crypto.randomBytes(12).toString('hex'),
      displayName: input.displayName,
      user: input.user,
      authKind,
      // Tag the provider only for xoauth2 accounts (basic accounts never refresh).
      ...(authKind === 'xoauth2' ? { authProvider: input.authProvider ?? 'google' } : {}),
      imap: input.imap,
      smtp: input.smtp ?? null,
      createdAt: now,
      updatedAt: now,
    }

    // Encrypt + store the secret FIRST, keyed by id, in its own file.
    const cipher = this.secrets.encrypt(secret)
    const secrets = await this.readSecrets()
    secrets[account.id] = cipher.toString('base64')
    await this.writeSecrets(secrets)

    const accounts = await this.readAccounts()
    accounts.push(account)
    await this.writeAccounts(accounts)
    return account
  }

  /**
   * Adds the built-in DEMO account. Unlike {@link add}, this stores NO secret —
   * it never touches the SecretStore (so it works even when the keychain is
   * unavailable) and it writes no entry to the secrets file. The persisted record
   * carries `authKind: 'demo'`; MailService routes it to the in-memory demo
   * backend and never resolves a live config for it.
   */
  async addDemo(input: { displayName: string; user: string }): Promise<MailAccount> {
    const now = Date.now()
    const account: MailAccount = {
      id: crypto.randomBytes(12).toString('hex'),
      displayName: input.displayName,
      user: input.user,
      authKind: 'demo',
      imap: { host: '', port: 0, tls: false },
      // A non-null smtp so the compose / reply / triage affordances light up —
      // the demo send path never actually opens this socket.
      smtp: { host: '', port: 0, tls: false },
      createdAt: now,
      updatedAt: now,
    }
    const accounts = await this.readAccounts()
    accounts.push(account)
    await this.writeAccounts(accounts)
    return account
  }

  /** Updates non-secret metadata. If `secret` is given, re-encrypts it. */
  async update(id: string, patch: Partial<MailAccountInput>, secret?: string): Promise<MailAccount> {
    const accounts = await this.readAccounts()
    const idx = accounts.findIndex((a) => a.id === id)
    if (idx === -1) throw new Error('Account not found')
    const prev = accounts[idx]
    const next: MailAccount = {
      ...prev,
      displayName: patch.displayName ?? prev.displayName,
      user: patch.user ?? prev.user,
      authKind: patch.authKind ?? prev.authKind,
      authProvider: patch.authProvider ?? prev.authProvider,
      imap: patch.imap ?? prev.imap,
      smtp: patch.smtp === undefined ? prev.smtp : patch.smtp,
      updatedAt: Date.now(),
    }
    accounts[idx] = next
    await this.writeAccounts(accounts)

    if (secret !== undefined) {
      if (!this.secrets.isAvailable()) {
        throw new Error('Secure credential storage is unavailable on this system')
      }
      const secrets = await this.readSecrets()
      secrets[id] = this.secrets.encrypt(secret).toString('base64')
      await this.writeSecrets(secrets)
    }
    return next
  }

  /** Removes the account AND its stored secret. */
  async remove(id: string): Promise<void> {
    const accounts = await this.readAccounts()
    await this.writeAccounts(accounts.filter((a) => a.id !== id))
    const secrets = await this.readSecrets()
    if (id in secrets) {
      delete secrets[id]
      await this.writeSecrets(secrets)
    }
  }

  /**
   * Decrypts and returns the plaintext secret for an account. This is the only
   * path plaintext ever exists in-process; callers must treat it as sensitive
   * (never log it) and let it go out of scope promptly.
   */
  async getSecret(id: string): Promise<string | null> {
    const secrets = await this.readSecrets()
    const b64 = secrets[id]
    if (!b64) return null
    if (!this.secrets.isAvailable()) {
      throw new Error('Secure credential storage is unavailable on this system')
    }
    return this.secrets.decrypt(Buffer.from(b64, 'base64'))
  }
}
