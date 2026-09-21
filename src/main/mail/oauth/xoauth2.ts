/**
 * SASL XOAUTH2 initial-client-response — shared by Google and Microsoft.
 *
 * Both IMAP and SMTP use the same wire format regardless of provider, so this
 * helper lives once. imapflow/nodemailer accept a plain access token, but this
 * exact-bytes helper is unit-tested so the wire format is proven independently.
 */

/**
 * Builds the SASL XOAUTH2 initial-client-response string (base64):
 * `user=<email>^Aauth=Bearer <token>^A^A` where ^A is 0x01.
 */
export function buildXoauth2Token(user: string, accessToken: string): string {
  const raw = `user=${user}\x01auth=Bearer ${accessToken}\x01\x01`
  return Buffer.from(raw, 'utf-8').toString('base64')
}
