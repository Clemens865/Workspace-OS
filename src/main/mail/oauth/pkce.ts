import crypto from 'crypto'

/**
 * PKCE (RFC 7636) + state helpers for the installed-app / loopback OAuth flow.
 *
 * Shared by BOTH the Google and Microsoft OAuth modules so the S256 logic exists
 * exactly once. Pure, Electron-free, and unit-tested against the RFC's known
 * vector — no network, no secrets held here.
 */

/** base64url without padding — the encoding PKCE (and every OAuth provider) requires. */
export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Creates a high-entropy PKCE code verifier: 32 random bytes → base64url
 * (43 chars), within the RFC's 43–128 unreserved-character range.
 */
export function createVerifier(): string {
  return base64url(crypto.randomBytes(32))
}

/** S256 challenge for a verifier: base64url(SHA-256(verifier)). */
export function challengeFromVerifier(verifier: string): string {
  return base64url(crypto.createHash('sha256').update(verifier).digest())
}

/** A random opaque `state` value to bind the auth request to its callback. */
export function createState(): string {
  return base64url(crypto.randomBytes(16))
}
