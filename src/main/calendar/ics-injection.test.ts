import { describe, it, expect } from 'vitest'
import { eventLines, escapeText } from './ics-write'

const draft = { uid: 'u1', summary: 'S', start: Date.UTC(2026, 7, 5, 9), end: Date.UTC(2026, 7, 5, 10) }
const evil = ['a@x.com\r\nX-EVIL:1', 'a@x.com\nX-EVIL:1', 'a@x.com\rX-EVIL:1', 'a@x.com X-EVIL', '']

describe('invitee fields cannot add lines to the calendar file', () => {
  it.each(evil)('refuses the attendee address %j', (email) => {
    expect(() => eventLines({ ...draft, attendees: [{ email }] })).toThrow(/email address/i)
  })

  it.each(evil)('refuses the organizer address %j', (email) => {
    expect(() => eventLines({ ...draft, organizer: { email } })).toThrow(/email address/i)
  })

  it('escapes every kind of line break in text, a lone carriage return included', () => {
    expect(escapeText('a\r\nb\nc\rd')).toBe(String.raw`a\nb\nc\nd`)
    const lines = eventLines({ ...draft, attendees: [{ email: 'a@x.com', name: 'Ana\rX-EVIL:1' }] })
    expect(lines.join('\r\n')).not.toMatch(/\r(?!\n)|\r\nX-EVIL/)
  })
})
