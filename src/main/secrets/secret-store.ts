import { safeStorage } from 'electron'

/**
 * The narrow encryption backend the {@link Vault} depends on. In the app this
 * is Electron `safeStorage` (OS keychain — Keychain on macOS, DPAPI on Windows,
 * libsecret/kwallet on Linux). In tests it is a mock. The vault never touches a
 * keychain directly, only this swappable interface, so it stays pure-testable.
 */
export interface SecretStore {
  /**
   * True only when encryption is actually available AND backed by a real OS
   * secret store. On Linux `safeStorage` can silently fall back to the
   * `basic_text` backend (effectively PLAINTEXT, obfuscated with a hardcoded
   * key). This MUST report false in that case so the vault refuses to store —
   * never silently persisting a "secret" that anyone can read.
   */
  isAvailable(): boolean
  /** Plaintext secret → opaque ciphertext buffer. */
  encrypt(plaintext: string): Buffer
  /** Ciphertext buffer → plaintext secret. The only path plaintext reappears. */
  decrypt(ciphertext: Buffer): string
  /** The concrete storage backend name (diagnostic — surfaced in the UI). */
  backend(): string
}

/**
 * Linux backends that mean "no real OS keychain". `basic_text` is the
 * dangerous one (plaintext with a constant key); `unknown` is unproven, so we
 * refuse it too rather than assume it is secure.
 */
const INSECURE_BACKENDS = new Set(['basic_text', 'unknown'])

/**
 * Reports the selected storage backend. On macOS/Windows `getSelectedStorageBackend`
 * is not meaningful and returns 'unknown'; there `isEncryptionAvailable()` alone is
 * authoritative. We only treat a backend as disqualifying on Linux, where the
 * plaintext fallback actually exists.
 */
function selectedBackend(): string {
  try {
    return safeStorage.getSelectedStorageBackend()
  } catch {
    return 'unknown'
  }
}

/**
 * SecretStore backed by Electron `safeStorage`. Ciphertext produced here can
 * only be decrypted on the same machine/user account, so the base64 blobs the
 * vault writes to disk are useless if exfiltrated. This is the ONLY file in the
 * secrets module that imports Electron; kept thin so the vault stays runtime-agnostic.
 */
export const safeSecretStore: SecretStore = {
  isAvailable(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false
    // Only Linux exposes the plaintext `basic_text` fallback. On that platform,
    // refuse anything that isn't a real secret backend.
    if (process.platform === 'linux' && INSECURE_BACKENDS.has(selectedBackend())) {
      return false
    }
    return true
  },
  encrypt(plaintext: string): Buffer {
    return safeStorage.encryptString(plaintext)
  },
  decrypt(ciphertext: Buffer): string {
    return safeStorage.decryptString(ciphertext)
  },
  backend(): string {
    return selectedBackend()
  },
}
