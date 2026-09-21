/**
 * The routine schedule grammar. Small and explicit — not cron.
 *
 *   daily@07:00        every day at 07:00 (local time)
 *   weekdays@07:00     Monday to Friday at 07:00
 *   weekly@mon 09:00   every Monday at 09:00
 *   every:6h           every six hours, counted from the last run
 *
 * Four shapes cover what a person actually asks a routine to do; a cron
 * string covers everything and is read by nobody. Pure and testable.
 */

export type Schedule =
  | { kind: 'daily' | 'weekdays'; hour: number; minute: number }
  | { kind: 'weekly'; dow: number; hour: number; minute: number }
  | { kind: 'every'; hours: number }

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const HOUR = 3_600_000
const DAY = 24 * HOUR
export const MAX_EVERY_HOURS = 168

function time(s: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

export function parseSchedule(input: unknown): Schedule | null {
  if (typeof input !== 'string') return null
  const s = input.trim().toLowerCase()
  let m: RegExpExecArray | null
  if ((m = /^(daily|weekdays)@(.+)$/.exec(s))) {
    const t = time(m[2])
    return t ? { kind: m[1] as 'daily' | 'weekdays', ...t } : null
  }
  if ((m = /^weekly@([a-z]{3})\s+(.+)$/.exec(s))) {
    const dow = DAYS.indexOf(m[1])
    const t = time(m[2])
    return dow === -1 || !t ? null : { kind: 'weekly', dow, ...t }
  }
  if ((m = /^every:(\d{1,3})h$/.exec(s))) {
    const hours = Number(m[1])
    return hours >= 1 && hours <= MAX_EVERY_HOURS ? { kind: 'every', hours } : null
  }
  return null
}

/** The canonical string for a parsed schedule. */
export function formatSchedule(s: Schedule): string {
  const hm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  if (s.kind === 'every') return `every:${s.hours}h`
  if (s.kind === 'weekly') return `weekly@${DAYS[s.dow]} ${hm(s.hour, s.minute)}`
  return `${s.kind}@${hm(s.hour, s.minute)}`
}

/** In words: "every weekday at 07:00". */
export function describeSchedule(s: Schedule): string {
  const hm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  switch (s.kind) {
    case 'daily':
      return `every day at ${hm(s.hour, s.minute)}`
    case 'weekdays':
      return `every weekday at ${hm(s.hour, s.minute)}`
    case 'weekly':
      return `every ${DAY_NAMES[s.dow]} at ${hm(s.hour, s.minute)}`
    case 'every':
      return s.hours === 1 ? 'every hour' : s.hours % 24 === 0 ? `every ${s.hours / 24} day${s.hours === 24 ? '' : 's'}` : `every ${s.hours} hours`
  }
}

/**
 * The next time this schedule fires STRICTLY after `after` (epoch ms, local
 * time). For `every`, counted from `lastRunAt` when known — a routine that
 * ran at 09:00 with every:6h is due at 15:00 whatever the clock says now;
 * if that is already past, it is due now (the scheduler fires it once).
 */
export function nextRun(s: Schedule, after: number, lastRunAt: number | null = null): number {
  if (s.kind === 'every') {
    const from = lastRunAt ?? after
    return from + s.hours * HOUR
  }
  const weeklyDow = s.kind === 'weekly' ? s.dow : -1
  const d = new Date(after)
  d.setHours(s.hour, s.minute, 0, 0)
  // Walk forward day by day until the day fits and the time is after `after`.
  // DST: setHours re-resolves the local wall clock per day, so 07:00 stays 07:00.
  for (let i = 0; i < 400; i++) {
    const t = d.getTime()
    const dow = d.getDay()
    const fits = s.kind === 'daily' ? true : s.kind === 'weekdays' ? dow >= 1 && dow <= 5 : dow === weeklyDow
    if (fits && t > after) return t
    d.setTime(t + DAY)
    d.setHours(s.hour, s.minute, 0, 0)
  }
  return after + DAY
}
