import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { addLocal, readLocal, removeLocal, updateLocal, calendarToIcs, localCalendarPath } from './local-calendar'
import { foldLine } from './ics-write'
import { parseIcs } from './ics'

/**
 * The local calendar is the only writable one, so the thing that matters is
 * that what we WRITE is what we can READ — and that the file is real
 * iCalendar, because the promise is that these events are not trapped here.
 * The round trip goes through the existing parser rather than a bespoke one,
 * which is what makes it a real check.
 */

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-cal-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

const AT = Date.UTC(2026, 7, 20, 9, 0, 0)

describe('local calendar', () => {
  it('writes an event the parser reads back', () => {
    addLocal(root, { summary: 'Interview — ALPLA', start: AT, end: AT + 3600_000 })
    const back = readLocal(root)
    expect(back).toHaveLength(1)
    expect(back[0].summary).toBe('Interview — ALPLA')
    expect(back[0].start).toBe(AT)
  })

  it('produces a file another calendar app could open', () => {
    addLocal(root, { summary: 'X', start: AT, end: AT + 3600_000 })
    const text = fs.readFileSync(localCalendarPath(root), 'utf8')
    expect(text.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(text).toContain('VERSION:2.0')
    expect(text.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
    // CRLF is required by RFC 5545; some clients reject bare LF.
    expect(text).toContain('\r\n')
  })

  it('keeps events across appends', () => {
    addLocal(root, { summary: 'One', start: AT, end: AT + 1000 })
    addLocal(root, { summary: 'Two', start: AT + 7200_000, end: AT + 9000_000 })
    expect(readLocal(root).map((e) => e.summary).sort()).toEqual(['One', 'Two'])
  })

  it('gives every event a distinct uid', () => {
    addLocal(root, { summary: 'A', start: AT, end: AT + 1000 })
    addLocal(root, { summary: 'B', start: AT, end: AT + 1000 })
    const [a, b] = readLocal(root)
    expect(a.uid).not.toBe(b.uid)
  })

  it('escapes characters that would otherwise break the format', () => {
    addLocal(root, {
      summary: 'Call; with, Maria\\Schmidt',
      start: AT,
      end: AT + 1000,
      description: 'line one\nline two',
    })
    const back = readLocal(root)
    expect(back[0].summary).toBe('Call; with, Maria\\Schmidt')
    expect(back[0].description).toContain('line one')
  })

  /** A zero-length event is invisible in most clients — quietly useless. */
  it('gives an event with no duration a sensible length', () => {
    addLocal(root, { summary: 'Instant', start: AT, end: AT })
    expect(readLocal(root)[0].end).toBe(AT + 3600_000)
  })

  it('writes an all-day event as a DATE, not a timestamp', () => {
    addLocal(root, { summary: 'Deadline', start: AT, end: AT + 86_400_000, allDay: true })
    const text = fs.readFileSync(localCalendarPath(root), 'utf8')
    expect(text).toContain('DTSTART;VALUE=DATE:2026082')
    expect(readLocal(root)[0].allDay).toBe(true)
  })

  it('removes an event by uid', () => {
    const e = addLocal(root, { summary: 'Gone', start: AT, end: AT + 1000 })
    expect(removeLocal(root, e.uid)).toBe(true)
    expect(readLocal(root)).toHaveLength(0)
  })

  it('reports when there was nothing to remove', () => {
    expect(removeLocal(root, 'nope')).toBe(false)
  })

  it('reads an empty calendar rather than throwing', () => {
    expect(readLocal(root)).toEqual([])
  })

  it('survives a corrupt file instead of taking the calendar down', () => {
    fs.mkdirSync(path.dirname(localCalendarPath(root)), { recursive: true })
    fs.writeFileSync(localCalendarPath(root), 'this is not iCalendar')
    expect(readLocal(root)).toEqual([])
  })
})

describe('line folding', () => {
  /**
   * A long line emitted unfolded is what makes an otherwise valid file fail to
   * import into Apple Calendar — and it fails SILENTLY: the event just does not
   * appear.
   */
  it('folds a long line and the parser unfolds it back', () => {
    const long = 'x'.repeat(300)
    const ics = calendarToIcs([
      { uid: 'u', summary: long, start: AT, end: AT + 1000, allDay: false },
    ])
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(76)
    expect(parseIcs(ics)[0].summary).toBe(long)
  })

  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:hello')).toBe('SUMMARY:hello')
  })
})

describe('updateLocal', () => {
  it('replaces the editable fields and keeps the uid', () => {
    const ev = addLocal(root, { summary: 'Before', start: AT, end: AT + 3600_000, location: 'Old' })
    const updated = updateLocal(root, ev.uid, { summary: 'After', start: AT + 86_400_000, end: AT + 90_000_000 })
    expect(updated?.uid).toBe(ev.uid)
    const back = readLocal(root)
    expect(back).toHaveLength(1)
    expect(back[0].summary).toBe('After')
    expect(back[0].start).toBe(AT + 86_400_000)
    expect(back[0].location).toBeUndefined()
  })

  it('says no for an event that is not there instead of appending one', () => {
    addLocal(root, { summary: 'X', start: AT, end: AT + 1000 })
    expect(updateLocal(root, 'nope@nowhere', { summary: 'Y', start: AT, end: AT + 1000 })).toBeNull()
    expect(readLocal(root)).toHaveLength(1)
  })

  it('leaves the other events untouched', () => {
    const a = addLocal(root, { summary: 'A', start: AT, end: AT + 1000 })
    addLocal(root, { summary: 'B', start: AT + 7200_000, end: AT + 9000_000 })
    updateLocal(root, a.uid, { summary: 'A2', start: AT, end: AT + 1000 })
    expect(readLocal(root).map((e) => e.summary).sort()).toEqual(['A2', 'B'])
  })
})
