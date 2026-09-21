import MailComposer from 'nodemailer/lib/mail-composer/index.js'
import type { OutgoingMessage } from './types'

/**
 * Builds RFC822 bytes for a message WITHOUT sending it — the input to an IMAP
 * APPEND into Drafts.
 *
 * Reuses nodemailer's own composer rather than assembling MIME by hand. The
 * SMTP path already trusts it to encode headers, multipart bodies, attachments
 * and non-ASCII correctly; hand-rolling a second encoder for drafts would mean
 * a draft that renders differently from the mail eventually sent, and would get
 * the fiddly parts (RFC 2047 header encoding, boundary generation, quoted
 * printable) wrong in ways that only show up on someone else's client.
 *
 * `compile().build()` performs no network I/O — it is a pure serialisation.
 */
export async function buildDraftMime(message: OutgoingMessage): Promise<Buffer> {
  const composer = new MailComposer({
    from: toAddr(message.from),
    to: message.to.map(toAddr),
    cc: message.cc?.map(toAddr),
    bcc: message.bcc?.map(toAddr),
    subject: message.subject,
    text: message.text,
    html: message.html || undefined,
    inReplyTo: message.inReplyTo,
    references: message.references,
    attachments: message.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
      // Keep inline images inline in the saved draft too.
      ...(a.cid ? { cid: a.cid } : {}),
    })),
  })

  return new Promise((resolve, reject) => {
    composer.compile().build((err: Error | null, msg: Buffer) => {
      if (err) reject(err)
      else resolve(msg)
    })
  })
}

function toAddr(a: { name?: string; address: string }): string | { name: string; address: string } {
  return a.name ? { name: a.name, address: a.address } : a.address
}

/**
 * Picks the Drafts folder from a folder list.
 *
 * Prefers the server's `\Drafts` special-use flag over the name, because the
 * name is localised — this mailbox calls it "Entwürfe" on a German account —
 * and a hardcoded "Drafts" would either miss it or create a second, wrong
 * folder that no other mail client would ever look in.
 */
export function findDraftsFolder(
  folders: { path: string; name: string; specialUse?: string }[],
): string | null {
  const byFlag = folders.find((f) => (f.specialUse || '').toLowerCase() === '\\drafts')
  if (byFlag) return byFlag.path
  const byName = folders.find((f) => /^(drafts?|entw[uü]rfe|brouillons|borradores)/i.test(f.name))
  return byName?.path ?? null
}
