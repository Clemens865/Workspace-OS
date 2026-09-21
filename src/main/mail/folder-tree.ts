/**
 * Folder tree shaping — flat IMAP paths into the nested rail every mail client
 * shows.
 *
 * IMAP hands back a flat list of paths joined by a server-chosen delimiter
 * ("INBOX/Projects/2026", "INBOX.Projects.2026"). Pure: paths in, tree out, so
 * the shaping is verifiable without a mailbox.
 *
 * Two things that look like details and are not:
 *
 *   - The delimiter is DETECTED, not assumed. Gmail uses "/", Dovecot commonly
 *     uses ".", Exchange uses "\\". Assuming one flattens the tree on the other
 *     two, and the folder rail silently looks like an unsorted pile.
 *   - A missing intermediate is SYNTHESISED. Servers happily report
 *     "A/B/C" with no "A/B", and a tree builder that only attaches to existing
 *     parents drops the whole subtree on the floor.
 */

export interface FlatFolder {
  path: string
  name: string
  specialUse?: string
  selectable?: boolean
}

export interface FolderNode extends FlatFolder {
  /** Display label — the last path segment, not the whole path. */
  label: string
  depth: number
  children: FolderNode[]
  /** True when this node exists only to hold children (no server folder). */
  synthetic: boolean
}

/**
 * Detects the hierarchy delimiter from the paths themselves.
 *
 * Picks the candidate that actually produces nesting; falls back to "/" when
 * nothing separates anything, which is the harmless case (a flat list stays
 * flat either way).
 */
export function detectDelimiter(folders: FlatFolder[]): string {
  const candidates = ['/', '.', '\\']
  let best = '/'
  let bestCount = 0
  for (const d of candidates) {
    const count = folders.filter((f) => f.path.includes(d)).length
    if (count > bestCount) {
      best = d
      bestCount = count
    }
  }
  return best
}

/** Builds the nested tree. Roots come back in the order the server listed them. */
export function buildFolderTree(folders: FlatFolder[], delimiter?: string): FolderNode[] {
  const delim = delimiter ?? detectDelimiter(folders)
  const byPath = new Map<string, FolderNode>()
  const roots: FolderNode[] = []

  const ensure = (path: string, source?: FlatFolder): FolderNode => {
    const existing = byPath.get(path)
    if (existing) {
      if (source) {
        // A synthesised placeholder becomes real once the server's own entry
        // arrives — order of the input must not decide what is real.
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
      const parentPath = segments.slice(0, -1).join(delim)
      // Synthesise the missing intermediate rather than dropping the subtree.
      const parent = ensure(parentPath)
      parent.children.push(node)
    } else {
      roots.push(node)
    }
    return node
  }

  for (const f of folders) ensure(f.path, f)
  return roots
}

/** Flattens a tree back to a render list, honouring which nodes are collapsed. */
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

/**
 * Orders roots the way people expect: special-use folders first in their
 * conventional order, then favourites, then everything else alphabetically.
 *
 * Sorting purely alphabetically puts "Archiv" above "INBOX", which is correct
 * and useless — the inbox is where the work is.
 */
const SPECIAL_ORDER = ['\\inbox', '\\drafts', '\\sent', '\\archive', '\\junk', '\\trash']

export function sortFolders(nodes: FolderNode[], favourites: Set<string> = new Set()): FolderNode[] {
  const rank = (n: FolderNode): number => {
    const su = (n.specialUse || '').toLowerCase()
    const special = SPECIAL_ORDER.indexOf(su)
    if (special >= 0) return special
    // INBOX often arrives with no special-use flag at all.
    if (n.path.toUpperCase() === 'INBOX') return 0
    if (favourites.has(n.path)) return SPECIAL_ORDER.length
    return SPECIAL_ORDER.length + 1
  }
  return [...nodes]
    .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label))
    .map((n) => ({ ...n, children: sortFolders(n.children, favourites) }))
}
