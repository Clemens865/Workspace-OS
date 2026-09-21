/**
 * Pure model for the Morning Sift view: the briefing sentence, zone ordering,
 * and the noise grouping. Kept out of the component so the words the person
 * reads every morning are tested, not incidental.
 */

export interface SiftRow {
  uid: number
  folder: string
  zone: 'answer' | 'case' | 'glance' | 'noise'
  priority: number
  summary: string
  caseTitle: string | null
  /** The concrete next step, or null. Optional: cached rows predate it. */
  todo?: string | null
  /** ISO date (YYYY-MM-DD) the mail names, or null. Optional as above. */
  due?: string | null
  fromName: string
  fromAddress: string
  subject: string
  date: number | null
  /** Null on rows never deepened, and absent in v1 caches. */
  messageId?: string | null
}

export const ZONE_ORDER = ['answer', 'case', 'glance', 'noise'] as const
export type Zone = (typeof ZONE_ORDER)[number]

export const ZONE_TITLES: Record<Zone, string> = {
  answer: 'Needs an answer',
  case: 'Your cases',
  glance: 'Worth a glance',
  noise: 'Noise',
}

export function countByZone(rows: SiftRow[]): Record<Zone, number> {
  const c: Record<Zone, number> = { answer: 0, case: 0, glance: 0, noise: 0 }
  for (const r of rows) c[r.zone]++
  return c
}

/**
 * The morning sentence. Only zones that HAVE mail are mentioned — "0 need an
 * answer" is noise about noise. An empty sift is its own good news.
 */
export function briefingLine(rows: SiftRow[]): string {
  if (rows.length === 0) return 'Nothing unread — a clear inbox.'
  const c = countByZone(rows)
  const parts: string[] = []
  if (c.answer) parts.push(`${c.answer} need${c.answer === 1 ? 's' : ''} an answer`)
  if (c.case) parts.push(`${c.case} belong${c.case === 1 ? 's' : ''} to your cases`)
  if (c.glance) parts.push(`${c.glance} worth a glance`)
  if (c.noise) parts.push(`${c.noise} ${c.noise === 1 ? 'is' : 'are'} noise`)
  return `${rows.length} unread — ${parts.join(', ')}.`
}

/** Rows of one zone, most urgent first, then newest. */
export function zoneRows(rows: SiftRow[], zone: Zone): SiftRow[] {
  return rows
    .filter((r) => r.zone === zone)
    .sort((a, b) => b.priority - a.priority || (b.date ?? 0) - (a.date ?? 0))
}

export interface NoiseGroup {
  label: string
  address: string
  count: number
  /** The newest mail of the group — the row a click opens. */
  top: SiftRow
}

/**
 * Merges an incremental refresh into the cached sift. Fresh verdicts win on a
 * shared uid (re-judged mail), and the union is PRUNED to what is still
 * unread — a mail read elsewhere leaves the sift on the next refresh. This is
 * what makes the sift a VIEW rather than a spell: flipping to it costs a cache
 * read, and the model only ever sees uids it hasn't judged.
 */
export function mergeVerdicts(cached: SiftRow[], fresh: SiftRow[], unreadUids: number[]): SiftRow[] {
  const unread = new Set(unreadUids)
  const byUid = new Map<number, SiftRow>()
  for (const r of cached) byUid.set(r.uid, r)
  for (const r of fresh) byUid.set(r.uid, r)
  return [...byUid.values()].filter((r) => unread.has(r.uid))
}

/** Storage key for one folder's cached sift (workspace-os:* convention). */
export function siftCacheKey(accountId: string, folder: string): string {
  return `workspace-os:mail-sift:v1:${accountId}:${folder}`
}

export interface SiftCache {
  rows: SiftRow[]
  /** The assistant's last briefing — kept until a fresh batch writes a new one. */
  briefing: string | null
}

/**
 * Parses a cached sift blob; anything malformed reads as "no cache". Accepts
 * the v1 form (a bare rows array, no briefing) so existing caches survive.
 */
export function parseSiftCache(raw: string | null): SiftCache {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null
    const rowsIn = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { rows?: unknown })?.rows)
        ? ((parsed as { rows: unknown[] }).rows)
        : []
    const briefingIn = (parsed as { briefing?: unknown })?.briefing
    return {
      rows: rowsIn.filter(
        (r): r is SiftRow =>
          typeof (r as SiftRow)?.uid === 'number' && typeof (r as SiftRow)?.zone === 'string',
      ),
      briefing: typeof briefingIn === 'string' && briefingIn.trim() ? briefingIn : null,
    }
  } catch {
    return { rows: [], briefing: null }
  }
}

/** Noise reads per SENDER, not per mail — that's the altitude it deserves. */
export function groupNoise(rows: SiftRow[]): NoiseGroup[] {
  const byAddr = new Map<string, NoiseGroup>()
  for (const r of zoneRows(rows, 'noise')) {
    const key = (r.fromAddress || r.fromName || 'unknown').toLowerCase()
    const g = byAddr.get(key)
    if (g) {
      g.count++
      if ((r.date ?? 0) > (g.top.date ?? 0)) g.top = r
    } else {
      byAddr.set(key, { label: r.fromName || r.fromAddress || '(unknown sender)', address: key, count: 1, top: r })
    }
  }
  return [...byAddr.values()].sort((a, b) => b.count - a.count)
}
