/**
 * Small fuzzy matcher for the quick-open palette (⌘P). Subsequence matching
 * with the usual editor-style bonuses: word-boundary hits, consecutive runs,
 * and basename matches beat scattered path matches.
 */

/** True when `ch` starts a "word" in `target` at position `i`. */
function isWordStart(target: string, i: number): boolean {
  if (i === 0) return true
  const prev = target[i - 1]
  return prev === '/' || prev === '-' || prev === '_' || prev === '.' || prev === ' '
}

/**
 * Scores `query` as a case-insensitive subsequence of `target`.
 * Returns null when the query is not a subsequence. Higher is better.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (q.length === 0) return 0
  if (q.length > t.length) return null

  // Exact substring is the strongest signal — score it directly.
  const sub = t.indexOf(q)
  if (sub >= 0) {
    let score = 100 + q.length * 4
    if (isWordStart(t, sub)) score += 20
    score -= Math.min(20, Math.floor(sub / 4)) // earlier is better
    return score
  }

  let score = 0
  let ti = 0
  let lastMatch = -2
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti)
    if (idx === -1) return null
    score += 1
    if (idx === lastMatch + 1) score += 5 // consecutive run
    if (isWordStart(t, idx)) score += 10 // word-boundary hit
    score -= Math.min(3, Math.floor((idx - ti) / 8)) // penalize wide gaps a little
    lastMatch = idx
    ti = idx + 1
  }
  return score
}

export interface RankedFile {
  path: string
  score: number
}

/**
 * Ranks workspace files against a query: basename matches are weighted over
 * whole-path matches, and recently opened files get a most-recent-first boost.
 * `recents` is ordered most recent first. Non-matches are dropped.
 */
export function rankFiles(query: string, paths: string[], recents: string[] = []): RankedFile[] {
  const recentRank = new Map(recents.map((p, i) => [p, i]))
  const recencyBonus = (p: string): number => {
    const i = recentRank.get(p)
    return i === undefined ? 0 : (recents.length - i) * 3
  }

  if (!query.trim()) {
    // Empty query: recents first (in order), then the rest as-is.
    const rest = paths.filter((p) => !recentRank.has(p))
    const front = recents.filter((p) => paths.includes(p))
    return [...front, ...rest].map((p) => ({ path: p, score: 0 }))
  }

  const ranked: RankedFile[] = []
  for (const p of paths) {
    const base = p.slice(p.lastIndexOf('/') + 1)
    const baseScore = fuzzyScore(query, base)
    const pathScore = fuzzyScore(query, p)
    if (baseScore === null && pathScore === null) continue
    const score = Math.max(baseScore !== null ? baseScore * 2 : -Infinity, pathScore ?? -Infinity) + recencyBonus(p)
    ranked.push({ path: p, score })
  }
  ranked.sort((a, b) => b.score - a.score || a.path.length - b.path.length)
  return ranked
}
