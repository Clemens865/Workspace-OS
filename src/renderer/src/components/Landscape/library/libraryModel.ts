/**
 * Pure model for the landscape's Library (docs/landscape/ADOPTION.md B4):
 * which files to show, and in what order, for a search or for the shelves.
 */

export interface LibraryFile {
  path: string
  name: string
  /** Where it came from, for the little tag on the tile. */
  why: 'new' | 'opened' | 'starred' | 'name' | 'content'
  /** A content match's line, for search results. */
  snippet?: string
}

const base = (p: string): string => p.split('/').pop() ?? p

/** The file's path relative to the workspace, for a quiet second line. */
export function relPath(path: string, root: string | null): string {
  if (root && path.startsWith(root + '/')) return path.slice(root.length + 1)
  return path
}

/**
 * Search: file names first (the person usually remembers a name), then
 * content matches from the search index. Names match on every word of the
 * query, in any order, case-insensitive. One entry per path.
 */
export function searchFiles(
  query: string,
  names: string[],
  content: { path: string; snippet: string }[],
  max = 40,
): LibraryFile[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const out: LibraryFile[] = []
  const seen = new Set<string>()
  const scored = names
    .map((p) => {
      const n = base(p).toLowerCase()
      const full = p.toLowerCase()
      if (!words.every((w) => full.includes(w))) return null
      // name hits beat folder hits; an exact start beats a middle
      const score = words.reduce((s, w) => s + (n.startsWith(w) ? 3 : n.includes(w) ? 2 : 1), 0)
      return { p, score }
    })
    .filter((x): x is { p: string; score: number } => !!x)
    .sort((a, b) => b.score - a.score || base(a.p).localeCompare(base(b.p)))
  for (const { p } of scored) {
    if (seen.has(p)) continue
    seen.add(p)
    out.push({ path: p, name: base(p), why: 'name' })
  }
  for (const c of content) {
    if (seen.has(c.path)) continue
    seen.add(c.path)
    out.push({ path: c.path, name: base(c.path), why: 'content', snippet: c.snippet })
  }
  return out.slice(0, max)
}

/** The shelves when nothing is searched: new, then opened, then starred; one entry per path. */
export function shelves(
  created: { path: string; at: number }[],
  recent: { path: string; ts: number }[],
  starred: string[],
): { title: string; files: LibraryFile[] }[] {
  const seen = new Set<string>()
  const take = (paths: string[], why: LibraryFile['why']): LibraryFile[] =>
    paths
      .filter((p) => {
        if (seen.has(p)) return false
        seen.add(p)
        return true
      })
      .map((p) => ({ path: p, name: base(p), why }))
  const out = [
    { title: 'New', files: take([...created].sort((a, b) => b.at - a.at).map((c) => c.path), 'new') },
    { title: 'Opened recently', files: take([...recent].sort((a, b) => b.ts - a.ts).map((r) => r.path), 'opened') },
    { title: 'Starred', files: take(starred, 'starred') },
  ]
  return out.filter((s) => s.files.length)
}
