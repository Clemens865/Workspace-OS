import fs from 'fs'
import path from 'path'
import type { SecretStore } from './secret-store'

/**
 * Canonical, generic secret vault for Workspace OS.
 *
 * SECURITY — the invariants this file exists to enforce:
 *   - `secrets.json` holds ONLY `{ [name]: base64(ciphertext) }`. No plaintext
 *     secret is ever written to disk in any form.
 *   - The file is written `mode 0o600` (owner read/write only).
 *   - `list()` returns key NAMES and metadata only — NEVER values.
 *   - `get(name)` is the ONLY method that decrypts; it is called only in main,
 *     only at spawn time, and the caller must let the plaintext go out of scope
 *     promptly and never log it.
 *   - If secure storage is unavailable (e.g. Linux `basic_text` backend),
 *     `set()` REFUSES with a clear error rather than persisting plaintext.
 *
 * The store dir and SecretStore backend are injected so the vault is
 * pure-testable against a temp dir with a mocked SecretStore — no Electron.
 */

const SECRETS_FILE = 'secrets.json'

/** On-disk shape: opaque base64 ciphertext keyed by secret name. Never plaintext. */
type SecretsMap = Record<string, string>

/** Non-secret info about a stored key — safe to return to the renderer/UI. */
export interface SecretMeta {
  /** The key name (e.g. GITHUB_PERSONAL_ACCESS_TOKEN). NOT the value. */
  name: string
}

/** A valid secret key name: env-var-shaped, bounded. Prevents junk keys. */
const KEY_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/

export function isValidSecretName(name: unknown): name is string {
  return typeof name === 'string' && KEY_NAME_RE.test(name)
}

const MAX_SECRET_CHARS = 8192

export class Vault {
  constructor(
    private readonly storeDir: string,
    private readonly secrets: SecretStore,
  ) {}

  private secretsPath(): string {
    return path.join(this.storeDir, SECRETS_FILE)
  }

  private readMap(): SecretsMap {
    try {
      const raw = fs.readFileSync(this.secretsPath(), 'utf-8')
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      // Keep only well-shaped entries: a valid name → a base64 string.
      const out: SecretsMap = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (isValidSecretName(k) && typeof v === 'string') out[k] = v
      }
      return out
    } catch {
      return {}
    }
  }

  private writeMap(map: SecretsMap): void {
    fs.mkdirSync(this.storeDir, { recursive: true })
    // 0o600: owner-only. The file holds ciphertext, but least-privilege anyway.
    fs.writeFileSync(this.secretsPath(), JSON.stringify(map, null, 2), { encoding: 'utf-8', mode: 0o600 })
    // A pre-existing file created with a laxer umask keeps its old mode on
    // rewrite; force it back to 0o600 explicitly.
    try { fs.chmodSync(this.secretsPath(), 0o600) } catch { /* best-effort */ }
  }

  /** Whether secrets can be stored securely right now (and the backend name). */
  status(): { available: boolean; backend: string } {
    return { available: this.secrets.isAvailable(), backend: this.secrets.backend() }
  }

  /** Key NAMES + metadata only — NEVER values. Sorted for stable UI. */
  list(): SecretMeta[] {
    return Object.keys(this.readMap())
      .sort()
      .map((name) => ({ name }))
  }

  /** True if a secret with this name is stored (no value exposed). */
  has(name: string): boolean {
    return isValidSecretName(name) && name in this.readMap()
  }

  /**
   * Encrypts and stores a secret under `name`. REFUSES (throws) if secure
   * storage is unavailable — never silently persists plaintext.
   */
  set(name: string, value: string): void {
    if (!isValidSecretName(name)) throw new Error('Invalid secret name')
    if (typeof value !== 'string' || value.length === 0) throw new Error('Secret value must be a non-empty string')
    if (value.length > MAX_SECRET_CHARS) throw new Error('Secret value too long')
    if (!this.secrets.isAvailable()) {
      throw new Error(
        `Secure credential storage is unavailable (backend: ${this.secrets.backend()}). Refusing to store the secret as plaintext.`,
      )
    }
    const cipher = this.secrets.encrypt(value)
    const map = this.readMap()
    map[name] = cipher.toString('base64')
    this.writeMap(map)
  }

  /** Removes a stored secret. No-op if absent. */
  remove(name: string): void {
    if (!isValidSecretName(name)) return
    const map = this.readMap()
    if (name in map) {
      delete map[name]
      this.writeMap(map)
    }
  }

  /**
   * Decrypts and returns the plaintext for `name`, or null if absent.
   *
   * THE ONLY PATH plaintext exists in-process. Callers (only the spawn wiring)
   * must never log it and must let it go out of scope immediately after handing
   * it to the child env.
   */
  get(name: string): string | null {
    if (!isValidSecretName(name)) return null
    const b64 = this.readMap()[name]
    if (!b64) return null
    if (!this.secrets.isAvailable()) {
      throw new Error('Secure credential storage is unavailable — cannot decrypt.')
    }
    return this.secrets.decrypt(Buffer.from(b64, 'base64'))
  }
}
