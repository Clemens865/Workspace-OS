import fs from 'fs/promises'
import path from 'path'
import type { DriveAccess } from './drive-client'

/**
 * The one connected Google Drive: what it can do, and its refresh token.
 *
 * Deliberately ONE account, not a list. Every store in this app that began as a
 * list of accounts is a list with one entry in it, and the second entry brings
 * questions nobody has asked yet — which Drive does "open this file" mean, which
 * one does the agent write to. When somebody genuinely needs two, the answer to
 * those questions will exist and this becomes a list then.
 *
 * The refresh token goes to the OS keychain through the same SecretStore the
 * mail and calendar accounts use; the record on disk carries no secret. That
 * separation is the point, and adding a token field here is the bug this file
 * is shaped to prevent.
 */

/**
 * The same SecretStore the mail and calendar accounts use — safeStorage,
 * injected so this module stays testable without Electron.
 */
export interface SecretStore {
  isAvailable(): boolean
  encrypt(plaintext: string): Buffer
  decrypt(ciphertext: Buffer): string
}

export interface DriveConnection {
  /** The signed-in address, for the card. Not used to authenticate anything. */
  email: string
  /**
   * What the person granted. Stored because it decides what the UI may OFFER:
   * a read-only connection must not show a Save button that will fail at the
   * end of the user's work rather than at the start.
   */
  access: DriveAccess
  connectedAt: string
}

const FILE = 'drive-account.json'
const SECRET_FILE = 'drive-secret.json'

export class DriveAccountStore {
  constructor(
    private readonly userDataDir: string,
    private readonly secrets: SecretStore,
  ) {}

  private get file(): string {
    return path.join(this.userDataDir, FILE)
  }

  private get secretFile(): string {
    return path.join(this.userDataDir, SECRET_FILE)
  }

  async get(): Promise<DriveConnection | null> {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf-8')) as Partial<DriveConnection>
      if (!raw || typeof raw.email !== 'string') return null
      const access: DriveAccess =
        raw.access === 'full' || raw.access === 'readOnly' || raw.access === 'appFiles' ? raw.access : 'readOnly'
      return { email: raw.email, access, connectedAt: String(raw.connectedAt ?? '') }
    } catch {
      // Never connected, or the file was hand-edited into nonsense. Either way
      // there is no connection, which is a state the UI already handles.
      return null
    }
  }

  /**
   * Saves the connection. The token goes to the keychain FIRST.
   *
   * If the keychain write fails, nothing is recorded — a connection card with
   * no token behind it is worse than no card, because it looks connected and
   * fails on every use with an error about a token nobody knew was missing.
   */
  async save(connection: DriveConnection, refreshToken: string): Promise<void> {
    if (!this.secrets.isAvailable()) {
      throw new Error('The OS keychain is unavailable, so the Drive connection cannot be stored safely.')
    }
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    await fs.writeFile(
      this.secretFile,
      JSON.stringify({ refreshToken: this.secrets.encrypt(refreshToken).toString('base64') }),
      'utf-8',
    )
    await fs.writeFile(this.file, JSON.stringify(connection, null, 2), 'utf-8')
  }

  async refreshToken(): Promise<string | null> {
    try {
      const { refreshToken } = JSON.parse(await fs.readFile(this.secretFile, 'utf-8')) as { refreshToken?: string }
      if (typeof refreshToken !== 'string') return null
      return this.secrets.decrypt(Buffer.from(refreshToken, 'base64'))
    } catch {
      // Absent, or encrypted on another machine / under a rotated key. Either
      // way the caller must reconnect, which is what null means here.
      return null
    }
  }

  /** Forgets the connection. The token goes first, for the same reason. */
  async disconnect(): Promise<void> {
    await fs.rm(this.secretFile, { force: true })
    await fs.rm(this.file, { force: true })
  }
}

/** True when this connection may write. Read-only must not offer to save. */
export function canWrite(connection: DriveConnection | null): boolean {
  return connection?.access === 'full'
}
