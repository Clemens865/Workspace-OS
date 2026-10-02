/**
 * The search index is one database for every workspace ever opened
 * (userData/search-index.db), so its answers must be cut down to the open
 * workspace before they leave main. Without this, search, backlinks and the
 * knowledge graph showed notes from other folders (found by the landscape
 * Library test, docs/landscape/ADOPTION.md B4).
 *
 * Pure: paths in, paths out.
 */
import path from 'path'
import type { Graph } from './index-db'

/** True when `p` is the root or lies inside it. */
export function inRoot(p: string | null | undefined, root: string | null): boolean {
  if (!p || !root) return false
  const r = path.resolve(root)
  const x = path.resolve(p)
  return x === r || x.startsWith(r + path.sep)
}

/** Keeps the items whose `key` path lies in the root; nothing when no workspace is open. */
export function scopeByPath<T>(items: T[], root: string | null, key: (t: T) => string | null | undefined): T[] {
  if (!root) return []
  return items.filter((t) => inRoot(key(t), root))
}

/**
 * The knowledge graph of one workspace: its notes, the links between them,
 * and the stubs its own notes reference. Degrees are counted again over what
 * is left, so a note's size reflects this workspace only.
 */
export function scopeGraph(g: Graph, root: string | null): Graph {
  if (!root) return { ...g, nodes: [], edges: [] }
  const notes = new Set(g.nodes.filter((n) => n.kind === 'note' && inRoot(n.id, root)).map((n) => n.id))
  const edges = g.edges.filter((e) => notes.has(e.source) && (notes.has(e.target) || e.target.startsWith('stub:')))
  const stubs = new Set(edges.filter((e) => e.target.startsWith('stub:')).map((e) => e.target))
  const degree = new Map<string, number>()
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
  }
  const nodes = g.nodes
    .filter((n) => notes.has(n.id) || stubs.has(n.id))
    .map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 }))
  return { ...g, nodes, edges }
}

/** The stubs the workspace's own notes reference, most-referenced first. */
export function stubsOf(g: Pick<Graph, 'nodes'>): { targetName: string; refCount: number }[] {
  return g.nodes
    .filter((n) => n.kind === 'stub')
    .map((n) => ({ targetName: n.name, refCount: n.degree }))
    .sort((a, b) => b.refCount - a.refCount || a.targetName.localeCompare(b.targetName))
}
