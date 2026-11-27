/**
 * Wall-clock time in a named zone — the arithmetic recurrence needs.
 *
 * "Every Monday at 09:00" is a statement about a clock on a wall in one zone,
 * not about a fixed UTC instant. Everything here converts between the two using
 * the zone rules the runtime already ships (Intl), so no zone table is carried.
 *
 * A zone is `'UTC'`, an IANA name, or undefined for the host zone. A name the
 * runtime does not know (Outlook's "W. Europe Standard Time", a custom TZID)
 * counts as the host zone — the reader's long-standing fallback.
 */

/** Calendar fields as a clock shows them. `mo` is 0-based, as in Date. */
export interface WallTime {
  y: number
  mo: number
  d: number
  h: number
  mi: number
  s: number
}

const formatters = new Map<string, Intl.DateTimeFormat | null>()

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  let f = formatters.get(zone)
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
      })
    } catch {
      f = null
    }
    formatters.set(zone, f)
  }
  return f
}

/** The zone name when the runtime has rules for it, else undefined (host). */
export function knownZone(zone: string | undefined): string | undefined {
  const z = zone?.replace(/^"|"$/g, '')
  return z && formatterFor(z) ? z : undefined
}

/** The zone this machine is set to — the one the form's times are typed in. */
export function hostZone(): string | undefined {
  return knownZone(new Intl.DateTimeFormat().resolvedOptions().timeZone)
}

/** The wall-clock reading of an instant. */
export function wallTimeOf(ms: number, zone?: string): WallTime {
  const z = knownZone(zone)
  if (!z) {
    const d = new Date(ms)
    return { y: d.getFullYear(), mo: d.getMonth(), d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds() }
  }
  const parts = formatterFor(z)!.formatToParts(new Date(ms))
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0)
  // Some runtimes still say hour 24 for midnight.
  return { y: get('year'), mo: get('month') - 1, d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') }
}

/** How far ahead of UTC the zone is at that instant, in ms. */
export function offsetAt(ms: number, zone: string): number {
  const w = wallTimeOf(ms, zone)
  return Date.UTC(w.y, w.mo, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000
}

/**
 * The instant a wall-clock reading names.
 *
 * RFC 5545 §3.3.5 for the two odd hours of a year: a time that happens twice
 * means the first one; a time that is skipped is read with the offset from
 * before the gap (so 02:30 lands at 03:30). The host-zone Date constructor
 * already behaves this way.
 */
export function epochOf(w: WallTime, zone?: string): number {
  const z = knownZone(zone)
  if (!z) return new Date(w.y, w.mo, w.d, w.h, w.mi, w.s).getTime()
  const naive = Date.UTC(w.y, w.mo, w.d, w.h, w.mi, w.s)
  if (z === 'UTC') return naive
  const before = offsetAt(naive - 86_400_000, z)
  const after = offsetAt(naive + 86_400_000, z)
  const real = [naive - before, naive - after].filter((t) => offsetAt(t, z) === naive - t)
  return real.length > 0 ? Math.min(...real) : naive - before
}
