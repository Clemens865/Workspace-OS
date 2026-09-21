import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  applySignature,
  hasSignature,
  findQuoteStart,
  readSignatures,
  saveSignature,
  SIG_DELIMITER,
} from './signature'

/**
 * Storage is trivial; PLACEMENT is where signatures go wrong, so that is where
 * the tests are. A signature stranded below a long quoted reply is the most
 * visible way a mail client looks amateur.
 */

describe('SIG_DELIMITER', () => {
  it('keeps the trailing space required by RFC 3676', () => {
    // Clients fold or grey the signature on "-- \n" exactly. Trimming the space
    // silently disables that everywhere, and nothing visibly breaks in testing.
    expect(SIG_DELIMITER).toBe('-- \n')
    expect(SIG_DELIMITER.endsWith(' \n')).toBe(true)
  })
})

describe('findQuoteStart', () => {
  it('finds a ">" quote block', () => {
    const body = 'Hi\n\n> original text'
    expect(body.slice(findQuoteStart(body))).toBe('> original text')
  })

  it('finds the English attribution line and puts the signature ABOVE it', () => {
    const body = 'Thanks\n\nOn Tue, 5 Aug 2026 at 10:00, Ana wrote:\n> hello'
    expect(body.slice(findQuoteStart(body)).startsWith('On Tue')).toBe(true)
  })

  it('finds the German attribution, which this mailbox is full of', () => {
    const body = 'Danke\n\nAm 05.08.2026 um 10:00 schrieb Ana:\n> hallo'
    expect(body.slice(findQuoteStart(body)).startsWith('Am 05')).toBe(true)
  })

  it('returns -1 when there is no quote', () => {
    expect(findQuoteStart('Just a new message')).toBe(-1)
  })

  it('does not mistake ordinary prose for an attribution', () => {
    // "On Monday we agreed..." is not a quote header.
    expect(findQuoteStart('On Monday we agreed to ship it')).toBe(-1)
    expect(findQuoteStart('Am Freitag ist Feiertag')).toBe(-1)
  })
})

describe('applySignature', () => {
  const SIG = 'Clemens Hönig\nWorkspace OS'

  it('appends to a plain new message', () => {
    const out = applySignature('Hello there', SIG)
    expect(out).toBe(`Hello there\n\n${SIG_DELIMITER}${SIG}\n`)
  })

  it('inserts ABOVE the quoted original in a reply', () => {
    const body = 'Sounds good.\n\nOn Tue, 5 Aug 2026 at 10:00, Ana wrote:\n> the original'
    const out = applySignature(body, SIG)
    expect(out.indexOf(SIG)).toBeLessThan(out.indexOf('On Tue'))
    expect(out.indexOf(SIG)).toBeLessThan(out.indexOf('> the original'))
  })

  it('keeps the quoted original intact', () => {
    const body = 'Reply\n\n> keep me exactly\n> and me'
    const out = applySignature(body, SIG)
    expect(out).toContain('> keep me exactly\n> and me')
  })

  it('keeps what the user typed', () => {
    const body = 'My careful reply\n\n> original'
    expect(applySignature(body, SIG)).toContain('My careful reply')
  })

  it('is idempotent — applying twice does not sign twice', () => {
    // Compose UIs re-render and drafts reload; a non-idempotent append produces
    // the double-signed mail everyone has seen in the wild.
    const once = applySignature('Hi', SIG)
    const twice = applySignature(once, SIG)
    expect(twice).toBe(once)
    expect(twice.split('Workspace OS').length - 1).toBe(1)
  })

  it('does nothing when there is no signature configured', () => {
    expect(applySignature('Hi', '')).toBe('Hi')
    expect(applySignature('Hi', '   ')).toBe('Hi')
  })

  it('handles an empty body', () => {
    expect(applySignature('', SIG)).toContain(SIG)
  })

  it('does not leave a pile of blank lines before the signature', () => {
    const out = applySignature('Hi\n\n\n\n\n\n> quote', SIG)
    expect(out).not.toMatch(/\n{4,}--/)
  })
})

describe('hasSignature', () => {
  it('detects an already-signed body', () => {
    expect(hasSignature('Hi\n\n-- \nAna', 'Ana')).toBe(true)
  })
  it('is false for an unsigned body', () => {
    expect(hasSignature('Hi', 'Ana')).toBe(false)
  })
  it('is false for an empty signature', () => {
    expect(hasSignature('Hi', '')).toBe(false)
  })
})

describe('storage', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-sig-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('round-trips per account', () => {
    saveSignature(dir, 'acct-1', 'Ana')
    saveSignature(dir, 'acct-2', 'Bo')
    expect(readSignatures(dir)).toEqual({ 'acct-1': 'Ana', 'acct-2': 'Bo' })
  })

  it('an empty signature removes it rather than storing blank', () => {
    saveSignature(dir, 'acct-1', 'Ana')
    saveSignature(dir, 'acct-1', '   ')
    expect(readSignatures(dir)['acct-1']).toBeUndefined()
  })

  it('is an empty map when nothing was ever saved', () => {
    expect(readSignatures(dir)).toEqual({})
  })

  it('survives a corrupt file rather than throwing into compose', () => {
    fs.writeFileSync(path.join(dir, 'mail-signatures.json'), 'not json {')
    expect(readSignatures(dir)).toEqual({})
  })

  it('writes 0600 — it is personal config', () => {
    saveSignature(dir, 'a', 'x')
    const mode = fs.statSync(path.join(dir, 'mail-signatures.json')).mode & 0o777
    expect(mode).toBe(0o600)
  })
})
