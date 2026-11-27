import { stamp } from './ics-write'
import { hostZone } from './zoned-time'

/**
 * The repeat rules this app can AUTHOR.
 *
 * Reading handles whatever other clients wrote (see parseRrule); writing is a
 * deliberately small set — daily, weekly on chosen days, monthly, yearly, every
 * N of them, ending never, after a count, or on a date. The renderer sends this
 * as structured fields and the rule text is composed HERE, so nothing typed
 * into the app can add a line to a calendar file or reach a server verbatim.
 */
export interface RecurrenceInput {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  /** Every N days/weeks/months/years. */
  interval: number
  /** WEEKLY only: weekday numbers, 0=Sunday. Includes the start's own day. */
  byWeekday?: number[]
  /** Ends after this many occurrences. Exclusive with `until`. */
  count?: number
  /** Last day it may occur, `YYYY-MM-DD`, inclusive. */
  until?: string
}

const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']
const FIELDS = ['freq', 'interval', 'byWeekday', 'count', 'until']
const CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

export const MAX_INTERVAL = 999
export const MAX_COUNT = 1000

function wholeNumber(value: unknown, label: string, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${label} must be a whole number from 1 to ${max}.`)
  }
  return value
}

/** `YYYY-MM-DD` as a local day, or null when it is not a real date. */
function localDay(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3])
  // Date rolls 30 February into March; a real date survives the round trip.
  return d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null
}

/**
 * Checks an untrusted repeat request against the event's start. Refuses rather
 * than repairs: a rule that is "nearly" what was asked puts meetings on days
 * nobody chose.
 */
export function parseRecurrenceInput(input: unknown, start: number): RecurrenceInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('The repeat rule is not readable.')
  }
  const o = input as Record<string, unknown>
  const unknown = Object.keys(o).filter((k) => !FIELDS.includes(k))
  if (unknown.length > 0) throw new Error(`The repeat rule has an unknown field: ${unknown[0].slice(0, 40)}`)
  const startDate = new Date(start)
  if (!Number.isFinite(startDate.getTime()) || startDate.getFullYear() < 1900 || startDate.getFullYear() > 9000) {
    throw new Error('A repeating event needs a real start date.')
  }
  if (typeof o.freq !== 'string' || !FREQUENCIES.includes(o.freq)) {
    throw new Error('Repeat must be daily, weekly, monthly or yearly.')
  }
  const out: RecurrenceInput = {
    freq: o.freq as RecurrenceInput['freq'],
    interval: wholeNumber(o.interval, 'The repeat interval', MAX_INTERVAL),
  }
  if (o.byWeekday !== undefined) {
    if (out.freq !== 'WEEKLY') throw new Error('Weekdays only apply to a weekly repeat.')
    const days = o.byWeekday
    if (
      !Array.isArray(days) || days.length === 0 || days.length > 7
      || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      || new Set(days).size !== days.length
    ) {
      throw new Error('Pick each repeat weekday once.')
    }
    if (!days.includes(startDate.getDay())) {
      throw new Error('The repeat weekdays must include the day the event starts.')
    }
    out.byWeekday = [...(days as number[])].sort((a, b) => a - b)
  }
  if (o.count !== undefined && o.until !== undefined) {
    throw new Error('A repeat ends after a count or on a date, not both.')
  }
  if (o.count !== undefined) out.count = wholeNumber(o.count, 'The number of occurrences', MAX_COUNT)
  if (o.until !== undefined) {
    const day = typeof o.until === 'string' ? localDay(o.until) : null
    if (!day) throw new Error('The repeat end date is not a real date.')
    const startDay = new Date(startDate)
    startDay.setHours(0, 0, 0, 0)
    if (day.getTime() < startDay.getTime()) throw new Error('The repeat ends before the event starts.')
    out.until = o.until as string
  }
  return out
}

/**
 * What a draft needs to be written as a series: the rule, and — for timed events
 * — this machine's zone, so 09:00 stays 09:00 across a DST change.
 */
export function repeatFields(r: RecurrenceInput, allDay: boolean): { rrule: string; timeZone?: string } {
  const zone = allDay ? undefined : hostZone()
  return { rrule: toRrule(r, allDay), ...(zone ? { timeZone: zone } : {}) }
}

/**
 * The RRULE value for a checked input.
 *
 * UNTIL must match DTSTART's type (RFC 5545 §3.3.10): a DATE for an all-day
 * series; for a timed one a UTC instant — the end of the chosen day here, so the
 * last day's occurrence is included.
 */
export function toRrule(r: RecurrenceInput, allDay: boolean): string {
  const parts = [`FREQ=${r.freq}`]
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`)
  if (r.count !== undefined) parts.push(`COUNT=${r.count}`)
  if (r.until !== undefined) {
    if (allDay) parts.push(`UNTIL=${r.until.replace(/-/g, '')}`)
    else {
      const d = localDay(r.until)!
      d.setHours(23, 59, 59, 0)
      parts.push(`UNTIL=${stamp(d.getTime())}`)
    }
  }
  if (r.byWeekday?.length) {
    // Written Monday-first, the way the week reads in this app.
    const ordered = [...r.byWeekday].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    parts.push(`BYDAY=${ordered.map((d) => CODES[d]).join(',')}`)
  }
  return parts.join(';')
}
