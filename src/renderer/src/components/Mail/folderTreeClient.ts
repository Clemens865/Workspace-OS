/**
 * Renderer copy of the folder-tree shaping.
 *
 * It is a copy, not an import: the renderer is sandboxed and deliberately
 * cannot reach main-process modules — that boundary is the security model, not
 * an inconvenience to route around. `src/main/mail/folder-tree.ts` remains the
 * tested source of truth (19 tests covering delimiter detection, synthesised
 * intermediates and ordering); this mirrors the same pure functions so the rail
 * can re-shape on every render without an IPC round-trip. Keep the two in step.
 */

export interface FlatFolder {
  path: string
  name: string
  specialUse?: string
  selectable?: boolean
}

export interface FolderNode extends FlatFolder {
  label: string
  depth: number
  children: FolderNode[]
  synthetic: boolean
}

/** Detects the hierarchy delimiter: Gmail "/", Dovecot ".", Exchange "\". */
export function detectDelimiter(folders: FlatFolder[]): string {
  const candidates = ['/', '.', '\\']
  let best = '/'
  let bestCount = 0
  for (const d of candidates) {
    const count = folders.filter((f) => f.path.includes(d)).length
    if (count > bestCount) { best = d; bestCount = count }
  }
  return best
}

export function buildFolderTree(folders: FlatFolder[], delimiter?: string): FolderNode[] {
  const delim = delimiter ?? detectDelimiter(folders)
  const byPath = new Map<string, FolderNode>()
  const roots: FolderNode[] = []

  const ensure = (path: string, source?: FlatFolder): FolderNode => {
    const existing = byPath.get(path)
    if (existing) {
      if (source) {
        existing.synthetic = false
        existing.specialUse = source.specialUse
        existing.selectable = source.selectable
        existing.name = source.name
      }
      return existing
    }
    const segments = path.split(delim)
    const label = segments[segments.length - 1] || path
    const node: FolderNode = {
      path,
      name: source?.name ?? label,
      label,
      specialUse: source?.specialUse,
      selectable: source?.selectable ?? false,
      depth: segments.length - 1,
      children: [],
      synthetic: !source,
    }
    byPath.set(path, node)
    if (segments.length > 1) {
      // Synthesise a missing intermediate rather than dropping the subtree.
      ensure(segments.slice(0, -1).join(delim)).children.push(node)
    } else {
      roots.push(node)
    }
    return node
  }

  for (const f of folders) ensure(f.path, f)
  return roots
}

export function flattenTree(roots: FolderNode[], collapsed: Set<string>): FolderNode[] {
  const out: FolderNode[] = []
  const walk = (nodes: FolderNode[]): void => {
    for (const n of nodes) {
      out.push(n)
      if (n.children.length > 0 && !collapsed.has(n.path)) walk(n.children)
    }
  }
  walk(roots)
  return out
}

const SPECIAL_ORDER = ['\\inbox', '\\drafts', '\\sent', '\\archive', '\\junk', '\\trash']

/** Special folders in their conventional order, then favourites, then A–Z. */
export function sortFolders(nodes: FolderNode[], favourites: Set<string> = new Set()): FolderNode[] {
  const rank = (n: FolderNode): number => {
    const su = (n.specialUse || '').toLowerCase()
    const special = SPECIAL_ORDER.indexOf(su)
    if (special >= 0) return special
    if (n.path.toUpperCase() === 'INBOX') return 0
    if (favourites.has(n.path)) return SPECIAL_ORDER.length
    return SPECIAL_ORDER.length + 1
  }
  return [...nodes]
    .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label))
    .map((n) => ({ ...n, children: sortFolders(n.children, favourites) }))
}
