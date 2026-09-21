/**
 * "Related notes" discovery — pure link-graph proximity (no embeddings, no ML).
 *
 * Given the resolved [[wikilink]] edge set (same directed shape as `graph()`'s
 * resolved edges) and a target note A, scores every OTHER note B by three
 * classic bibliometric signals and returns the strongest, deterministically:
 *
 *  - Direct link (1-hop): A→B or B→A resolved link.            weight DIRECT
 *  - Bibliographic coupling: notes X where BOTH A→X and B→X.   weight COUPLING · shared
 *  - Co-citation: notes Y where BOTH Y→A and Y→B.              weight COCITATION · shared
 *
 * Fully deterministic (tie-break by name), engine-free and unit-testable — the
 * SQL layer just feeds it the edges. Stubs never appear (edges only carry
 * resolved note→note pairs). Excludes A itself and any note with zero relation.
 */

/** A resolved directed edge: `source` links to `target` (both real note paths). */
export interface RelatedEdge {
  source: string
  target: string
}

/** Why a note surfaced as related — the signals that contributed to its score. */
export interface RelatedReasons {
  /** A directly links B (or B links A). */
  direct?: boolean
  /** Count of shared outgoing targets (bibliographic coupling). */
  coupling?: number
  /** Count of shared citers (co-citation). */
  cocitation?: number
}

/** One related note: its path, a display name, the score, and the reasons. */
export interface RelatedNote {
  path: string
  name: string
  score: number
  reasons: RelatedReasons
}

/** Scoring weights — direct links dominate; the two shared-neighbour signals
 *  accrue per shared note. Exposed for the SQL layer to stay consistent. */
export const RELATED_WEIGHTS = { direct: 3, coupling: 2, cocitation: 2 } as const

/** Basename without extension → a readable label for a note path. */
function displayName(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? filePath
  return base
}

/**
 * Score every note related to `targetPath` from the resolved edge set.
 *
 * `nameOf` maps a note path to its display label (defaults to the basename).
 * `maxCandidates` bounds the working set for large graphs: only notes sharing a
 * direct link or a neighbour with A are ever candidates, so the cap is a safety
 * valve, applied deterministically (by score then name) before `limit`.
 */
export function scoreRelated(
  edges: RelatedEdge[],
  targetPath: string,
  limit = 10,
  nameOf: (path: string) => string = displayName,
  maxCandidates = 500,
): RelatedNote[] {
  // Adjacency: for each note, the set of notes it links TO (outgoing) and the
  // set of notes that link to IT (incoming). Self-loops are ignored.
  const out = new Map<string, Set<string>>()
  const inc = new Map<string, Set<string>>()
  const add = (m: Map<string, Set<string>>, k: string, v: string): void => {
    let s = m.get(k)
    if (!s) m.set(k, (s = new Set()))
    s.add(v)
  }
  for (const e of edges) {
    if (!e.source || !e.target || e.source === e.target) continue
    add(out, e.source, e.target)
    add(inc, e.target, e.source)
  }

  const aOut = out.get(targetPath) ?? new Set<string>()
  const aInc = inc.get(targetPath) ?? new Set<string>()

  // Accumulate signals per candidate note B (B ≠ A).
  const scores = new Map<string, RelatedReasons>()
  const reasonsFor = (b: string): RelatedReasons => {
    let r = scores.get(b)
    if (!r) scores.set(b, (r = {}))
    return r
  }

  // Direct links (both directions collapse to a single `direct` flag).
  for (const b of aOut) if (b !== targetPath) reasonsFor(b).direct = true
  for (const b of aInc) if (b !== targetPath) reasonsFor(b).direct = true

  // Bibliographic coupling: for each X that A links to, every OTHER note that
  // also links to X shares one coupling with A.
  for (const x of aOut) {
    for (const b of inc.get(x) ?? []) {
      if (b === targetPath) continue
      const r = reasonsFor(b)
      r.coupling = (r.coupling ?? 0) + 1
    }
  }

  // Co-citation: for each Y that links to A, every OTHER note Y also links to
  // shares one co-citation with A.
  for (const y of aInc) {
    for (const b of out.get(y) ?? []) {
      if (b === targetPath) continue
      const r = reasonsFor(b)
      r.cocitation = (r.cocitation ?? 0) + 1
    }
  }

  const scoreOf = (r: RelatedReasons): number =>
    (r.direct ? RELATED_WEIGHTS.direct : 0) +
    (r.coupling ?? 0) * RELATED_WEIGHTS.coupling +
    (r.cocitation ?? 0) * RELATED_WEIGHTS.cocitation

  const ranked: RelatedNote[] = []
  for (const [path, reasons] of scores) {
    const score = scoreOf(reasons)
    if (score <= 0) continue // no relation → excluded
    ranked.push({ path, name: nameOf(path), score, reasons })
  }

  // Deterministic order: score desc, then name asc, then path asc as a final
  // tie-break (names can collide across folders).
  ranked.sort(
    (a, b) =>
      b.score - a.score || a.name.localeCompare(b.name) || a.path.localeCompare(b.path),
  )

  return ranked.slice(0, Math.min(limit, maxCandidates))
}
