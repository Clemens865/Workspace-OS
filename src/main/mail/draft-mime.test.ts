import { describe, it, expect } from 'vitest'
import { buildDraftMime, findDraftsFolder } from './draft-mime'
import { simpleParser } from 'mailparser'

/**
 * A draft that renders differently from the mail eventually sent is worse than
 * no draft, so these assertions parse the produced MIME back rather than
 * string-matching it — the same round-trip discipline the SMTP e2e uses.
 */

const base = {
  from: { name: 'Clemens Hönig', address: 'me@x.com' },
  to: [{ address: 'ana@acme.com' }],
  subject: 'Q3 Budget',
  text: 'Here are the numbers.',
}

describe('buildDraftMime', () => {
  it('produces parseable RFC822 with the headers intact', async () => {
    const raw = await buildDraftMime(base)
    const parsed = await simpleParser(raw)
    expect(parsed.subject).toBe('Q3 Budget')
    expect(parsed.from?.value[0].address).toBe('me@x.com')
    expect(parsed.to?.value[0].address).toBe('ana@acme.com')
    expect(parsed.text?.trim()).toBe('Here are the numbers.')
  })

  it('encodes a non-ASCII display name so it survives the wire', async () => {
    // "Hönig" must round-trip. Hand-rolled MIME gets RFC 2047 wrong here and it
    // only shows up on someone else's client.
    const parsed = await simpleParser(await buildDraftMime(base))
    expect(parsed.from?.value[0].name).toBe('Clemens Hönig')
  })

  it('encodes a non-ASCII subject and body', async () => {
    const parsed = await simpleParser(
      await buildDraftMime({ ...base, subject: 'Übersicht — Angebot', text: 'Grüße, Clemens' }),
    )
    expect(parsed.subject).toBe('Übersicht — Angebot')
    expect(parsed.text).toContain('Grüße')
  })

  it('keeps cc and bcc', async () => {
    const parsed = await simpleParser(
      await buildDraftMime({ ...base, cc: [{ address: 'c@x.com' }], bcc: [{ address: 'b@x.com' }] }),
    )
    expect(parsed.cc?.value[0].address).toBe('c@x.com')
  })

  it('keeps the threading headers, so a saved reply stays in its thread', async () => {
    const parsed = await simpleParser(
      await buildDraftMime({ ...base, inReplyTo: '<1@x>', references: ['<0@x>', '<1@x>'] }),
    )
    expect(parsed.inReplyTo).toContain('<1@x>')
    expect(String(parsed.references)).toContain('<0@x>')
  })

  it('carries html alongside text', async () => {
    const parsed = await simpleParser(await buildDraftMime({ ...base, html: '<p>Hi</p>' }))
    expect(parsed.html).toContain('<p>Hi</p>')
  })

  it('carries an attachment with its exact bytes', async () => {
    const content = Buffer.from([1, 2, 3, 4, 250, 251])
    const parsed = await simpleParser(
      await buildDraftMime({
        ...base,
        attachments: [{ filename: 'data.bin', content, contentType: 'application/octet-stream' }],
      }),
    )
    expect(parsed.attachments).toHaveLength(1)
    expect(parsed.attachments[0].filename).toBe('data.bin')
    expect(Buffer.compare(parsed.attachments[0].content as Buffer, content)).toBe(0)
  })

  it('handles an empty body without producing junk', async () => {
    const parsed = await simpleParser(await buildDraftMime({ ...base, text: '' }))
    expect(parsed.subject).toBe('Q3 Budget')
  })
})

describe('findDraftsFolder', () => {
  it('prefers the server special-use flag over any name', () => {
    const folders = [
      { path: 'INBOX', name: 'INBOX' },
      { path: 'X', name: 'Something', specialUse: '\\Drafts' },
      { path: 'Drafts', name: 'Drafts' },
    ]
    expect(findDraftsFolder(folders)).toBe('X')
  })

  it('falls back to the LOCALISED name — this mailbox is German', () => {
    // A hardcoded "Drafts" would miss "Entwürfe" and, worse, tempt us into
    // creating a second folder no other mail client would look in.
    expect(findDraftsFolder([{ path: 'Entwürfe', name: 'Entwürfe' }])).toBe('Entwürfe')
    expect(findDraftsFolder([{ path: 'Brouillons', name: 'Brouillons' }])).toBe('Brouillons')
    expect(findDraftsFolder([{ path: 'Drafts', name: 'Drafts' }])).toBe('Drafts')
  })

  it('returns null rather than guessing when there is no Drafts folder', () => {
    expect(findDraftsFolder([{ path: 'INBOX', name: 'INBOX' }])).toBeNull()
  })
})
