import { safeStorage } from 'electron'
import type { SecretStore } from './account-store'

/**
 * SecretStore backed by Electron `safeStorage` — the OS keychain (Keychain on
 * macOS, DPAPI on Windows, libsecret on Linux). Ciphertext produced here can
 * only be decrypted on the same machine/user account, so the base64 blobs the
 * account-store writes to disk are useless if exfiltrated.
 *
 * This is the only file in the mail module that touches Electron, kept thin so
 * the store logic stays runtime-agnostic and unit-testable with a mock.
 */
export const safeSecretStore: SecretStore = {
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  },
  encrypt(plaintext: string): Buffer {
    return safeStorage.encryptString(plaintext)
  },
  decrypt(ciphertext: Buffer): string {
    return safeStorage.decryptString(ciphertext)
  },
}
